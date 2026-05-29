from pathlib import Path

import requests
from config import AGENT_NAME, LLAMA_API, LLAMA_URL
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from llama import _llama_headers, iter_sse_tokens

router = APIRouter()


@router.get("/config")
def get_config():
    return {"agent": {"name": AGENT_NAME}}


@router.get("/agent-image")
def agent_image():
    img = Path(__file__).parent / "assets" / "Nnoel-temp.png"
    if not img.exists():
        raise HTTPException(status_code=404)
    return FileResponse(img, media_type="image/png")


@router.get("/ping")
def ping():
    try:
        r = requests.get(LLAMA_URL, headers=_llama_headers(), timeout=2)
        return {"status": "ok", "llama": r.status_code == 200}
    except requests.ConnectionError:
        raise HTTPException(status_code=503, detail={"status": "error", "llama": False})


@router.post("/chat")
def chat(messages: list[dict] = Body(..., embed=True)):
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

        return StreamingResponse(iter_sse_tokens(resp), media_type="text/plain")

    except requests.ConnectionError:
        raise HTTPException(
            status_code=502,
            detail=(
                "Cannot connect to llama.cpp server. "
                "Make sure it is running at the configured URL."
            ),
        )
