from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib

CONFIG_PATH = Path(__file__).parent / "config.toml"


def _load_config():
    with open(CONFIG_PATH, "rb") as f:
        return tomllib.load(f)


config = _load_config()

HOST = config["server"]["host"]
PORT = config["server"]["port"]
LLAMA_URL = config["llama"]["url"].rstrip("/")
LLAMA_API_KEY = config["llama"].get("api_key", "") or ""
LLAMA_API = f"{LLAMA_URL}/v1/chat/completions"
AGENT_NAME = config.get("agent", {}).get("name", "Agent")
