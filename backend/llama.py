import json
import re
import threading
import uuid
from typing import Any, ClassVar

import httpx
from config import LLAMA_SERVER_API_KEY, LLAMA_SERVER_URL, LLM_MODEL_NAME
from log import get_logger

log = get_logger("llama")


def _gemma_args_to_json(s: str) -> str:
    """Normalise Gemma's tool-call arg syntax to standard JSON.

    The Gemma chat template wraps string values in ``<|"|>`` instead of ``"``
    and emits property keys as bare identifiers (e.g. ``timezone:`` rather
    than ``"timezone":``). To turn what the model streamed into something
    ``json.loads`` understands we (1) swap the string delimiters, then (2)
    wrap any bare key (a word immediately preceded by ``{``/``,`` and
    followed by ``:``) in double quotes.
    """
    s = s.replace('<|"|>', '"')
    # Quote unquoted keys.  The lookbehind-style constraint is encoded by
    # requiring `{` or `,` immediately before the word — so a bare word
    # inside an already-quoted string value can't be mistaken for a key.
    s = re.sub(r"([{,]\s*)([A-Za-z_]\w*)(\s*:)", r'\1"\2"\3', s)
    return s


class _TextToolCallParser:
    """Detect tool calls emitted inline as text by models that don't go through
    llama-cpp-python's structured ``delta.tool_calls`` channel.

    Some chat templates (Gemma 4, Mistral 7B v0.3 and similar) advertise tools
    in the system prompt but still let the model emit the call inline using
    delimiter pairs like ``<|tool_call|>call:NAME{ARGS}<tool_call|>`` or
    ``<tool_call>NAME{ARGS}</tool_call>``. This parser scans the streamed
    content for those delimiters, parses the function name + JSON args, and
    converts them into structured tool-call objects so the rest of the
    pipeline (routes.py, the tool registry) can handle them uniformly.

    Feed content deltas with :meth:`feed` (a generator that yields
    ``("token", str)`` and ``("tool_call", (name, args))`` events), then call
    :meth:`flush` once the upstream stream ends to emit any text the model
    produced that wasn't part of a tool call.
    """

    # (open_delim, close_delim, body_regex)
    # Body regex must capture (1) the function name and (2) the JSON args.
    # ClassVar: this is an immutable lookup table shared by every
    # instance, never rebound or mutated per-instance — annotating it
    # says so explicitly and keeps type checkers from flagging the list
    # default (or, worse, suggesting it move into ``__init__``, which
    # would rebuild the compiled regexes for every parser instance).
    PATTERNS: ClassVar[list[tuple[str, str, "re.Pattern[str]"]]] = [
        # Gemma 4 (this fine-tune, unsloth's quant): the open and close are
        # shorter than the spec — one fewer `|` on each side:
        #   <|tool_call>call:NAME{ARGS}<tool_call|>
        # Listed first because it's what the active model actually emits.
        (
            "<|tool_call>",
            "<tool_call|>",
            re.compile(r"^\s*(?:call:)?([a-zA-Z0-9_]+)\s*(\{.*\})\s*$", re.DOTALL),
        ),
        # Standard Gemma / Mistral-7B-Instruct v0.3:
        #   <|tool_call|>call:NAME{ARGS}<tool_call|>
        # Asymmetric delimiters — the open has | on both sides, the close
        # only on the right.
        (
            "<|tool_call|>",
            "<tool_call|>",
            re.compile(r"^\s*(?:call:)?([a-zA-Z0-9_]+)\s*(\{.*\})\s*$", re.DOTALL),
        ),
        # Hermes-style:
        #   <tool_call>NAME{ARGS}</tool_call>
        (
            "<tool_call>",
            "</tool_call>",
            re.compile(r"^\s*([a-zA-Z0-9_]+)\s*(\{.*\})\s*$", re.DOTALL),
        ),
    ]

    def __init__(self) -> None:
        self._buffer = ""
        # Index into PATTERNS for the open/close delimiters we're currently
        # looking at, or -1 if we're not inside any tool-call block.
        self._in_call = -1
        # The open delimiter for the call we're currently inside, kept so
        # ``flush()`` can re-emit it (with the partial body) if the stream
        # ends before a close is seen.
        self._current_open: str = ""

    @staticmethod
    def _hold_back(buffer: str) -> int:
        """How many trailing chars of ``buffer`` could be a partial prefix of
        an open delimiter and therefore must not be emitted as a token yet.

        When the upstream emits the delimiter one token at a time, a partial
        match like ``<|tool_c`` could grow into ``<|tool_call|>`` on the
        next read; if we flushed it eagerly the user would see stray
        ``<|tool_c`` characters in the chat. Holding it back keeps the UI
        output clean.
        """
        max_hold = 0
        for open_d, _, _ in _TextToolCallParser.PATTERNS:
            # Only consider prefixes shorter than the full delimiter — a
            # complete match would already have been found by str.find().
            upper = min(len(open_d) - 1, len(buffer))
            for k in range(1, upper + 1):
                if buffer.endswith(open_d[:k]):
                    max_hold = max(max_hold, k)
        return max_hold

    @property
    def found_call(self) -> bool:
        """True once a complete tool call has been parsed in this stream."""
        return self._in_call != -1 or self._buffer == ""

    def feed(self, text: str):
        """Consume a content delta and yield normalised events."""
        self._buffer += text
        while True:
            if self._in_call == -1:
                # Outside any tool-call block — scan for the next opener.
                best_open: tuple[int, int] | None = None  # (index, pattern_idx)
                for idx, (open_d, _, _) in enumerate(self.PATTERNS):
                    pos = self._buffer.find(open_d)
                    if pos != -1 and (best_open is None or pos < best_open[0]):
                        best_open = (pos, idx)
                if best_open is None:
                    # No full opener yet — emit everything except a possible
                    # partial prefix at the tail.
                    hold = self._hold_back(self._buffer)
                    cut = len(self._buffer) - hold
                    if cut > 0:
                        yield ("token", self._buffer[:cut])
                        self._buffer = self._buffer[cut:]
                    return
                open_pos, pat_idx = best_open
                if open_pos > 0:
                    yield ("token", self._buffer[:open_pos])
                self._current_open = self.PATTERNS[pat_idx][0]
                self._buffer = self._buffer[open_pos + len(self._current_open) :]
                self._in_call = pat_idx
                # fall through to look for the matching close

            open_d, close_d, body_re = self.PATTERNS[self._in_call]
            close_pos = self._buffer.find(close_d)
            if close_pos == -1:
                return  # wait for more tokens
            body = self._buffer[:close_pos]
            self._buffer = self._buffer[close_pos + len(close_d) :]
            self._in_call = -1
            self._current_open = ""

            match = body_re.match(body)
            if match:
                name = match.group(1)
                args_raw = match.group(2) or ""
                # Gemma's chat template wraps string arguments in <|"|>
                # and leaves keys unquoted. Normalise to JSON before parsing
                # so {"timezone": "Asia/Tokyo"} survives the round trip.
                args_json = _gemma_args_to_json(args_raw)
                try:
                    args = json.loads(args_json) if args_json.strip() else {}
                except json.JSONDecodeError as err:
                    log.warning(
                        "Tool call %r had invalid JSON args, falling back to {}: %s",
                        name,
                        err,
                    )
                    args = {}
                yield ("tool_call", (name, args))
            else:
                # The body didn't look like a recognised call — surface the
                # raw text to the user instead of silently dropping it.
                yield ("token", open_d + body + close_d)

    def flush(self):
        """Emit any text the model produced that wasn't part of a tool call.

        If the stream ends mid-tool-call (open delimiter seen but no close),
        the open delimiter + partial body is surfaced as plain text so the
        user can see what the model was attempting.
        """
        if self._in_call != -1 and self._buffer:
            yield ("token", self._current_open + self._buffer)
            self._buffer = ""
            self._in_call = -1
            self._current_open = ""
        elif self._buffer:
            yield ("token", self._buffer)
            self._buffer = ""


