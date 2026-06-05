import os
from pathlib import Path

try:
    import tomllib              # Python 3.11+
except ImportError:             # This is needed if Python 3.10 or older is used
    import tomli as tomllib     # type: ignore[import-unresolved]

CONFIG_PATH = Path(__file__).parent / "config.toml"


def _load_config():
    with open(CONFIG_PATH, "rb") as f:
        return tomllib.load(f)


def _env(key: str, default: str) -> str:
    return os.environ.get(f"NNOEL_{key}", default)


config = _load_config()

HOST = _env("HOST", config["server"]["host"])
PORT = int(_env("PORT", str(config["server"]["port"])))
LLAMA_URL = _env("LLAMA_URL", config["llama"]["url"]).rstrip("/")
LLAMA_API_KEY = _env("LLAMA_API_KEY", config["llama"].get("api_key", "") or "")
LLAMA_API = f"{LLAMA_URL}/v1/chat/completions"
AGENT_NAME = _env("AGENT_NAME", config.get("agent", {}).get("name", "Agent"))
