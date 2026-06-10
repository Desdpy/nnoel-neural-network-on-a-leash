import sqlite3
from pathlib import Path

from config import AGENT_NAME
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from llama import generate_stream, get_llm

router = APIRouter()

DB_DIR = Path(__file__).parent.parent / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = str(DB_DIR / "chat.db")


def _get_db() -> sqlite3.Connection:
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
    conn = _get_db()
    rows = conn.execute(
        "SELECT role, content FROM messages ORDER BY id DESC LIMIT 50"
    ).fetchall()
    conn.close()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


def _append_message(role: str, content: str) -> None:
    conn = _get_db()
    conn.execute("INSERT INTO messages (role, content) VALUES (?, ?)", (role, content))
    conn.commit()
    conn.close()


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
def chat(messages: list[dict] = Body(..., embed=True)):
    """
    Stream a LLM response for the given conversation history.

    Accepts a list of {role, content} messages and returns a
    text/plain SSE stream of tokens.  Returns 502 if the
    llama.cpp back-end is unreachable.
    """
    try:
        if messages:
            _append_message(messages[-1]["role"], messages[-1]["content"])

        def save_and_stream():
            full = ""
            for token in generate_stream(messages):
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



