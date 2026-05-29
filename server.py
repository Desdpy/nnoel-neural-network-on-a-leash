#!/usr/bin/env python3
"""
Nnoel — Lightweight web UI for a llama.cpp server.

Reads all configuration from `config.toml` in the same directory.
"""

import json
from pathlib import Path

import requests
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

try:
    import tomllib  # Python 3.11+
except ImportError:  # This is needed if Python 3.10 or older is used
    import tomli as tomllib  # type: ignore[import-unresolved]

# ── Config ─────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent / "config.toml"


def _load_config():
    """Read config.toml and return its contents as a dict."""
    with open(CONFIG_PATH, "rb") as f:
        return tomllib.load(f)


config = _load_config()

HOST = config["server"]["host"]
PORT = config["server"]["port"]
LLAMA_URL = config["llama"]["url"].rstrip("/")
LLAMA_API_KEY = config["llama"].get("api_key", "") or ""

LLAMA_API = f"{LLAMA_URL}/v1/chat/completions"


def _llama_headers() -> dict:
    """Return headers for llama.cpp requests, including API key if configured."""
    headers = {}
    if LLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {LLAMA_API_KEY}"
    return headers


app = FastAPI(docs_url="/docs", redoc_url="/redoc")


# ── Routes ─────────────────────────────────────────


@app.get("/config")
def get_config():
    """Return agent configuration for the frontend."""
    return {"agent": {"name": config.get("agent", {}).get("name", "Agent")}}


@app.get("/agent-image")
def agent_image():
    """Serve the agent's avatar image."""
    img = Path(__file__).parent / "frontend" / "src" / "assets" / "Nnoel-temp.png"
    if not img.exists():
        raise HTTPException(status_code=404)
    return FileResponse(img, media_type="image/png")


@app.get("/ping")
def ping():
    """Health-check endpoint — tries to reach the llama.cpp server."""
    try:
        r = requests.get(LLAMA_URL, headers=_llama_headers(), timeout=2)
        return {"status": "ok", "llama": r.status_code == 200}
    except requests.ConnectionError:
        raise HTTPException(status_code=503, detail={"status": "error", "llama": False})


@app.post("/chat")
def chat(messages: list[dict] = Body(..., embed=True)):
    """
    Proxy a chat-completion request to llama.cpp with server-sent streaming.

    Expects JSON body:
        { "messages": [ {"role": "user", "content": "…"}, … ] }

    Returns a stream of raw text tokens (plain/text, not SSE).
    """

    payload = {
        "messages": messages,
        "stream": True,
    }

    try:
        resp = requests.post(
            LLAMA_API,
            headers=_llama_headers(),
            json=payload,
            stream=True,
            timeout=60,
        )

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        def generate():
            for line in resp.iter_lines():
                if not line:
                    continue
                raw = line.decode("utf-8")

                # llama.cpp streams "data: …" SSE lines
                if not raw.startswith("data:"):
                    continue

                json_str = raw[len("data:") :].strip()
                if json_str == "[DONE]":
                    break

                try:
                    chunk = json.loads(json_str)
                    # OpenAI-compatible response shape
                    token = (
                        chunk.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content", "")
                    )
                    if token:
                        yield token
                except json.JSONDecodeError:
                    continue

        return StreamingResponse(generate(), media_type="text/plain")

    except requests.ConnectionError:
        raise HTTPException(
            status_code=502,
            detail=(
                "Cannot connect to llama.cpp server. "
                "Make sure it is running at the configured URL."
            ),
        )


app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ── Main ───────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    print(f"Nnoel UI  → http://{HOST}:{PORT}")
    print(f"llama.cpp → {LLAMA_URL}")
    print()

    uvicorn.run(app, host=HOST, port=PORT)
