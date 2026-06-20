"""Stream-buffer for LLM text tokens, chunked on natural prosody boundaries.

The LLM streams one token fragment at a time (often sub-word). We
accumulate those fragments into "speakable units" — short phrases that
end on punctuation cues — and hand each unit to the TTS engine. The
chunker is deliberately small: it is stateful (carries a tail buffer
between calls) but not thread-safe. ``routes.py`` instantiates one
per chat stream and feeds it the same ``(str)`` content that goes out
on the ``token`` wire event.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# Boundary cues — keep these conservative. Each match consumes the
# matched character so the next chunk starts cleanly. Using regex
# rather than ``str.endswith`` makes the order of evaluation explicit
# and easy to extend (e.g. add em-dash later).
_BOUNDARY_RE = re.compile(
    r"""
      (?P<hard>     [.!?]+[\s\u2014\u2013]+ )   # sentence terminator + space/dash
    | (?P<soft>     [,;:][\s]+ )               # clause break + space
    | (?P<newline>  \n+ )
    """,
    re.VERBOSE,
)


@dataclass
class TextChunker:
    """Accumulates streaming text and yields finished chunks.

    Two thresholds gate emission:

    * ``min_chars`` — once a chunk reaches this many characters, any
      soft boundary (comma, semicolon) is enough to flush it. Below
      this threshold, only hard boundaries flush.
    * ``max_chars`` — never buffer more than this. If we hit it without
      seeing a boundary, flush at the next space (or hard-cut if no
      space exists, which is exceedingly rare for LLM text).

    The first chunk of a stream uses a smaller threshold (typically
    just a few words) so the listener hears Nnoel start talking as
    soon as possible. After the first emission the steady-state
    thresholds take over.
    """

    min_chars: int = 12
    max_chars: int = 140
    first_chunk_words: int = 4
    _buffer: str = field(default="", init=False, repr=False)
    _emitted: int = field(default=0, init=False, repr=False)
    # Pre-compiled threshold patterns
    _word_count_re: re.Pattern[str] = field(
        default=re.compile(r"\S+"), init=False, repr=False
    )

    # -- internal helpers -------------------------------------------------

    def _word_count(self, s: str) -> int:
        return sum(1 for _ in self._word_count_re.finditer(s))

    def _take(self, end: int) -> str:
        piece = self._buffer[:end].strip()
        self._buffer = self._buffer[end:].lstrip()
        return piece

    def _split_at_space(self, s: str, limit: int) -> tuple[str, str]:
        """Split ``s`` at the last space at or before ``limit``.

        Returns ``(head, tail)`` with both stripped. Falls back to a
        hard cut if no space exists before ``limit`` (very rare).
        """
        if len(s) <= limit:
            return s, ""
        cut = s.rfind(" ", 0, limit + 1)
        if cut <= 0:
            cut = limit
        return s[:cut].strip(), s[cut:].lstrip()

    # -- public API --------------------------------------------------------

    def feed(self, text: str) -> list[str]:
        """Append a token fragment and return any chunks ready to speak.

        ``text`` is a single LLM token delta (may be empty). The
        returned list contains zero or more finished chunks. The
        remaining text (if any) is kept in the internal buffer and
        will be returned by a future call to :meth:`feed` or
        :meth:`flush`.
        """
        if not text:
            return []
        self._buffer += text
        chunks: list[str] = []

        # Hard cap — if we are well over the max, force-emit a slice.
        if len(self._buffer) > self.max_chars:
            head, tail = self._split_at_space(self._buffer, self.max_chars)
            if head:
                chunks.append(head)
                self._buffer = tail
                self._emitted += 1
                return chunks

        # Walk boundary matches left-to-right and slice the buffer.
        # We re-search every call so newly arrived text gets a chance
        # to land on a boundary.
        while True:
            m = _BOUNDARY_RE.search(self._buffer)
            if m is None:
                break
            end = m.end()
            candidate = self._buffer[:end].strip()
            if not candidate:
                # Boundary matched a stray separator (e.g. just spaces);
                # consume it and keep scanning.
                self._buffer = self._buffer[end:]
                continue

            if self._emitted == 0:
                # First chunk: lower the bar so audio starts quickly.
                # Hard sentence terminators always emit (the user should
                # hear *something* on the first sentence, however
                # short); soft clause breaks wait until we've seen
                # enough words to sound natural.
                if m.group("hard") or m.group("newline"):
                    chunks.append(self._take(end))
                    self._emitted += 1
                    continue
                if self._word_count(candidate) >= self.first_chunk_words:
                    chunks.append(self._take(end))
                    self._emitted += 1
                    continue
            else:
                # Steady state: any boundary past min_chars flushes;
                # hard terminators always flush.
                if m.group("hard") or m.group("newline"):
                    chunks.append(self._take(end))
                    self._emitted += 1
                    continue
                if m.group("soft") and len(candidate) >= self.min_chars:
                    chunks.append(self._take(end))
                    self._emitted += 1
                    continue
            # Not ready to flush at this boundary — wait for more text.
            break

        return chunks

    def flush(self) -> str:
        """Return whatever is left in the buffer as the final chunk.

        Call this exactly once at the end of a stream (e.g. after the
        LLM yields ``done``). An empty buffer returns an empty string.
        """
        if not self._buffer:
            return ""
        piece = self._buffer.strip()
        self._buffer = ""
        return piece

    def reset(self) -> None:
        """Forget the buffer — used between tool-call iterations."""
        self._buffer = ""
        self._emitted = 0
