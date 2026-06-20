import base64
import concurrent.futures
import json
import queue
import sqlite3
import threading
from pathlib import Path
from typing import Any

import numpy as np
import tools
from config import (
    AGENT_NAME,
    AGENT_SYSTEM_PROMPT,
    TTS_FIRST_CHUNK_WORDS,
    TTS_MAX_CHARS,
    TTS_MIN_CHARS,
    TTS_WORKERS,
)
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from llama import chat_stream, get_llm
from log import get_logger
from text_chunker import TextChunker
from tts import get_tts, tts_disabled

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


def _float_to_int16_le(samples: np.ndarray) -> bytes:
    """Convert a float32 [-1, 1] PCM array to little-endian int16 bytes."""
    if samples.size == 0:
        return b""
    cleaned = np.nan_to_num(samples, nan=0.0)
    clipped = np.clip(cleaned, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


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
    - ``{"type": "audio", "seq": N, "fmt": "s16le", "sr": 22050,
       "ch": 1, "data": "<base64>"}`` — a TTS audio chunk
    - ``{"type": "audio_end"}`` — no more audio for this reply
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
            audio_seq = 0
            audio_emitted = False
            # Try to load the TTS model once per stream. If the model
            # failed to load (missing files, missing native deps) ``tts``
            # is None and we just skip audio for this request.
            tts = get_tts()
            tts_active = tts is not None and not tts_disabled()
            chunker = TextChunker(
                min_chars=TTS_MIN_CHARS,
                max_chars=TTS_MAX_CHARS,
                first_chunk_words=TTS_FIRST_CHUNK_WORDS,
            )
            # Audio chunks are produced by a pool of TTS worker threads.
            # sherpa-onnx releases the GIL during ONNX Runtime inference,
            # so multiple chunks can synthesise concurrently. ``pending``
            # tracks in-flight futures so we can wait for every audio
            # chunk to ship before the final ``done`` event.
            audio_q: queue.Queue = queue.Queue()
            pending: set[concurrent.futures.Future[None]] = set()
            pending_lock = threading.Lock()
            shutdown = threading.Event()

            def _synth_one(text: str) -> None:
                if shutdown.is_set() or tts is None:
                    return
                try:
                    result = tts.synthesize(text)
                except Exception as err:  # noqa: BLE001
                    log.warning(
                        "TTS synth failed for chunk %r: %s", text[:60], err
                    )
                    return
                if result is not None and not shutdown.is_set():
                    audio_q.put(result)

            executor = concurrent.futures.ThreadPoolExecutor(
                max_workers=TTS_WORKERS, thread_name_prefix="tts"
            )

            def submit_chunk(text: str) -> None:
                if not text or tts is None:
                    return
                fut = executor.submit(_synth_one, text)
                with pending_lock:
                    pending.add(fut)

                def _done(f: concurrent.futures.Future[None]) -> None:
                    with pending_lock:
                        pending.discard(f)

                fut.add_done_callback(_done)

            def drain_audio(blocking: bool) -> list[str]:
                """Build NDJSON strings for any audio ready on the queue.

                ``blocking=True`` waits for *all* pending futures to
                finish (up to 30s) so the caller can ensure every
                audio chunk for the assistant's reply is shipped before
                the final ``done`` event. ``blocking=False`` returns
                immediately and only emits whatever is already in the
                queue.
                """
                nonlocal audio_seq, audio_emitted
                if tts is None:
                    return []
                if blocking:
                    # Loop until every pending future is done. The
                    # first iteration may unblock as soon as the
                    # earliest future completes, but we then keep
                    # waiting for the rest. Without this loop we
                    # could return after a single chunk and silently
                    # drop the rest of the reply's audio.
                    while True:
                        with pending_lock:
                            wait_for = list(pending)
                        if not wait_for:
                            break
                        concurrent.futures.wait(
                            wait_for,
                            timeout=30.0,
                            return_when=concurrent.futures.ALL_COMPLETED,
                        )
                out: list[str] = []
                while True:
                    try:
                        result = audio_q.get_nowait()
                    except queue.Empty:
                        break
                    pcm_bytes = _float_to_int16_le(result.samples)
                    out.append(
                        _ndjson(
                            {
                                "type": "audio",
                                "seq": audio_seq,
                                "fmt": "s16le",
                                "sr": result.sample_rate,
                                "ch": 1,
                                "data": base64.b64encode(pcm_bytes).decode("ascii"),
                            }
                        )
                    )
                    audio_seq += 1
                    audio_emitted = True
                return out

            try:
                for _ in range(MAX_TOOL_ITERATIONS):
                    tool_calls: list[dict[str, Any]] = []
                    chunker.reset()

                    for event in chat_stream(llm_messages, tools=tools.TOOLS or None):
                        kind = event[0]
                        if kind == "token":
                            # ``chat_stream`` yields a discriminated tuple
                            # (("token", str) or ("tool_calls", list)); the
                            # type checker can't narrow ``event[1]`` from the
                            # first element alone, so we assert and rebind.
                            assert isinstance(event[1], str)
                            text = event[1]
                            full_reply += text
                            yield _ndjson({"type": "token", "content": text})
                            if tts_active:
                                for chunk in chunker.feed(text):
                                    submit_chunk(chunk)
                                # While the LLM is generating the next
                                # token, ship any audio that finished
                                # synthesizing so the listener keeps up
                                # with the text in near real time.
                                for nd in drain_audio(blocking=False):
                                    yield nd
                        elif kind == "tool_calls":
                            assert isinstance(event[1], list)
                            tool_calls = event[1]

                    if not tool_calls:
                        # Model produced a final text answer — flush the
                        # chunker tail and drain any pending audio before
                        # falling through to the ``done`` event below.
                        tail = chunker.flush()
                        if tail and tts_active:
                            submit_chunk(tail)
                        for nd in drain_audio(blocking=True):
                            yield nd
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
                    # Drop any half-speakable text from this iteration
                    # so the next round of LLM output starts with a
                    # clean chunker. We do not want the assistant's
                    # narration to bleed into a tool-call round.
                    chunker.reset()
            except GeneratorExit:
                # Client disconnected (e.g. Stop button) — don't persist
                # the partial reply, don't try to send a final ``done``
                # event, and stop the TTS worker so it doesn't keep
                # synthesizing audio nobody will hear.
                shutdown.set()
                executor.shutdown(wait=False, cancel_futures=True)
                return
            if tts_active and audio_emitted:
                yield _ndjson({"type": "audio_end"})
            if full_reply:
                _append_message("assistant", full_reply)
            yield _ndjson({"type": "done"})

        return StreamingResponse(event_stream(), media_type="application/x-ndjson")
    except Exception as err:
        log.exception("Failed to start chat stream")
        raise HTTPException(
            status_code=502,
            detail=(
                "Failed to start chat stream. " 
                "The language model may not be loaded yet."
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
