import json

import requests

from config import LLAMA_API_KEY


def _llama_headers() -> dict:
    headers = {}
    if LLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {LLAMA_API_KEY}"
    return headers


def iter_sse_tokens(resp: requests.Response):
    """Yield text tokens from a streaming llama.cpp SSE response."""
    for line in resp.iter_lines():
        if not line:
            continue
        raw = line.decode("utf-8")
        if not raw.startswith("data:"):
            continue
        json_str = raw[len("data:"):].strip()
        if json_str == "[DONE]":
            break
        try:
            chunk = json.loads(json_str)
            token = (
                chunk.get("choices", [{}])[0]
                .get("delta", {})
                .get("content", "")
            )
            if token:
                yield token
        except json.JSONDecodeError:
            continue
