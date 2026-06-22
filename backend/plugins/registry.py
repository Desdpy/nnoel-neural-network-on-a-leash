"""Plugin discovery and aggregation.

At import time this module walks the ``backend/plugins/`` directory
(``Path(__file__).parent``), imports each plugin's ``plugin.py`` (which
must expose a module-level ``plugin`` attribute satisfying the
:class:`Plugin` Protocol), and aggregates them into module-level
structures consumed by the rest of the backend:

- ``TOOLS``             — OpenAI function-calling list passed to the LLM
- ``HANDLERS``          — name → callable map for direct tool invocation
- ``execute(name, args)`` — generic dispatcher used by ``routes.py``
- ``routers``           — ``(plugin_id, APIRouter)`` pairs, mounted at
                          ``/plugins/<id>`` by ``server.py``
- ``system_prompt_fragments`` — per-plugin prompt guidance concatenated
                          into the agent's system message
- ``frontend_manifests`` — per-plugin UI metadata, sent to the UI via
                          ``GET /config`` so it can pick up taskbar entries
                          and panel component ids at runtime

Discovery is intentionally read-only and non-fatal: a broken plugin is
logged and skipped, not raised. The registry is built once at import and
is the only thing the rest of the backend imports.
"""

from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Any, Callable, Optional

from .protocol import Plugin

log = logging.getLogger(__name__)

# The plugins directory is the directory that contains this file
# (``backend/plugins/``). Each direct subdirectory is treated as a
# plugin package and its ``plugin`` attribute is loaded as a :class:`Plugin`.
_PLUGINS_DIR = Path(__file__).resolve().parent


def _load_plugin(plugin_id: str, plugin_dir: Path) -> Optional[Plugin]:
    """Import a single plugin's ``plugin.py`` and return the ``Plugin`` instance.

    Returns ``None`` and logs a warning if the plugin is missing its
    ``plugin.py``, if the module fails to import, or if the loaded
    object doesn't satisfy the :class:`Plugin` Protocol.
    """
    module_path = plugin_dir / "plugin.py"
    if not module_path.is_file():
        log.debug("Plugin %r has no plugin.py; skipping", plugin_id)
        return None
    fqmn = f"plugins.{plugin_id}.plugin"
    try:
        module = importlib.import_module(fqmn)
    except Exception:  # noqa: BLE001
        log.exception("Plugin %r failed to import; skipping", plugin_id)
        return None
    candidate = getattr(module, "plugin", None)
    if candidate is None:
        log.warning("Plugin %r: plugin.py has no 'plugin' attribute; skipping", plugin_id)
        return None
    if not isinstance(candidate, Plugin):
        log.warning(
            "Plugin %r: 'plugin' attribute does not satisfy the Plugin Protocol; skipping",
            plugin_id,
        )
        return None
    return candidate


def _discover() -> list[Plugin]:
    """Walk ``backend/plugins/*/`` and return loaded plugin instances.

    Sorted by ``id`` so aggregation order is stable across runs (and so
    the ``/config`` payload is deterministic). Non-directory entries,
    hidden directories, and packages without a valid ``plugin.py`` are
    silently skipped — discovery is meant to be best-effort.
    """
    if not _PLUGINS_DIR.is_dir():
        log.info("No plugins directory at %s; running with zero plugins", _PLUGINS_DIR)
        return []
    plugins: list[Plugin] = []
    for entry in sorted(_PLUGINS_DIR.iterdir(), key=lambda p: p.name):
        if not entry.is_dir() or entry.name.startswith(("_", ".")):
            continue
        # Skip this very package's own non-plugin subdirectories
        # (e.g. ``__pycache__`` is filtered by the name check above).
        plugin_id = entry.name
        loaded = _load_plugin(plugin_id, entry)
        if loaded is not None:
            plugins.append(loaded)
    return plugins


# --- Aggregation --------------------------------------------------------

_LOADED: list[Plugin] = _discover()

# OpenAI-compatible tool list: each plugin contributes zero or more tools.
TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": tool_def["schema"]}
    for plugin in _LOADED
    for tool_def in plugin.tools
]

# Name → callable map for direct invocation (used by ``POST /tools/{name}``).
HANDLERS: dict[str, Callable[..., Any]] = {
    tool_def["schema"]["name"]: tool_def["run"]
    for plugin in _LOADED
    for tool_def in plugin.tools
}


def execute(name: str, arguments: dict[str, Any]) -> Any:
    """Dispatch a tool call by name, passing arguments as kwargs.

    Returns the handler's return value verbatim (string or structured
    dict with a ``text`` field). Returns a human-readable error string
    for unknown tool names so the LLM can recover gracefully instead of
    the chat loop crashing.
    """
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool: {name}"
    return handler(**arguments)


# Plugin routers: each is auto-mounted at ``/plugins/<id>`` by ``server.py``.
routers: list[tuple[str, Any]] = [
    (plugin.id, plugin.router) for plugin in _LOADED if plugin.router is not None
]

# Per-plugin system-prompt fragments, concatenated into the agent prompt.
# Empty fragments are filtered out so a plugin that doesn't need any
# guidance doesn't add blank lines to the system message.
system_prompt_fragments: list[str] = [
    fragment for plugin in _LOADED if (fragment := plugin.system_prompt)
]

# Per-plugin UI manifests, serialised into the ``/config`` response so the
# frontend can learn about new plugins without a rebuild. (The actual
# React component, ``params`` builder, and ``instanceTitle`` callback
# come from the frontend plugin package bundled at build time.)
frontend_manifests: list[dict[str, Any]] = [dict(plugin.frontend) for plugin in _LOADED]


log.info(
    "Loaded %d plugin(s): %s",
    len(_LOADED),
    ", ".join(p.id for p in _LOADED) or "(none)",
)
