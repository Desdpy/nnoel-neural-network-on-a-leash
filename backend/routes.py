import sqlite3
from pathlib import Path

from config import AGENT_NAME, AGENT_SYSTEM_PROMPT
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from llama import generate_stream, get_llm

router = APIRouter()

# --- SQLite-based chat history ---
# Store chat messages in data/chat.db so the conversation persists across restarts
DB_DIR = Path(__file__).parent.parent / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = str(DB_DIR / "chat.db")


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


# --- API Endpoints ---

@router.get("/config")
def get_config():
    """Return agent display-name so the UI can show it."""
    return {"agent": {"name": AGENT_NAME}}


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


@router.post("/chat")
def chat(message: str = Body(..., embed=True)):
    """
    Stream a LLM response for the given user message.

    Accepts a plain string (the user's new message) and returns a
    text/plain SSE stream of tokens.  The backend owns the conversation
    history — it loads it from the DB, injects the system prompt, and
    persists both the user message and the assistant reply.
    """
    try:
        # 1. Save the user's message, then load the full history
        _append_message("user", message)
        history = _load_messages()

        # 2. Prepend the system prompt if one is configured
        llm_messages = (
            [{"role": "system", "content": AGENT_SYSTEM_PROMPT}] + history
            if AGENT_SYSTEM_PROMPT
            else history
        )

        # 3. Print what we're sending to the LLM (for debugging)
        print("--- LLM INPUT ---", flush=True)
        for i, m in enumerate(llm_messages):
            print(f"  [{i}][{m['role']}] {m['content'][:200]}", flush=True)

        # 4. Generator that streams tokens AND saves the full reply at the end
        def save_and_stream():
            full = ""
            for token in generate_stream(llm_messages):
                full += token
                yield token
            _append_message("assistant", full)

        return StreamingResponse(save_and_stream(), media_type="text/plain")
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
