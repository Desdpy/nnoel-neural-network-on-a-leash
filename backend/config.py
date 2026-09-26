import os
from pathlib import Path

import tomllib

# Path to the user-editable TOML configuration file. There is a single
# config file for the whole project: ``config.toml`` at the project
# root, so it's usable outside of the backend (tooling, container bind
# mounts). The Docker image bakes it in; the dev compose file bind-mounts
# the host copy over it so edits apply on restart without a rebuild.
_PROJECT_ROOT = Path(__file__).parent.parent
CONFIG_PATH = _PROJECT_ROOT / "config.toml"

# Load the entire config file into a dictionary
with open(CONFIG_PATH, "rb") as f:
    config = tomllib.load(f)

# --- Server settings ---
HOST = config["server"]["host"]
PORT = int(config["server"]["port"])

BASE_DIR = Path(__file__).parent.parent

# --- LLM settings ---
_llama_section = config.get("llama", {})
LLAMA_SERVER_URL = _llama_section.get("url", "http://127.0.0.1:8080")
LLAMA_SERVER_API_KEY = _llama_section.get("api_key", "")
LLM_MODEL_NAME = _llama_section.get("model_name", "default")

# --- Agent identity ---
AGENT_NAME = config.get("agent", {}).get("name", "Agent")
AGENT_SYSTEM_PROMPT = config.get("agent", {}).get("system_prompt", "")

# --- Text-to-speech (Piper via sherpa-onnx) ---
# All fields default to safe, no-op values so the server can run even
# without the model files installed. When ``TTS_ENABLED`` is false,
# the chat stream simply skips audio synthesis entirely.
TTS_ENABLED = bool(config.get("tts", {}).get("enabled", False))
TTS_NUM_THREADS = int(config.get("tts", {}).get("num_threads", 2))
TTS_WORKERS = int(config.get("tts", {}).get("workers", 2))
TTS_SPEED = float(config.get("tts", {}).get("speed", 1.0))
TTS_PITCH = float(config.get("tts", {}).get("pitch", 0.0))
_raw_model_dir = config.get("tts", {}).get(
    "model_dir", str(BASE_DIR / "models" / "tts" / "vits-piper-en_US-amy-medium")
)
TTS_MODEL_DIR = str(
    Path(_raw_model_dir)
    if Path(_raw_model_dir).is_absolute()
    else BASE_DIR / _raw_model_dir
)
TTS_MIN_CHARS = int(config.get("tts", {}).get("min_chars", 12))
TTS_MAX_CHARS = int(config.get("tts", {}).get("max_chars", 140))
TTS_FIRST_CHUNK_WORDS = int(config.get("tts", {}).get("adaptive_first_chunk_words", 4))

# --- Speech-to-text (Parakeet TDT 0.6B v3 int8 via sherpa-onnx) ---
# All fields default to safe, no-op values so the server can run even
# without the model files installed. When ``STT_ENABLED`` is false,
# the WebSocket endpoint rejects connections and the frontend hides
# the mic button.
_total_threads = os.cpu_count() or 1
STT_ENABLED = bool(config.get("stt", {}).get("enabled", False))
STT_NUM_THREADS = int(config.get("stt", {}).get("num_threads", _total_threads))
STT_MODEL_TYPE = str(config.get("stt", {}).get("model_type", "parakeet"))
_raw_stt_model_dir = config.get("stt", {}).get(
    "model_dir", str(BASE_DIR / "models" / "stt" / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")
)
STT_MODEL_DIR = str(
    Path(_raw_stt_model_dir)
    if Path(_raw_stt_model_dir).is_absolute()
    else BASE_DIR / _raw_stt_model_dir
)
_raw_stt_vad_model = config.get("stt", {}).get(
    "vad_model", str(BASE_DIR / "models" / "stt" / "silero_vad.onnx")
)
STT_VAD_MODEL = str(
    Path(_raw_stt_vad_model)
    if Path(_raw_stt_vad_model).is_absolute()
    else BASE_DIR / _raw_stt_vad_model
)
STT_LANGUAGE = str(config.get("stt", {}).get("language", "en"))
STT_VAD_THRESHOLD = float(config.get("stt", {}).get("vad_threshold", 0.5))
STT_VAD_MIN_SILENCE = float(config.get("stt", {}).get("vad_min_silence_duration", 0.8))
STT_VAD_MIN_SPEECH = float(config.get("stt", {}).get("vad_min_speech_duration", 0.25))
STT_VAD_MAX_SPEECH = float(config.get("stt", {}).get("vad_max_speech_duration", 30.0))

# --- Spoken-language identification (Whisper-tiny int8 via sherpa-onnx) ---
# Auto-detects the language of each transcribed utterance so the
# server can attach a ``lang`` field to the ``final`` WebSocket event.
# Defaults are no-op so the server can run even without the model
# files.  ``LID_ENABLED`` is also force-disabled at runtime if any of
# the expected model files are missing.
LID_ENABLED = bool(config.get("lid", {}).get("enabled", False))
LID_NUM_THREADS = int(config.get("lid", {}).get("num_threads", 1))
_raw_lid_model_dir = config.get("lid", {}).get(
    "model_dir", str(BASE_DIR / "models" / "lid" / "sherpa-onnx-whisper-tiny")
)
LID_MODEL_DIR = str(
    Path(_raw_lid_model_dir)
    if Path(_raw_lid_model_dir).is_absolute()
    else BASE_DIR / _raw_lid_model_dir
)

# --- Menu websites ---
# Each entry under ``[websites.entries]`` becomes a satellite in
# the menu. Clicking opens the URL in an embedded iframe. ``id``
# must be unique across plugins, cores, and other websites;
# ``label`` is the text shown on the floating label; ``url`` is
# loaded into the iframe when the satellite is clicked.
WEBSITES: list[dict] = [
    {
        "id": str(entry["id"]),
        "label": str(entry.get("label", entry["id"])),
        "url": str(entry["url"]),
        # ``new_tab`` controls how clicking the satellite opens
        # the site. ``false`` (default) embeds it in the menu
        # panel; ``true`` opens it in a real browser tab via
        # ``window.open`` and leaves the panel closed. Use
        # ``true`` for sites that refuse to be iframed
        # (X-Frame-Options, restrictive CSP, runtime crashes) or
        # that need full browser features (popups, downloads).
        "new_tab": bool(entry.get("new_tab", False)),
        # ``icon`` is the satellite icon. Two shapes are accepted:
        # - A bare name (e.g. ``"github"``) resolves to a Lucide
        #   icon component (see ``frontend/src/lib/satelliteIcons.ts``
        #   for the lookup table).
        # - A filename ending in ``.png`` / ``.svg`` is served
        #   from ``/icons/`` (the ``public/`` directory of the
        #   frontend bundle). E.g. ``"github.png"`` renders
        #   ``<img src="/icons/github.png">``.
        # ``None`` (the default) means no icon is shown.
        "icon": (
            str(entry["icon"]) if entry.get("icon") is not None else None
        ),
    }
    for entry in config.get("websites", {}).get("entries", [])
]
