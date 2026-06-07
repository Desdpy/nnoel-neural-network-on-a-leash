from pathlib import Path

from config import AGENT_NAME
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from llama import generate_stream, get_llm

router = APIRouter()


@router.get("/config")
def get_config():
    return {"agent": {"name": AGENT_NAME}}


@router.get("/agent-image")
def agent_image():
    img = Path(__file__).parent / "assets" / "Nnoel.png"
    if not img.exists():
        raise HTTPException(status_code=404)
    return FileResponse(img, media_type="image/png")


@router.get("/ping")
def ping():
    try:
        get_llm()
        return {"status": "ok", "llama": True}
    except Exception:
        raise HTTPException(status_code=503, detail={"status": "error", "llama": False})


@router.post("/chat")
def chat(messages: list[dict] = Body(..., embed=True)):
    try:
        return StreamingResponse(generate_stream(messages), media_type="text/plain")
    except Exception:
        raise HTTPException(
            status_code=502,
            detail=(
                "Cannot connect to llama.cpp server. "
                "Make sure it is running at the configured URL."
            ),
        )
