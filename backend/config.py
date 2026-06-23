import os
from pathlib import Path

import tomllib

# Path to the user-editable TOML configuration file
CONFIG_PATH = Path(__file__).parent / "config.toml"

# Load the entire config file into a dictionary
with open(CONFIG_PATH, "rb") as f:
    config = tomllib.load(f)

# --- Server settings ---
HOST = config["server"]["host"]
PORT = int(config["server"]["port"])

BASE_DIR = Path(__file__).parent.parent

# --- Model paths ---
# The main GGUF model file (required)
LLM_MODEL_PATH = str(BASE_DIR / "models" / "main.gguf")
# The multimodal projection file (optional — set to None if missing)
LLM_MMPROJ_PATH = str(BASE_DIR / "models" / "main-mmproj.gguf")
if not os.path.exists(LLM_MMPROJ_PATH):
    LLM_MMPROJ_PATH = None

# --- LLM sampling parameters (each may be None if not set in config) ---
LLM_N_CTX = int(config["llama"].get("n_ctx", 4096))
_tts_num_threads = int(config.get("tts", {}).get("num_threads", 2))
TTS_WORKERS = int(config.get("tts", {}).get("workers", 2))
_total_threads = os.cpu_count() or 1
# Reserve headroom for TTS on top of the LLM.  TTS synthesis for the
# previous turn can be playing while the LLM is generating the next
# response, so we subtract its threads to avoid contention.
_default_n_threads = max(1, _total_threads - _tts_num_threads)
LLM_N_THREADS = config["llama"].get("n_threads", _default_n_threads)
LLM_TEMPERATURE = config["llama"].get("temperature")
LLM_TOP_P = config["llama"].get("top_p")
LLM_TOP_K = config["llama"].get("top_k")
LLM_MIN_P = config["llama"].get("min_p")
LLM_PRESENCE_PENALTY = config["llama"].get("presence_penalty")
LLM_REPEAT_PENALTY = config["llama"].get("repeat_penalty")
LLM_CHAT_TEMPLATE_KWARGS = config["llama"].get("chat_template_kwargs", {})

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
