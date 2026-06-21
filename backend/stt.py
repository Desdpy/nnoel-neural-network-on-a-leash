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

This module owns:

* Loading the ONNX recognizer and VAD model lazily (so the server can
  boot even if the model files are missing — ``get_stt()`` then
  returns ``None`` and the WebSocket endpoint rejects connections).
* :class:`SttEngine`, a thread-safe wrapper around the ``OfflineRecognizer``
  used to transcribe individual audio segments.
* :class:`SttSession`, a stateful per-WebSocket connection that owns a
  Silero ``VoiceActivityDetector`` and produces ``SttEvent`` items as
  the user speaks.

``routes.py`` drives the WebSocket pipeline: binary audio frames from
the browser feed into an ``SttSession``, the session returns a list of
events (speech-start, final), and the route ships those events back
to the browser as JSON.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from config import (
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
    """

    type: str
    text: str = ""


class SttEngine:
    """Lazy, process-wide STT engine — recognizer + VAD factory.

    The underlying ``OfflineRecognizer`` is thread-safe: sherpa-onnx
    releases the GIL during ONNX Runtime inference, so multiple
    ``SttSession`` objects can call ``transcribe()`` concurrently from
    the WebSocket thread pool.  Each session owns its own VAD detector
    (the VAD state is per-stream).
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
    ) -> None:
        import sherpa_onnx

        self._model_type = model_type
        self._model_dir = Path(model_dir)
        self._vad_model_path = Path(vad_model_path)
        self._num_threads = num_threads
        self._language = language

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
        # there's no auto-detect like Whisper has, so the config
        # value must be a specific language code.
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
      happens once, at the end.
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
                # Slice the equivalent span out of our own buffer.  The
                # VAD's ``segment.start`` is the sample index in the
                # VAD's internal audio stream, which is the same
                # indexing as our buffer (both are fed the same
                # samples in the same order).  Using the buffer means
                # we hand Parakeet clean audio without the VAD's
                # internal filter-state denormals.
                start_sample = max(0, int(segment.start))
                seg_len = (
                    len(segment.samples)
                    if hasattr(segment.samples, "__len__")
                    else 0
                )
                end_sample = min(
                    self._buffer.size,
                    start_sample + seg_len,
                )
                if end_sample > start_sample:
                    clean_audio = self._buffer[start_sample:end_sample]
                    text = self._engine.transcribe(clean_audio)
                else:
                    # Buffer doesn't cover the segment (e.g. flush
                    # called before audio was fed).  Fall back to the
                    # VAD's segment.
                    text = self._engine.transcribe(segment.samples)
                events.append(SttEvent(type="final", text=text))
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
            # avoid the VAD's leaked denormal state.
            start_sample = max(0, int(segment.start))
            seg_len = (
                len(segment.samples)
                if hasattr(segment.samples, "__len__")
                else 0
            )
            end_sample = min(
                self._buffer.size,
                start_sample + seg_len,
            )
            if end_sample > start_sample:
                clean_audio = self._buffer[start_sample:end_sample]
                text = self._engine.transcribe(clean_audio)
            else:
                text = self._engine.transcribe(segment.samples)
            events.append(SttEvent(type="final", text=text))

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
                )
            except Exception as err:
                log.exception("Failed to load STT engine: %s", err)
                return None
    return _stt_singleton
