import json
import sqlite3
from pathlib import Path
from typing import Any

import tools
from config import AGENT_NAME, AGENT_SYSTEM_PROMPT
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from llama import chat_stream, get_llm
from log import get_logger

log = get_logger("routes")

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
        "  meta TEXT DEFAULT '{}',"
        "  created_at TEXT DEFAULT (datetime('now'))"
        ")"
    )
    # Migrate older DBs that don't have the ``meta`` column. ALTER TABLE
    # ADD COLUMN fails if the column already exists, so swallow that case.
    try:
        conn.execute(
            "ALTER TABLE messages ADD COLUMN meta TEXT DEFAULT '{}'"
        )
    except sqlite3.OperationalError as err:
        # Column already exists — expected on every run after the first.
        log.debug("meta column already present: %s", err)
    return conn


def _load_messages() -> list[dict]:
    """Load the most recent 10 messages in chronological order.

    For tool_call / tool_result rows the stored ``meta`` blob is merged
    into the returned dict so callers see a flat shape::
        {"role": "tool_call", "content": "", "name": "...",
         "arguments": {...}, "tool_call_id": "..."}
    """
    conn = _get_db()
    rows = conn.execute(
        "SELECT role, content, meta FROM messages ORDER BY id DESC LIMIT 10"
    ).fetchall()
    conn.close()
    out: list[dict] = []
    for r in reversed(rows):
        msg: dict = {"role": r["role"], "content": r["content"]}
        try:
            meta = json.loads(r["meta"]) if r["meta"] else {}
        except json.JSONDecodeError as err:
            log.warning("Corrupt meta JSON in DB row (id=%s): %s", r["id"], err)
            meta = {}
        if meta:
            msg.update(meta)
        out.append(msg)
    return out


def _append_message(role: str, content: str, meta: dict | None = None) -> None:
    """Persist a single message (user, assistant, tool_call, tool_result).

    ``meta`` is stored as a JSON blob and merged back into the message
    dict by ``_load_messages``, so tool-specific fields (name, arguments,
    extra, tool_call_id) survive a page reload.
    """
    conn = _get_db()
    conn.execute(
        "INSERT INTO messages (role, content, meta) VALUES (?, ?, ?)",
        (role, content, json.dumps(meta or {})),
    )
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


@router.get("/tools/timezones/locations")
def list_location_suggestions():
    """List the location strings the get_local_time tool can resolve.

    Used by the Time panel's autocomplete to surface suggestions while the
    user is typing. Each entry is a single location string (country,
    continent, city, or alias) the :func:`tools.timezones.resolve` helper
    understands. The list is returned sorted (case-insensitive) so the
    frontend can render it without a second pass.
    """
    from tools.timezones import _TIMEZONE_MAP  # noqa: PLC0415

    return {"locations": sorted(_TIMEZONE_MAP.keys(), key=str.lower)}


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
    except Exception as err:
        log.warning("LLM not ready for /ping: %s", err)
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
                        except json.JSONDecodeError as err:
                            log.warning(
                                "Tool call for %r had invalid JSON args, "
                                "falling back to {}: %s",
                                name,
                                err,
                            )
                            args = {}
                        tool_call_id = tc.get("id", "")

                        yield _ndjson(
                            {
                                "type": "tool_call",
                                "name": name,
                                "arguments": args,
                            }
                        )
                        # Persist the tool call so it appears in the chat
                        # history after a reload. The user/assistant turn
                        # is written separately (above / below the loop),
                        # but the tool steps are part of the assistant
                        # turn and need their own rows.
                        _append_message(
                            "tool_call",
                            "",
                            {
                                "name": name,
                                "arguments": args,
                                "tool_call_id": tool_call_id,
                            },
                        )

                        try:
                            result = tools.execute(name, args)
                        except Exception as err:
                            # Don't let a buggy tool kill the whole stream.
                            # Surface the error as a tool_result so the LLM
                            # can react to it instead of looping forever.
                            log.exception("Tool %r raised; emitting error result", name)
                            yield _ndjson(
                                {
                                    "type": "tool_result",
                                    "name": name,
                                    "arguments": args,
                                    "result": f"Tool error: {err}",
                                    "extra": {},
                                }
                            )
                            _append_message(
                                "tool_result",
                                f"Tool error: {err}",
                                {"name": name, "tool_call_id": tool_call_id, "extra": {}},
                            )
                            llm_messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tc.get("id", ""),
                                    "content": f"Tool error: {err}",
                                }
                            )
                            continue
                        # Some tools (e.g. get_local_time) return a structured
                        # dict with a ``text`` field for the LLM and extra
                        # metadata for the UI. Collapse to the text so the
                        # chat-completion API still sees a plain string, and
                        # surface the extras on the wire so the UI can open
                        # a dedicated panel for the tool.
                        if isinstance(result, dict) and "text" in result:
                            llm_text: str = result["text"]
                            extra = {k: v for k, v in result.items() if k != "text"}
                        else:
                            llm_text = str(result)
                            extra = {}

                        yield _ndjson(
                            {
                                "type": "tool_result",
                                "name": name,
                                "arguments": args,
                                "result": llm_text,
                                "extra": extra,
                            }
                        )
                        _append_message(
                            "tool_result",
                            llm_text,
                            {
                                "name": name,
                                "tool_call_id": tool_call_id,
                                "extra": extra,
                            },
                        )

                        llm_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.get("id", ""),
                                "content": llm_text,
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
    except Exception as err:
        log.exception("Failed to start chat stream")
        raise HTTPException(
            status_code=502,
            detail=(
                "Cannot connect to llama.cpp server."
                "Make sure llama-cpp-python is running."
            ),
        ) from err