_llm_idle = threading.Event()
_llm_idle.set()
_client: httpx.Client | None = None


def get_llm() -> httpx.Client:
    global _client
    if _client is None:
        headers = {"Content-Type": "application/json"}
        if LLAMA_SERVER_API_KEY:
            headers["Authorization"] = f"Bearer {LLAMA_SERVER_API_KEY}"
        _client = httpx.Client(
            base_url=LLAMA_SERVER_URL.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0),
        )
    return _client


def chat_stream(messages, tools=None):
    if not _llm_idle.wait(timeout=10.0):
        log.warning("llama-server still busy after 10s")
    _llm_idle.clear()
    client = get_llm()

    payload: dict[str, Any] = {
        "model": LLM_MODEL_NAME,
        "messages": messages,
        "stream": True,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    try:
        pending_tool_calls: list[dict] = []
        text_parser = _TextToolCallParser() if tools else None
        saw_structured = False

        with client.stream("POST", "/v1/chat/completions", json=payload) as resp:
            resp.raise_for_status()
            data_buf = bytearray()
            done = False
            for chunk in resp.iter_bytes():
                if done or not chunk:
                    continue
                data_buf.extend(chunk)
                while True:
                    sep = data_buf.find(b"\n\n")
                    if sep == -1:
                        break
                    raw_event = bytes(data_buf[:sep])
                    del data_buf[: sep + 2]

                    data_line = None
                    for line in raw_event.splitlines():
                        s = line.strip()
                        if s.startswith(b"data:"):
                            data_line = s[len(b"data:") :].strip()
                    if data_line is None:
                        continue
                    if data_line == b"[DONE]":
                        done = True
                        break

                    try:
                        chunk = json.loads(data_line)
                    except json.JSONDecodeError:
                        continue

                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}

                    # --- structured tool-call deltas (preferred path) ---
                    for tc_delta in delta.get("tool_calls") or []:
                        idx = tc_delta.get("index", 0)
                        while len(pending_tool_calls) <= idx:
                            pending_tool_calls.append(
                                {
                                    "id": "",
                                    "type": "function",
                                    "function": {"name": "", "arguments": ""},
                                }
                            )
                        tc = pending_tool_calls[idx]
                        if tc_delta.get("id"):
                            tc["id"] = tc_delta["id"]
                        if tc_delta.get("type"):
                            tc["type"] = tc_delta["type"]
                        fn_delta = tc_delta.get("function") or {}
                        if fn_delta.get("name"):
                            tc["function"]["name"] += fn_delta["name"]
                        if fn_delta.get("arguments"):
                            tc["function"]["arguments"] += fn_delta["arguments"]
                        saw_structured = bool(pending_tool_calls)

                    # --- text content (with text-parser fallback) ---
                    content = delta.get("content")
                    if not content:
                        continue
                    if text_parser is None:
                        yield ("token", content)
                        continue
                    for event in text_parser.feed(content):
                        if event[0] == "token":
                            yield ("token", event[1])
                        elif event[0] == "tool_call" and not saw_structured:
                            name, args = event[1]
                            pending_tool_calls.append(
                                {
                                    "id": f"call_{uuid.uuid4().hex[:8]}",
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": json.dumps(
                                            args, ensure_ascii=False
                                        ),
                                    },
                                }
                            )

                if done:
                    break

        if text_parser is not None:
            for event in text_parser.flush():
                if event[0] == "token" and event[1]:
                    yield ("token", event[1])

        if pending_tool_calls:
            yield ("tool_calls", pending_tool_calls)
    finally:
        _llm_idle.set()


def generate_stream(messages):
    for event in chat_stream(messages):
        if event[0] == "token":
            yield event[1]
