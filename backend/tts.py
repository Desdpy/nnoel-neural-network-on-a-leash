"""Text-to-speech synthesis (Piper via sherpa-onnx).

Uses the Piper VITS model through the ``sherpa-onnx`` Python package.  Piper
is a fast, lightweight English TTS engine.  The ``amy`` voice (medium quality)
produces natural-sounding speech at RTF ~0.06 — roughly 15× real-time on a
modern CPU, so audio chunks arrive well ahead of the LLM's token stream.

sherpa-onnx releases the GIL during inference, so multiple TTS chunks can be
synthesised in parallel from the thread pool in ``routes.py``.

This module owns:

* Loading the ONNX model lazily (so the server boots even if sherpa-onnx
  or the model files are missing).
* A :meth:`PiperTTS.synthesize` method that turns a short text chunk
  into a ``TtsResult`` of mono float32 PCM at the model's native
  sample rate (22050 Hz for amy-medium).

``routes.py`` drives the streaming pipeline: tokens from the LLM flow
to the wire immediately, and a thread pool invokes ``synthesize()``
per finished text chunk, posting the resulting PCM into a queue the
streaming response drains.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from config import (
    TTS_ENABLED,
    TTS_MODEL_DIR,
    TTS_NUM_THREADS,
    TTS_PITCH,
    TTS_SPEED,
)
from log import get_logger

log = get_logger("tts")


def tts_disabled() -> bool:
    """True when the server should skip TTS entirely."""
    return not TTS_ENABLED


@dataclass
class TtsResult:
    """One chunk of synthesized audio, ready to ship to the browser."""

    samples: np.ndarray
    sample_rate: int


def _pitch_shift(samples: np.ndarray, semitones: float) -> np.ndarray:
    """Shift pitch by *semitones*, accepting a small duration change.

    Resamples the waveform by *factor* = 2^(semitones/12).  Going
    through the samples faster raises pitch (but shortens duration by
    1/factor); going slower lowers pitch (but lengthens by 1/factor).
    Duration changes are under 6 % for ±1 semitone and under 15 % for
    ±3 semitones — negligible for streaming TTS chunks.
    """
    if semitones == 0.0 or samples.size == 0:
        return samples
    factor = 2.0 ** (semitones / 12.0)
    n = len(samples)
    output_n = max(1, int(round(n / factor)))
    output_indices = np.arange(output_n, dtype=np.float64) * factor
    return np.interp(output_indices, np.arange(n, dtype=np.float64), samples.astype(np.float64)).astype(np.float32)


class PiperTTS:
    """sherpa-onnx Piper VITS TTS engine.

    The underlying ONNX Runtime session is thread-safe — sherpa-onnx
    releases the GIL during inference, so multiple threads can call
    ``synthesize()`` concurrently.
    """

    def __init__(self, speed: float, pitch: float, num_threads: int, model_dir: str) -> None:
        import sherpa_onnx

        model_path = Path(model_dir)
        onnx_file = model_path / "en_US-amy-medium.onnx"
        if not onnx_file.exists():
            onnx_file = model_path / "model.onnx"
        if not onnx_file.exists():
            raise FileNotFoundError(f"No Piper ONNX model found in {model_path}")

        tokens_file = model_path / "tokens.txt"
        data_dir = model_path / "espeak-ng-data"

        if not tokens_file.exists():
            raise FileNotFoundError(f"tokens.txt not found in {model_path}")
        if not data_dir.exists():
            raise FileNotFoundError(f"espeak-ng-data/ not found in {model_path}")

        self._speed = float(speed)
        self._pitch = float(pitch)

        log.info(
            "loading Piper TTS via sherpa-onnx "
            "(speed=%.2f pitch=%.1f semitones num_threads=%d model=%s)",
            self._speed,
            self._pitch,
            num_threads,
            onnx_file.name,
        )

        vits_config = sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(onnx_file),
            tokens=str(tokens_file),
            data_dir=str(data_dir),
        )
        model_config = sherpa_onnx.OfflineTtsModelConfig(
            vits=vits_config,
            num_threads=num_threads,
            debug=False,
            provider="cpu",
        )
        tts_config = sherpa_onnx.OfflineTtsConfig(model=model_config)
        self._tts = sherpa_onnx.OfflineTts(tts_config)
        self._sample_rate = self._tts.sample_rate
        log.info("Piper TTS ready (sample_rate=%d Hz, %d speakers)", self._sample_rate, self._tts.num_speakers)

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def synthesize(self, text: str) -> TtsResult | None:
        """Synthesize ``text`` to mono float32 PCM.

        Returns ``None`` for empty / whitespace-only input.
        Piper is single-speaker (amy) so sid is always 0.
        If ``pitch`` is non-zero, applies a pitch shift in semitones
        via linear-interpolation resampling.
        """
        cleaned = (text or "").strip()
        if not cleaned:
            return None
        audio = self._tts.generate(cleaned, sid=0, speed=self._speed)
        samples = np.array(audio.samples, dtype=np.float32)
        if samples.size == 0:
            return None
        if self._pitch != 0.0:
            samples = _pitch_shift(samples, self._pitch)
        return TtsResult(samples=samples, sample_rate=audio.sample_rate)


_tts_singleton: PiperTTS | None = None
_tts_load_lock = threading.Lock()


def get_tts() -> PiperTTS | None:
    """Return the process-wide Piper TTS, loading on first call.

    Returns ``None`` when TTS is disabled in ``config.toml`` *or* when
    the model can't be loaded (missing files, import error, OOM, …).
    """
    global _tts_singleton
    if tts_disabled():
        return None
    if _tts_singleton is not None:
        return _tts_singleton
    with _tts_load_lock:
        if _tts_singleton is None:
            try:
                _tts_singleton = PiperTTS(
                    speed=TTS_SPEED,
                    pitch=TTS_PITCH,
                    num_threads=TTS_NUM_THREADS,
                    model_dir=TTS_MODEL_DIR,
                )
            except Exception as err:
                log.exception("Failed to load Piper TTS: %s", err)
                return None
    return _tts_singleton