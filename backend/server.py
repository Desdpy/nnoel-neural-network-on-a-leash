#!/usr/bin/env python3
"""
Nnoel — Lightweight web UI for a llama.cpp server.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from config import HOST, PORT, LLAMA_URL
from routes import router

app = FastAPI(docs_url="/docs", redoc_url="/redoc")
app.include_router(router)

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


def run():
    import uvicorn

    print(f"Nnoel UI  \u2192 http://{HOST}:{PORT}")
    print(f"llama.cpp \u2192 {LLAMA_URL}")
    print()

    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    run()
