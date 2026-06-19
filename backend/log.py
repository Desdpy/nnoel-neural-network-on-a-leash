"""Tiny module-level logger so the rest of the backend doesn't have to
duplicate ``logging.getLogger(__name__)`` boilerplate. We log everything
to stderr (uvicorn's default) and keep the format consistent with the
banner that ``server.py`` prints at startup.
"""

import logging
import sys

_LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s — %(message)s"
_DATE_FORMAT = "%H:%M:%S"

_configured = False


def configure() -> None:
    """Install a single stream handler on the root logger. Idempotent."""
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(stream=sys.stderr)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))
    root = logging.getLogger()
    # Don't override uvicorn's level if it's already configured; just make
    # sure we have at least one handler with our format attached.
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        root.addHandler(handler)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    configure()
    return logging.getLogger(name)
