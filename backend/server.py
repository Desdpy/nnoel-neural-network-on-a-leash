#!/usr/bin/env python3
"""
Nnoel — Local AI assistant with in-process LLM and TTS.
"""

from contextlib import asynccontextmanager
from pathlib import Path

# Import the plugin registry FIRST so its aggregated surface
# (``TOOLS``, ``HANDLERS``, ``execute``, ``routers``, ...) is ready
# when the rest of the backend (and ``routes.py``'s ``import plugins
# as tools``) needs it. Plugins live as subpackages of ``backend/plugins/``
# and are discovered at import time.
import plugins  # noqa: E402

from config import HOST, LLM_MODEL_PATH, PORT  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from log import get_logger  # noqa: E402
from routes import router  # noqa: E402

log = get_logger("server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-warm heavy model loaders at server startup.

    The LLM, TTS, and STT engines all take seconds to load on first
    use.  Without pre-warming, the first user request for each one
    would block — and a slow load is a common cause of WebSocket
    timeouts (the client reports ``code 1006``).  We call each
    engine's ``get_*()`` helper in turn; they all gracefully no-op
    if disabled or if model files are missing, and log their own
    load errors so the user can diagnose problems from the server log.
    """
    from stt import get_stt, stt_disabled
    from tts import get_tts, tts_disabled

    log.info("Pre-warming model loaders...")
    if tts_disabled():
        log.info("TTS disabled in config; skipping pre-warm.")
    else:
        try:
            tts = get_tts()
            if tts is not None:
                log.info("TTS engine ready.")
            else:
                log.warning("TTS engine failed to load; check model files.")
        except Exception as err:  # noqa: BLE001
            log.exception("TTS pre-warm failed: %s", err)

    if stt_disabled():
        log.info("STT disabled in config; skipping pre-warm.")
    else:
        try:
            stt = get_stt()
            if stt is not None:
                log.info("STT engine ready.")
            else:
                log.warning(
                    "STT engine failed to load; check model files in "
                    "models/stt/. Mic button will not work until this is fixed."
                )
        except Exception as err:  # noqa: BLE001
            log.exception("STT pre-warm failed: %s", err)

    yield


# Create the FastAPI application with Swagger/ReDoc doc pages enabled.
# ``lifespan`` replaces the deprecated ``on_event`` startup hooks.
app = FastAPI(docs_url="/docs", redoc_url="/redoc", lifespan=lifespan)
app.include_router(router)

# Mount each plugin's custom router at ``/plugins/<id>`` so the time
# plugin's ``/plugins/time/timezones/locations`` endpoint (and any
# future plugin's endpoints) are reachable without editing ``routes.py``.
for plugin_id, plugin_router in plugins.routers:
    app.include_router(plugin_router, prefix=f"/plugins/{plugin_id}")

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