@router.get("/api/chat")
def get_chat(
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=10, ge=1, le=200),
):
    """Load a page of saved messages in chronological order.

    The first call (no ``before``) returns the most recent ``limit``
    messages. Subsequent calls pass ``before=<id of the oldest message
    already loaded>`` to fetch the page immediately preceding the
    current view. The response includes ``hasMore`` so the UI knows
    when it has reached the start of the history.
    """
    conn = _get_db()
    if before is None:
        rows = conn.execute(
            "SELECT id, role, content, meta FROM messages ORDER BY id DESC LIMIT ?",
            (limit + 1,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, role, content, meta FROM messages "
            "WHERE id < ? ORDER BY id DESC LIMIT ?",
            (before, limit + 1),
        ).fetchall()
    conn.close()

    has_more = len(rows) > limit
    rows = rows[:limit]
    # ``rows`` is ordered newest-first, so the cursor for the next page
    # (``firstId``) is the *last* element of the trimmed list — the
    # oldest message in this page.
    messages: list[dict] = []
    for r in reversed(rows):
        msg: dict = {"role": r["role"], "content": r["content"]}
        try:
            meta = json.loads(r["meta"]) if r["meta"] else {}
        except json.JSONDecodeError as err:
            log.warning("Corrupt meta JSON in DB row (id=%s): %s", r["id"], err)
            meta = {}
        if meta:
            msg.update(meta)
        msg["id"] = str(r["id"])
        messages.append(msg)
    first_id = rows[-1]["id"] if rows else None
    return {"messages": messages, "hasMore": has_more, "firstId": first_id}


@router.post("/tools/{name}")
def run_tool(name: str, arguments: dict[str, Any] = Body(default={})):
    """Run a registered tool by name with the given arguments and return its result.

    Exposes the same tool registry the LLM uses, so the UI can let users
    invoke tools directly (e.g. the Time panel in the dock). Tools that
    return a dict with a ``text`` field are unwrapped to that text and
    the extra keys are surfaced under ``extra`` so the UI can keep the
    seconds ticking locally without re-fetching.
    """
    try:
        result = tools.execute(name, arguments or {})
    except Exception:
        log.exception("Direct tool invocation failed: name=%r", name)
        raise
    if isinstance(result, dict) and "text" in result:
        text: Any = result["text"]
        extra = {k: v for k, v in result.items() if k != "text"}
        return {"result": text, "extra": extra}
    return {"result": result, "extra": {}}
