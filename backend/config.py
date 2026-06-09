import os
from pathlib import Path

try:
    import tomllib              # Python 3.11+
except ImportError:             # This is needed if Python 3.10 or older is used
    import tomli as tomllib     # type: ignore[import-unresolved]

CONFIG_PATH = Path(__file__).parent / "config.toml"


with open(CONFIG_PATH, "rb") as f:
    config = tomllib.load(f)

HOST = config["server"]["host"]
PORT = int(config["server"]["port"])

BASE_DIR = Path(__file__).parent.parent

LLM_MODEL_PATH = str(BASE_DIR / "models" / "main.gguf")
LLM_MMPROJ_PATH = str(BASE_DIR / "models" / "main-mmproj.gguf")
if not os.path.exists(LLM_MMPROJ_PATH):
    LLM_MMPROJ_PATH = None
LLM_N_CTX = int(config["llama"].get("n_ctx", 4096))
LLM_TEMPERATURE = config["llama"].get("temperature")
LLM_TOP_P = config["llama"].get("top_p")
LLM_TOP_K = config["llama"].get("top_k")
LLM_MIN_P = config["llama"].get("min_p")
LLM_PRESENCE_PENALTY = config["llama"].get("presence_penalty")
LLM_REPEAT_PENALTY = config["llama"].get("repeat_penalty")

AGENT_NAME = config.get("agent", {}).get("name", "Agent")
