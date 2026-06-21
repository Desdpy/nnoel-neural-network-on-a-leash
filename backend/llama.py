import json
import re
import threading
import uuid
from typing import Any

from config import (
    LLM_CHAT_TEMPLATE_KWARGS,
    LLM_MIN_P,
    LLM_MMPROJ_PATH,
    LLM_MODEL_PATH,
    LLM_N_CTX,
    LLM_N_THREADS,
    LLM_PRESENCE_PENALTY,
    LLM_REPEAT_PENALTY,
    LLM_TEMPERATURE,
    LLM_TOP_K,
    LLM_TOP_P,
)
from llama_cpp import Llama
from llama_cpp.llama_chat_format import get_chat_completion_handler
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


# Singleton — the LLM model is loaded once and cached here.
_llm: Llama | None = None

# Event that signals "the LLM is idle (not currently generating)".
# Used to serialise concurrent ``llm.create_chat_completion()`` calls
# so the second caller waits for the first to finish its current
# token before starting.  This is what makes barge-in work without
# a ``GGML_ASSERT`` crash: when the user starts speaking mid-response
# the new request's ``chat_stream`` blocks here until the old one's
# ``finally`` block fires and sets the event.  This is not a lock —
# the LLM is never actually held blocked, it just runs to completion
# naturally; the new caller just sleeps on the event until then.
_llm_idle: threading.Event = threading.Event()
_llm_idle.set()  # Idle at startup.


def _make_template_handler(handler: Any, extra_kwargs: dict[str, Any]) -> Any:
    """Wrap the default chat-template handler so extra kwargs (e.g. tokenizer
    settings from config) are injected on every call."""

    def wrapped(**kw: Any) -> Any:
        return handler(**{**kw, **extra_kwargs})

    return wrapped


def get_llm() -> Llama:
    """Lazy-load and return the singleton Llama model instance."""
    global _llm
    if _llm is None:
        # Build the model kwargs from configuration
        kwargs: dict[str, Any] = {
            "model_path": LLM_MODEL_PATH,
            "n_ctx": LLM_N_CTX,
            "verbose": True,
        }
        # Apply the configured thread count. Defaults to (total cores − TTS
        # threads) in config.py; override via [llama] n_threads in config.toml.
        if LLM_N_THREADS:
            kwargs["n_threads"] = int(LLM_N_THREADS)
        # Attach a multimodal projection file if one exists on disk
        if LLM_MMPROJ_PATH:
            kwargs["mmproj"] = LLM_MMPROJ_PATH
        _llm = Llama(**kwargs)

    # Override the chat template handler with extra kwargs if configured
    if LLM_CHAT_TEMPLATE_KWARGS:
        # `_llm.chat_format` is typed as `str | None` in the llama-cpp-python
        # stubs even though the Llama constructor always sets it to a string.
        chat_format: str = _llm.chat_format  # type: ignore[assignment]
        original = (
            _llm._chat_handlers.get(chat_format)  # type: ignore[attr-defined]
            or get_chat_completion_handler(chat_format)
        )
        _llm.chat_handler = _make_template_handler(
            original, LLM_CHAT_TEMPLATE_KWARGS
        )

    return _llm


