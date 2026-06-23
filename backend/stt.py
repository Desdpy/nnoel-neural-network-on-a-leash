"""Speech-to-text engine (Parakeet TDT 0.6B v3 int8 + Silero VAD via sherpa-onnx).

The project uses NeMo Parakeet TDT 0.6B v3 (int8) as the offline speech
recognizer, fronted by Silero VAD for voice-activity detection.  Both run
through the same ``sherpa-onnx`` Python package the TTS engine already
uses, so no new native dependencies are required.

Parakeet TDT is one of the strongest open multilingual ASR models —
``~2%`` WER on English LibriSpeech — and the v3 release covers 25
European languages (en, de, fr, es, it, pt, nl, pl, ru, uk, etc.).
The int8 quantized ONNX bundle is ``~640 MB`` extracted and runs at
RTF ``~0.2`` on a single modern x86 CPU thread, so it coexists with
the LLM and Piper TTS on an 8-thread machine without contention.

For spoken-language identification (so the server can report which
of the 25 languages a given utterance was actually spoken in), a
small Whisper-tiny multilingual int8 model is run on each segment
right after transcription.  It covers ~30 languages, is ~98 MB
extracted, and runs at ~RTF 0.04 on a single x86 CPU thread, so it
adds <100 ms per utterance to the pipeline.  See :class:`LidEngine`.

This module owns:

* Loading the ONNX recognizer, VAD model, and (optionally) LID model
  lazily (so the server can boot even if the model files are
  missing — ``get_stt()`` then returns ``None`` and the WebSocket
  endpoint rejects connections).
* :class:`SttEngine`, a thread-safe wrapper around the
  ``OfflineRecognizer`` used to transcribe individual audio segments,
  plus the optional :class:`LidEngine` for language detection.
* :class:`SttSession`, a stateful per-WebSocket connection that owns a
  Silero ``VoiceActivityDetector`` and produces ``SttEvent`` items as
  the user speaks.

``routes.py`` drives the WebSocket pipeline: binary audio frames from
the browser feed into an ``SttSession``, the session returns a list of
events (speech-start, final with detected ``lang``), and the route
ships those events back to the browser as JSON.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from config import (
    LID_ENABLED,
    LID_MODEL_DIR,
    LID_NUM_THREADS,
    STT_ENABLED,
    STT_LANGUAGE,
    STT_MODEL_DIR,
    STT_MODEL_TYPE,
    STT_NUM_THREADS,
    STT_VAD_MAX_SPEECH,
    STT_VAD_MIN_SILENCE,
    STT_VAD_MIN_SPEECH,
    STT_VAD_MODEL,
    STT_VAD_THRESHOLD,
)
from log import get_logger

log = get_logger("stt")

# Parakeet expects 16 kHz mono audio with 80-dim log-mel features.
# Browsers are responsible for resampling to this rate; the backend
# treats incoming bytes as raw int16-LE PCM at this sample rate.
SAMPLE_RATE = 16000


def stt_disabled() -> bool:
    """True when the server should skip STT entirely."""
    return not STT_ENABLED


@dataclass
class SttEvent:
    """One event the WebSocket emits back to the browser.

    ``type`` values:
    * ``"speech_start"`` — VAD detected the beginning of a new utterance.
    * ``"final"`` — the complete utterance has been transcribed with
      Parakeet and will not change further.  ``text`` is non-empty.
      ``lang`` is the 2-letter ISO 639-1 code returned by the LID
      model (``"en"``, ``"de"``, ``"fr"``, …) or ``None`` when LID
      is disabled or the model couldn't classify the utterance.

    The wire format mirrors these fields directly — the route
    serialises the dataclass via :func:`_event_to_wire_dict`.
    """

    type: str
    text: str = ""
    lang: str | None = None


def _event_to_wire_dict(event: SttEvent) -> dict:
    """Serialise an :class:`SttEvent` to the JSON dict the browser sees.

    ``lang`` is only included for ``"final"`` events (it's the only
    event type that can carry a language).  Other event types send
    the legacy ``{"type", "text"}`` shape so existing clients keep
    working.
    """
    wire: dict = {"type": event.type, "text": event.text}
    if event.type == "final":
        wire["lang"] = event.lang
    return wire


class LidEngine:
    """Spoken-language identification via sherpa-onnx's Whisper-tiny int8.

    Wraps :class:`sherpa_onnx.SpokenLanguageIdentification` so the rest
    of the STT pipeline can ask ``engine.detect_language(samples)``
    and get back a 2-letter ISO 639-1 code (``"en"``, ``"de"``, …) or
    ``None`` when the audio is empty / unclassifiable.

    sherpa-onnx releases the GIL during ONNX Runtime inference, so a
    single ``LidEngine`` is safe to call from multiple WebSocket
    sessions concurrently.  The model state itself is stateless
    (Whisper is fed the whole utterance at once), so we don't need
    per-session ``OnlineStream`` bookkeeping like the Parakeet
    recognizer.

    The class is also a no-op (``enabled=False``) when the model
    files are missing or ``LID_ENABLED`` is false in config — in
    that case :meth:`detect_language` always returns ``None`` and
    pays no inference cost.
    """

    def __init__(self, model_dir: str, num_threads: int, enabled: bool) -> None:
        import sherpa_onnx

        self._slid: sherpa_onnx.SpokenLanguageIdentification | None = None
        if not enabled:
            log.info("LID disabled in config")
            return

        model_path = Path(model_dir)
        # Whisper-tiny bundle filenames: tiny-encoder.int8.onnx,
        # tiny-decoder.int8.onnx, tiny-tokens.txt.  Any missing
        # file degrades to a no-op (logged once at startup) so the
        # server keeps working without LID rather than refusing to
        # boot.
        encoder = model_path / "tiny-encoder.int8.onnx"
        decoder = model_path / "tiny-decoder.int8.onnx"
        tokens = model_path / "tiny-tokens.txt"
        for path in (encoder, decoder, tokens):
            if not path.exists():
                log.warning(
                    "LID model file missing: %s — language detection disabled. "
                    "Download sherpa-onnx-whisper-tiny or set [lid] enabled=false.",
                    path,
                )
                return

        log.info(
            "loading Whisper-tiny LID via sherpa-onnx (num_threads=%d model=%s)",
            num_threads,
            model_path.name,
        )
        config = sherpa_onnx.SpokenLanguageIdentificationConfig(
            whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
                encoder=str(encoder),
                decoder=str(decoder),
            ),
            num_threads=num_threads,
            provider="cpu",
        )
        self._slid = sherpa_onnx.SpokenLanguageIdentification(config)

    @property
    def enabled(self) -> bool:
        """True when the model is loaded and ready to detect."""
        return self._slid is not None

    def detect_language(self, samples) -> str | None:
        """Return the 2-letter ISO 639-1 code for ``samples`` or ``None``.

        ``samples`` is mono float32 in ``[-1, 1]`` at :data:`SAMPLE_RATE`.
        Returns ``None`` immediately when LID is disabled, when the
        input is empty, or when the underlying ``slid.compute`` call
        raises (the latter is logged and swallowed so a single bad
        utterance can't take down the whole STT session).
        """
        if self._slid is None:
            return None
        arr = np.asarray(samples, dtype=np.float32)
        if arr.size == 0:
            return None
        try:
            stream = self._slid.create_stream()
            stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=arr)
            lang = self._slid.compute(stream)
        except Exception as err:  # noqa: BLE001
            log.debug("LID inference failed: %s", err)
            return None
        # ``compute`` returns an empty string for inputs it can't
        # classify; normalise to ``None`` so the wire format is
        # consistent (Python ``None`` → JSON ``null``).
        lang = (lang or "").strip()
        return lang or None


class SttEngine:
    """Lazy, process-wide STT engine — recognizer + VAD + LID factory.

    The underlying ``OfflineRecognizer`` is thread-safe: sherpa-onnx
    releases the GIL during ONNX Runtime inference, so multiple
    ``SttSession`` objects can call ``transcribe()`` concurrently from
    the WebSocket thread pool.  Each session owns its own VAD detector
    (the VAD state is per-stream).

    The :class:`LidEngine` is similarly thread-safe (stateless Whisper
    inference) and is shared across all sessions.  When LID is
    disabled in config or the model files are missing, ``self._lid``
    is a no-op :class:`LidEngine` that returns ``None`` for every
    utterance — the WebSocket wire format stays identical, the
    ``lang`` field is just always ``null``.
    """

    def __init__(
        self,
        model_type: str,
        model_dir: str,
        vad_model_path: str,
        num_threads: int,
        language: str,
        vad_threshold: float,
        vad_min_silence: float,
        vad_min_speech: float,
        vad_max_speech: float,
        lid_model_dir: str,
        lid_num_threads: int,
        lid_enabled: bool,
    ) -> None:
        import sherpa_onnx

        self._model_type = model_type
        self._model_dir = Path(model_dir)
        self._vad_model_path = Path(vad_model_path)
        self._num_threads = num_threads
        # Default language label used as a fallback for the wire
        # ``lang`` field when [lid] is disabled or can't classify an
        # utterance.  Not a recogniser switch — Parakeet v3's
        # vocabulary is shared across all 25 supported languages.
        self.language = language

        # --- Parakeet (NeMo TDT) recognizer -----------------------------------
        # Parakeet (via sherpa-onnx's ``from_transducer`` factory with
        # ``model_type="nemo_transducer"``) is the default ASR backend.
        # The int8 bundle is ~640 MB extracted and runs at RTF ~0.2 on a
        # single modern x86 CPU thread.  Covers 25 European languages
        # (en, de, bg, hr, cs, da, nl, et, fi, fr, el, hu, it, lv, lt, mt,
        # pl, pt, ro, sk, sl, es, sv, ru, uk).  The expected files are:
        #   encoder.int8.onnx  — int8-quantised audio encoder
        #   decoder.int8.onnx  — int8-quantised text decoder
        #   joiner.int8.onnx   — int8-quantised transducer joiner
        #   tokens.txt         — sentence-piece vocabulary
        encoder = self._model_dir / "encoder.int8.onnx"
        decoder = self._model_dir / "decoder.int8.onnx"
        joiner = self._model_dir / "joiner.int8.onnx"
        tokens = self._model_dir / "tokens.txt"

        for path in (encoder, decoder, joiner, tokens):
            if not path.exists():
                raise FileNotFoundError(
                    f"Parakeet STT model file missing: {path}. "
                    "Run the Dockerfile setup or download "
                    "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8."
                )

        if model_type != "parakeet":
            raise ValueError(
                f"Unsupported STT model_type={model_type!r}. "
                "Only 'parakeet' is currently implemented."
            )

        log.info(
            "loading Parakeet STT via sherpa-onnx "
            "(num_threads=%d language=%s model=%s)",
            num_threads,
            language,
            self._model_dir.name,
        )
        # ``language`` is one of the 25 Parakeet language codes ("en",
        # "de", "fr", "es", …).  We pass it through as configured —
        # there's no auto-detect in the Parakeet decoder itself, so
        # the config value is still used for the rare cases where a
        # caller wants the recogniser to know the target language
        # (e.g. for tokenisation hints).  The actual per-utterance
        # language is detected by the :class:`LidEngine` and
        # surfaced on the wire.
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(encoder),
            decoder=str(decoder),
            joiner=str(joiner),
            tokens=str(tokens),
            num_threads=num_threads,
            sample_rate=SAMPLE_RATE,
            feature_dim=80,
            decoding_method="greedy_search",
            provider="cpu",
            model_type="nemo_transducer",
        )

        # --- Silero VAD -------------------------------------------------------
        if not self._vad_model_path.exists():
            raise FileNotFoundError(
                f"Silero VAD model not found: {self._vad_model_path}. "
                "Download silero_vad.onnx from the sherpa-onnx release page."
            )

        vad_config = sherpa_onnx.VadModelConfig()
        vad_config.silero_vad.model = str(self._vad_model_path)
        vad_config.silero_vad.threshold = vad_threshold
        vad_config.silero_vad.min_silence_duration = vad_min_silence
        vad_config.silero_vad.min_speech_duration = vad_min_speech
        vad_config.silero_vad.max_speech_duration = vad_max_speech
        vad_config.sample_rate = SAMPLE_RATE

        log.info(
            "Silero VAD ready (threshold=%.2f min_silence=%.2fs "
            "min_speech=%.2fs max_speech=%.1fs)",
            vad_threshold,
            vad_min_silence,
            vad_min_speech,
            vad_max_speech,
        )
        # Keep the config so per-session VAD instances can clone it.
        self._vad_config = vad_config

        # VAD instances are not thread-safe and hold rolling audio buffers;
        # each WebSocket session needs its own.
        self._sherpa_onnx = sherpa_onnx

        # --- Spoken-language identification ----------------------------------
        # Loaded after the recogniser so a missing LID model can't
        # prevent the rest of STT from booting.  ``LidEngine`` is a
        # safe no-op when ``enabled=False`` or files are missing.
        self._lid = LidEngine(
            model_dir=lid_model_dir,
            num_threads=lid_num_threads,
            enabled=lid_enabled,
        )

    def create_session(self) -> "SttSession":
        """Create a new :class:`SttSession` for a single WebSocket client."""
        return SttSession(self)

    def transcribe(self, samples) -> str:
        """Transcribe a complete speech segment with Parakeet.

        ``samples`` is mono float32 in ``[-1, 1]`` at :data:`SAMPLE_RATE`.
        Accepts a numpy ``ndarray`` *or* an array-like (e.g. the
        ``list`` returned by ``SpeechSegment.samples`` from the VAD).
        Returns the recognised text stripped of whitespace, or ``""``
        for empty / unrecognised input.
        """
        # ``SpeechSegment.samples`` is a plain Python list, not a
        # numpy array, so normalise to a float32 ndarray before
        # handing it to the recognizer.  ``np.asarray`` is a no-op
        # when the input is already a compatible array.
        arr = np.asarray(samples, dtype=np.float32)
        if arr.size == 0:
            return ""
        stream = self._recognizer.create_stream()
        stream.accept_waveform(SAMPLE_RATE, arr)
        self._recognizer.decode_stream(stream)
        text = (stream.result.text or "").strip()
        return text

    def detect_language(self, samples) -> str | None:
        """Run LID on ``samples`` and return the 2-letter language code.

        Delegates to :meth:`LidEngine.detect_language`; always returns
        ``None`` when LID is disabled or the model couldn't classify
        the input.
        """
        return self._lid.detect_language(samples)


class SttSession:
    """Stateful STT pipeline for a single WebSocket client.

    Owns a Silero VAD detector.  The route calls :meth:`feed_audio`
    for each chunk of int16-LE PCM bytes received from the browser, and
    gets back a list of :class:`SttEvent` items to ship to the client.

    Two kinds of events are produced:

    * ``speech_start`` — emitted exactly once when the VAD first
      detects speech in this session.  Used by the UI to swap the mic
      button into a "listening" state.
    * ``final`` — emitted when the VAD fires an endpoint (silence after
      speech) or the session is flushed.  The text is the final
      Parakeet transcription of the VAD's segment and will not change.
      No partial re-transcriptions are emitted mid-speech; transcription
      happens once, at the end.  The ``lang`` field is populated by
      :class:`LidEngine` when LID is enabled.
    """

    def __init__(self, engine: SttEngine) -> None:
        # 30 seconds of rolling audio is plenty for chat-style utterances.
        self._vad = engine._sherpa_onnx.VoiceActivityDetector(
            engine._vad_config, buffer_size_in_seconds=30
        )
        self._engine = engine
        # Whether we've already emitted ``speech_start`` since the last
        # endpoint — the VAD can stay "speech active" across many
        # chunks, so we only want the edge transition.
        self._speech_active = False
        # Float32 buffer of every sample fed in since the last endpoint.
        # We slice THIS for transcription (using the VAD's
        # ``segment.start`` as the offset) — not the VAD's
        # ``segment.samples`` directly.  The VAD's segment leaks the
        # VAD's internal Silero filter state as denormal float values
        # (e.g. ``1.76e-28``) at the start of every segment, and
        # Parakeet sees those as legitimate but tiny audio and emits
        # ``<unk>`` for everything.  Slicing from our own buffer
        # bypasses that entirely — we feed the model exactly what the
        # user said, in the same order, with no leaked filter state.
        self._buffer = np.zeros(0, dtype=np.float32)

    def _segment_clean_audio(self, segment) -> np.ndarray | None:
        """Return the clean float32 audio for ``segment`` or ``None``.

        Tries to slice the equivalent span out of our own buffer
        (which has no leaked VAD denormals).  Falls back to the VAD's
        own ``segment.samples`` when the buffer doesn't cover the
        segment — e.g. a flush was called before any audio was fed.
        Returns ``None`` only when both sources are empty.
        """
        start_sample = max(0, int(segment.start))
        seg_len = (
            len(segment.samples)
            if hasattr(segment.samples, "__len__")
            else 0
        )
        end_sample = min(self._buffer.size, start_sample + seg_len)
        if end_sample > start_sample:
            return self._buffer[start_sample:end_sample]
        if seg_len > 0:
            return np.asarray(segment.samples, dtype=np.float32)
        return None

    def _transcribe_and_detect(self, segment) -> tuple[str, str | None]:
        """Run Parakeet + LID on ``segment``'s audio.

        Returns ``(text, lang)``.  ``text`` is always populated (may
        be ``""`` if Parakeet produced no tokens).  ``lang`` is the
        2-letter ISO 639-1 code returned by the LID model, falling
        back to ``self._engine.language`` (the ``[stt] language``
        config value) when LID is disabled or couldn't classify the
        utterance.  The fallback is the default label emitted in
        LID-less mode so the wire ``lang`` field is never ``null``
        for a non-empty segment.
        """
        clean = self._segment_clean_audio(segment)
        if clean is None:
            return ("", None)
        text = self._engine.transcribe(clean)
        # LID runs on the same clean audio.  Doing it after
        # transcription is fine because the two models release the
        # GIL during inference — and the runtime cost is <100 ms
        # per utterance, dominated by the Whisper encoder.
        lang = self._engine.detect_language(clean)
        if lang is None:
            # Fall back to the configured default so the wire format
            # is never ``null`` for a non-empty segment.  This makes
            # the most sense when LID is disabled (the user wanted
            # a single-language deployment) and degrades gracefully
            # when LID is enabled but the audio is too short /
            # noisy for the Whisper-tiny model to classify.
            lang = self._engine.language or None
        return (text, lang)

    def feed_audio(self, int16_le_bytes: bytes) -> list[SttEvent]:
        """Feed one chunk of int16-LE mono PCM at :data:`SAMPLE_RATE`.

        Returns a list of events to send to the browser (possibly empty).
        Safe to call from a single thread; not safe to call concurrently
        from multiple threads.
        """
        events: list[SttEvent] = []
        samples = _int16_le_bytes_to_float32(int16_le_bytes)
        if samples.size == 0:
            return events

        # 1. Feed the VAD and accumulate the same audio into our own
        # buffer.  The VAD needs every sample to fire endpoints; the
        # buffer is the clean source we transcribe from at the
        # endpoint (see ``__init__`` comment for why).
        self._vad.accept_waveform(samples)
        self._buffer = np.concatenate((self._buffer, samples))

        # 2. Detect the speech-start edge.
        if not self._speech_active and self._vad.is_speech_detected():
            self._speech_active = True
            events.append(SttEvent(type="speech_start"))

        # 3. Drain any completed speech segments and emit a ``final``.
        # ``front`` is a property on sherpa-onnx's VoiceActivityDetector
        # (not a method) that returns the current ``SpeechSegment``.
        if not self._vad.empty():
            while not self._vad.empty():
                segment = self._vad.front
                self._vad.pop()
                text, lang = self._transcribe_and_detect(segment)
                events.append(SttEvent(type="final", text=text, lang=lang))
            # Reset the speech-state flag, drop the accumulated buffer
            # (the endpoint already captured everything), and reset
            # the VAD itself so the next utterance starts from a clean
            # slate.  ``reset()`` is what makes the second/third
            # utterance work — without it, the VAD's internal rolling
            # buffer still holds the tail of the previous segment's
            # audio and either suppresses the next ``speech_start`` or
            # never fires a fresh endpoint.
            self._speech_active = False
            self._buffer = np.zeros(0, dtype=np.float32)
            try:
                self._vad.reset()
            except Exception:  # noqa: BLE001
                # Older sherpa-onnx versions may not expose ``reset``;
                # in that case the VAD state will eventually right
                # itself as new audio overwrites the buffer.
                pass

        return events

    def flush(self) -> list[SttEvent]:
        """Flush the VAD at session end (WebSocket disconnect, stop).

        Drains any in-flight speech segment and emits a final event
        for it.  Returns an empty list if there is nothing pending.
        """
        events: list[SttEvent] = []
        try:
            self._vad.flush()
        except Exception as err:  # noqa: BLE001
            # Some sherpa-onnx versions don't expose ``flush``; ignore.
            log.debug("VAD flush() not available: %s", err)

        while not self._vad.empty():
            segment = self._vad.front
            self._vad.pop()
            # Same buffer-slice approach as in ``feed_audio`` to
            # avoid the VAD's leaked denormal state.  ``lang`` is
            # populated from LID when enabled.
            text, lang = self._transcribe_and_detect(segment)
            events.append(SttEvent(type="final", text=text, lang=lang))

        self._speech_active = False
        self._buffer = np.zeros(0, dtype=np.float32)
        # Same reset rationale as in ``feed_audio`` — make sure the VAD
        # is clean for any future use of this session.
        try:
            self._vad.reset()
        except Exception:  # noqa: BLE001
            pass
        return events


def _int16_le_bytes_to_float32(data: bytes) -> np.ndarray:
    """Decode raw int16-LE PCM bytes into float32 in ``[-1, 1]``."""
    if not data:
        return np.zeros(0, dtype=np.float32)
    # Empty / odd-length payloads are malformed; drop them.
    if len(data) % 2 != 0:
        return np.zeros(0, dtype=np.float32)
    int16 = np.frombuffer(data, dtype="<i2")
    return (int16.astype(np.float32) / 32768.0).astype(np.float32, copy=False)


_stt_singleton: SttEngine | None = None
_stt_load_lock = threading.Lock()


def get_stt() -> SttEngine | None:
    """Return the process-wide STT engine, loading on first call.

    Returns ``None`` when STT is disabled in ``config.toml`` *or* when
    the model can't be loaded (missing files, import error, OOM, …).
    The WebSocket endpoint closes with a descriptive code when this
    happens so the client can show a sensible message.

    The optional :class:`LidEngine` is loaded as part of the same
    ``SttEngine`` instance; a missing or disabled LID model does
    *not* prevent the rest of STT from booting.
    """
    global _stt_singleton
    if stt_disabled():
        return None
    if _stt_singleton is not None:
        return _stt_singleton
    with _stt_load_lock:
        if _stt_singleton is None:
            try:
                _stt_singleton = SttEngine(
                    model_type=STT_MODEL_TYPE,
                    model_dir=STT_MODEL_DIR,
                    vad_model_path=STT_VAD_MODEL,
                    num_threads=STT_NUM_THREADS,
                    language=STT_LANGUAGE,
                    vad_threshold=STT_VAD_THRESHOLD,
                    vad_min_silence=STT_VAD_MIN_SILENCE,
                    vad_min_speech=STT_VAD_MIN_SPEECH,
                    vad_max_speech=STT_VAD_MAX_SPEECH,
                    lid_model_dir=LID_MODEL_DIR,
                    lid_num_threads=LID_NUM_THREADS,
                    lid_enabled=LID_ENABLED,
                )
            except Exception as err:
                log.exception("Failed to load STT engine: %s", err)
                return None
    return _stt_singleton
