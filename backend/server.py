#!/usr/bin/env python3
"""
Nnoel — Lightweight web UI for a llama.cpp server.
"""

from pathlib import Path

from config import HOST, LLM_MODEL_PATH, PORT
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from routes import router

# Create the FastAPI application with Swagger/ReDoc doc pages enabled
app = FastAPI(docs_url="/docs", redoc_url="/redoc")
app.include_router(router)

# Mount the pre-built frontend (Vite build output in frontend/dist) as static files
# html=True allows SPA-style fallback to index.html for unknown routes
STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


def run():
    # Lazy-import uvicorn so the module can be safely imported without it installed
    import uvicorn

    print(f"Nnoel UI  \u2192 http://{HOST}:{PORT}")
    print(f"Model     \u2192 {LLM_MODEL_PATH}")
    print()

    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    run()
