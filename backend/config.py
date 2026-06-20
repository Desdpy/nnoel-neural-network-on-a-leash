import os
from pathlib import Path

# Use Python 3.11+'s built-in tomllib; fall back to the tomli package on older versions
try:
    import tomllib              # Python 3.11+
except ImportError:             # This is needed if Python 3.10 or older is used
    import tomli as tomllib     # type: ignore[import-unresolved]

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
LLM_N_THREADS = config["llama"].get("n_threads")  # None = let llama.cpp pick
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
TTS_FIRST_CHUNK_WORDS = int(
    config.get("tts", {}).get("adaptive_first_chunk_words", 4)
)