def _sampling_kwargs() -> dict[str, Any]:
    """Build the dict of sampling parameters that are explicitly set in config."""
    gen_kwargs: dict[str, Any] = {}
    if LLM_TEMPERATURE is not None:
        gen_kwargs["temperature"] = LLM_TEMPERATURE
    if LLM_TOP_P is not None:
        gen_kwargs["top_p"] = LLM_TOP_P
    if LLM_TOP_K is not None:
        gen_kwargs["top_k"] = LLM_TOP_K
    if LLM_MIN_P is not None:
        gen_kwargs["min_p"] = LLM_MIN_P
    if LLM_PRESENCE_PENALTY is not None:
        gen_kwargs["presence_penalty"] = LLM_PRESENCE_PENALTY
    if LLM_REPEAT_PENALTY is not None:
        gen_kwargs["repeat_penalty"] = LLM_REPEAT_PENALTY
    return gen_kwargs


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
    PATTERNS: list[tuple[str, str, "re.Pattern[str]"]] = [
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


def chat_stream(
    messages: list[dict],
    tools: list[dict[str, Any]] | None = None,
):
    """Stream a single LLM chat-completion turn.

    Yields ``("token", str)`` for every text delta the model produces.

    If ``tools`` is provided and the model responds with one or more tool
    calls, yields a final ``("tool_calls", list[dict])`` event with the
    accumulated tool-call objects in OpenAI format::

        [{"id": "...", "type": "function",
          "function": {"name": "...", "arguments": "<json string>"}}]

    Tool calls are recognised from two sources, in this order of priority:

    1. llama-cpp-python's structured ``delta.tool_calls`` channel (used by
       chat templates with native tool-calling support).
    2. A text-based fallback that scans the streamed content for inline
       tool-call delimiters like ``<|tool_call|>call:NAME{ARGS}<tool_call|>``,
       used by models whose chat template advertises tools but doesn't
       actually parse the text into structured calls.

    If the model finishes with a normal text response, only ``token``
    events are yielded.  The caller is responsible for executing any tool
    calls and feeding the results back in a follow-up turn.
    """
    # Wait for any previous LLM call to finish its current token before
    # we start a new one.  llama-cpp-python's ggml state is not safe
    # for concurrent inference — two ``create_chat_completion`` calls
    # in flight at once triggers a ``GGML_ASSERT`` and aborts the
    # process.  We can't actually cancel the old call (the C-level
    # ``llama_decode`` is uninterruptible), but the old ``chat_stream``
    # generator's ``finally`` block will set ``_llm_idle`` as soon as
    # its current token finishes — so the new caller wakes up the
    # instant the LLM is actually idle, no fixed sleep needed.
    #
    # The 10-second timeout is purely a safety net in case something
    # goes wrong (e.g. the previous generator never reaches its
    # ``finally``); if the LLM is taking longer than that to produce a
    # token, something is already very wrong.
    if not _llm_idle.wait(timeout=10.0):
        log.warning(
            "LLM was still busy after 10s; starting new inference anyway"
        )
    # Mark the LLM as busy BEFORE we touch ``create_chat_completion``,
    # so any concurrent caller that arrives between the ``wait``
    # returning and the LLM actually starting will block on the next
    # ``wait`` instead of racing us into a double call.
    _llm_idle.clear()

    llm = get_llm()

    completion_kwargs: dict[str, Any] = {
        "messages": messages,  # type: ignore[arg-type]
        "stream": True,
        **_sampling_kwargs(),
    }
    if tools:
        completion_kwargs["tools"] = tools
        completion_kwargs["tool_choice"] = "auto"

    try:
        stream = llm.create_chat_completion(**completion_kwargs)

        # Tool-call deltas arrive split across chunks. We merge them by their
        # `index` field so a multi-tool-call response reassembles correctly.
        pending_tool_calls: list[dict[str, Any]] = []
        # Only enable the text-based parser when tools are actually being passed,
        # so the model isn't punished for talking *about* tools in plain text.
        text_parser = _TextToolCallParser() if tools else None

        for chunk in stream:
            choice = chunk.get("choices", [{}])[0]  # type: ignore[union-attr]
            delta = choice.get("delta", {}) or {}

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
                # Each field of ChatCompletionMessageToolCallChunk is optional, so
                # re-accessing via [] after a .get() truthiness check trips the
                # type checker. Bind to a local first.
                new_id = tc_delta.get("id")
                if new_id:
                    tc["id"] = new_id
                new_type = tc_delta.get("type")
                if new_type:
                    tc["type"] = new_type
                fn_delta = tc_delta.get("function")
                if fn_delta:
                    new_name = fn_delta.get("name")
                    if new_name:
                        tc["function"]["name"] += new_name
                    new_args = fn_delta.get("arguments")
                    if new_args:
                        tc["function"]["arguments"] += new_args

            # --- text content (with inline tool-call fallback) ---
            content = delta.get("content")
            if not content:
                continue
            if text_parser is None:
                yield ("token", content)
                continue

            # Once we've already seen a structured tool call, skip the text parser
            # so we don't double-detect. The chat template typically strips the
            # raw tool-call tokens from content in this case, but we belt-and-
            # brace it.
            saw_structured = bool(pending_tool_calls)
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
                                "arguments": json.dumps(args, ensure_ascii=False),
                            },
                        }
                    )

        # Drain any text the model emitted that wasn't part of a tool call.
        if text_parser is not None:
            for event in text_parser.flush():
                if event[0] == "token" and event[1]:
                    yield ("token", event[1])

        if pending_tool_calls:
            yield ("tool_calls", pending_tool_calls)
    finally:
        # Mark the LLM as idle.  This fires on every exit path:
        #   * normal completion (we fell off the end of the for-loop)
        #   * ``GeneratorExit`` from a client disconnect (the consumer
        #     in ``routes.py`` stopped iterating us, so the runtime
        #     raised ``GeneratorExit`` at the most recent ``yield``)
        #   * any exception inside the loop
        # In every case the LLM is now safe for the next caller —
        # whatever token it was computing has either been delivered
        # (normal) or is being thrown away (GeneratorExit) and the
        # ggml state is consistent.
        _llm_idle.set()


def generate_stream(messages: list[dict]):
    """Backwards-compatible plain-text stream: yields one text token at a time.

    Equivalent to ``chat_stream(messages)`` with all non-text events dropped.
    """
    for event in chat_stream(messages):
        if event[0] == "token":
            yield event[1]
