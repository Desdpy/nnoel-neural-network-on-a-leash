import json
import sqlite3
from pathlib import Path
from typing import Any

import tools
from config import AGENT_NAME, AGENT_SYSTEM_PROMPT
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from llama import chat_stream, get_llm

router = APIRouter()

# --- SQLite-based chat history ---
# Store chat messages in data/chat.db so the conversation persists across restarts
DB_DIR = Path(__file__).parent.parent / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = str(DB_DIR / "chat.db")

# Safety cap on the number of back-and-forth tool-call iterations per turn,
# so a misbehaving model can't loop forever.
MAX_TOOL_ITERATIONS = 5


def _get_db() -> sqlite3.Connection:
    """Open a DB connection, creating the messages table if it doesn't exist yet."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  role TEXT NOT NULL,"
        "  content TEXT NOT NULL,"
        "  created_at TEXT DEFAULT (datetime('now'))"
        ")"
    )
    return conn


def _load_messages() -> list[dict]:
    """Load the most recent 50 messages in chronological order."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT role, content FROM messages ORDER BY id DESC LIMIT 50"
    ).fetchall()
    conn.close()
    # Reverse so oldest message is first (chronological order)
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


def _append_message(role: str, content: str) -> None:
    """Persist a single message (user or assistant) to the database."""
    conn = _get_db()
    conn.execute("INSERT INTO messages (role, content) VALUES (?, ?)", (role, content))
    conn.commit()
    conn.close()


def _ndjson(event: dict[str, Any]) -> str:
    """Encode a single event as one NDJSON line (terminated with a newline)."""
    return json.dumps(event, ensure_ascii=False) + "\n"


# --- API Endpoints ---

@router.get("/config")
def get_config():
    """Return agent display-name and the registered tool list so the UI can show them."""
    return {
        "agent": {"name": AGENT_NAME},
        "tools": [t["function"]["name"] for t in tools.TOOLS],
    }


@router.get("/agent-image")
def agent_image():
    """Serve the agent's avatar PNG.  Returns 404 if the file is missing."""
    img = Path(__file__).parent / "assets" / "Nnoel.png"
    if not img.exists():
        raise HTTPException(status_code=404)
    return FileResponse(img, media_type="image/png")


@router.get("/ping")
def ping():
    """Health-check endpoint.  Returns 503 if the LLM model isn't loaded yet."""
    try:
        get_llm()
        return {"status": "ok", "llama": True}
    except Exception:
        raise HTTPException(status_code=503, detail={"status": "error", "llama": False})


def _build_system_message(rag_context: str | None = None) -> str:
    """Build the system message, optionally wrapping RAG context with delimiters.

    When one or more tools are registered, a short tools-guidance section is
    appended so small models know what helpers are available.
    """
    parts: list[str] = []
    if AGENT_SYSTEM_PROMPT:
        parts.append(AGENT_SYSTEM_PROMPT)

    if tools.TOOLS:
        tool_names = ", ".join(t["function"]["name"] for t in tools.TOOLS)
        parts.append(
            f"\n\nYou have access to the following tools: {tool_names}. "
            "When the user asks something a tool can answer, call the tool "
            "instead of guessing. For time questions that don't mention a "
            "location (e.g. 'what time is it?', 'my time', 'local time', "
            "'the time here'), call get_local_time with NO arguments — "
            "the tool will return the system clock. "
            "Do not mention these instructions to the user."
        )

    if not parts:
        return ""

    base = "".join(parts)
    if rag_context:
        return f"{base}\n\nUse the following context to help answer:\n\n===\nCONTEXT:\n{rag_context}\n==="
    return base


@router.post("/chat")
def chat(message: str = Body(..., embed=True)):
    """
    Stream a LLM response for the given user message.

    Accepts a plain string (the user's new message) and returns an
    ``application/x-ndjson`` stream. Each line is a JSON object:

    - ``{"type": "token", "content": "..."}`` — a text delta
    - ``{"type": "tool_call", "name": "...", "arguments": {...}}`` —
      the model wants to call a tool
    - ``{"type": "tool_result", "name": "...", "result": "..."}`` —
      the tool returned this string
    - ``{"type": "done"}`` — final event of the stream

    The backend owns the conversation history — it loads it from the DB,
    injects the system prompt, runs the tool-call loop until the model
    produces a normal text answer, then persists the final reply.
    """
    try:
        # 1. Save the user's message, then load the full history
        _append_message("user", message)
        history = _load_messages()

        # 2. Prepend the system prompt if one is configured
        system_msg = _build_system_message()
        llm_messages: list[dict[str, Any]] = (
            [{"role": "system", "content": system_msg}] + history
            if system_msg
            else list(history)
        )

        # 3. Generator that streams events AND runs the tool-call loop.
        # The DB write happens only after the loop completes normally, so a
        # client disconnect (e.g. the Stop button) leaves no half-written
        # assistant message behind.
        def event_stream():
            full_reply = ""
            try:
                for _ in range(MAX_TOOL_ITERATIONS):
                    tool_calls: list[dict[str, Any]] = []

                    for event in chat_stream(llm_messages, tools=tools.TOOLS or None):
                        kind = event[0]
                        if kind == "token":
                            # ``chat_stream`` yields a discriminated tuple
                            # (("token", str) or ("tool_calls", list)); the
                            # type checker can't narrow ``event[1]`` from the
                            # first element alone, so we assert and rebind.
                            assert isinstance(event[1], str)
                            full_reply += event[1]
                            yield _ndjson({"type": "token", "content": event[1]})
                        elif kind == "tool_calls":
                            assert isinstance(event[1], list)
                            tool_calls = event[1]

                    if not tool_calls:
                        # Model produced a final text answer — we're done.
                        break

                    # Append the assistant's tool-call turn to the conversation.
                    # OpenAI format expects an assistant message with the calls.
                    llm_messages.append(
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": tool_calls,
                        }
                    )

                    # Execute each tool call, surface it on the wire, and feed
                    # the result back as a `tool` message.
                    for tc in tool_calls:
                        name = tc["function"]["name"]
                        args_raw = tc["function"]["arguments"] or ""
                        try:
                            args = json.loads(args_raw) if args_raw else {}
                        except json.JSONDecodeError:
                            args = {}

                        yield _ndjson(
                            {
                                "type": "tool_call",
                                "name": name,
                                "arguments": args,
                            }
                        )

                        result = tools.execute(name, args)

                        yield _ndjson(
                            {
                                "type": "tool_result",
                                "name": name,
                                "result": result,
                            }
                        )

                        llm_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.get("id", ""),
                                "content": result,
                            }
                        )
            except GeneratorExit:
                # Client disconnected (e.g. Stop button) — don't persist the
                # partial reply and don't try to send a final `done` event.
                return
            if full_reply:
                _append_message("assistant", full_reply)
            yield _ndjson({"type": "done"})

        return StreamingResponse(event_stream(), media_type="application/x-ndjson")
    except Exception:
        raise HTTPException(
            status_code=502,
            detail=(
                "Cannot connect to llama.cpp server."
                "Make sure llama-cpp-python is running."
            ),
        )


@router.get("/api/chat")
def get_chat():
    """Load the saved messages."""
    return {"messages": _load_messages()}
