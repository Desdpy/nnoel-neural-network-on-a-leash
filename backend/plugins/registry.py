"""Plugin discovery and aggregation.

A plugin is a self-contained subfolder of the top-level ``plugins/``
directory: ``plugins/<id>/backend/`` (the Python tool, custom HTTP
endpoints, system-prompt guidance, and UI manifest) plus, optionally,
``plugins/<id>/frontend/`` (the React panel component and a
default-exporting ``index.ts`` manifest). The two halves are paired by
sharing the same ``<id>``.

In the Docker flow the ``plugins/`` directory is a single volume mount
so users can supply plugins at runtime without rebuilding the image. In
local dev the same directory holds the repo's reference plugins (e.g.
``plugins/time/``).

Importing this package triggers the discovery pass and aggregates every
plugin into the module-level surface (``TOOLS``, ``HANDLERS``,
``execute``, ``routers``, ``system_prompt_fragments``,
``frontend_manifests``) that the rest of the backend consumes without
needing to know about any individual plugin.

**Why a synthetic package for imports:**
Each plugin's backend is at ``plugins/<id>/backend/`` (a regular Python
package with its own ``__init__.py``). To import those packages via
``importlib`` without coupling the registry to the plugin authors'
filesystem layout — and to make the import robust to a Docker volume
mount that may or may not carry a baked ``__init__.py`` at the parent
level — the registry creates a synthetic parent module
(``nnoel_plugins``) in ``sys.modules`` whose ``__path__`` points at the
``plugins/`` directory. This makes each plugin importable as
``nnoel_plugins.<id>.backend`` and its entry point as
``nnoel_plugins.<id>.backend.plugin``, so intra-plugin relative
imports like ``from .tool import SCHEMA`` work.

**Frontend half:**
The frontend code (``plugins/<id>/frontend/``) lives outside the
Vite project, so the Vite glob in ``frontend/src/plugins/registry.ts``
walks up to the repo root (``../../../plugins/*/frontend/index.ts``)
and bundles the plugin files directly — no copy/sync step is
needed. The ``@`` alias in ``vite.config.ts`` is resolved to an
absolute path (``frontend/src/``), so plugin files can still import
``@/lib/logger``, ``@/components/ui/...`` and ``@/plugins/types``
from the frontend tree regardless of where the plugin lives on
disk. In Docker the ``./plugins:/app/plugins`` volume mount makes
the host's plugin dir visible at the path the glob expects.

**Environment override:** the plugins path defaults to the
``plugins/`` folder at the repo root (two parents up from this
``backend/plugins/`` package) but can be overridden with the
``NNOEL_PLUGINS_DIR`` env var for non-Docker setups pointing at, e.g.,
``~/nnoel-plugins``.
"""

import importlib
import logging
import os
import sys
import types
from pathlib import Path
from typing import Any, Callable, Optional

from .protocol import Plugin

log = logging.getLogger(__name__)

# The single plugins directory (volume-mount target in the Docker flow).
# Resolved in this order:
#   1. ``NNOEL_PLUGINS_DIR`` environment variable.
#   2. ``plugins/`` at the repo root (two parents up from this loader).
_PLUGINS_DIR = Path(
    os.environ.get("NNOEL_PLUGINS_DIR")
    or (Path(__file__).resolve().parents[2] / "plugins")
)

# Synthetic parent module name used to import plugins. Chosen to be
# unique enough not to collide with real top-level packages. The
# ``plugins/`` directory itself does NOT need to be a real Python
# package (no ``__init__.py`` at the ``plugins/`` level) thanks to this
# trick.
_PLUGINS_PKG = "nnoel_plugins"


def _setup_plugins_path() -> bool:
    """Install the synthetic parent module so plugins import cleanly.

    Returns ``True`` if the directory exists and the synthetic
    package was (or already was) installed, ``False`` if the
    directory is missing (in which case no plugins can load and
    the caller should treat that as "zero plugins").
    """
    if not _PLUGINS_DIR.is_dir():
        return False
    if _PLUGINS_PKG not in sys.modules:
        pkg = types.ModuleType(_PLUGINS_PKG)
        # ``__path__`` is what makes ``import x.y`` look inside this
        # directory for subpackages. Pinning it to exactly the
        # plugins dir avoids ever picking up unrelated packages that
        # might share the name on sys.path.
        pkg.__path__ = [str(_PLUGINS_DIR)]
        sys.modules[_PLUGINS_PKG] = pkg
    return True


def _load_plugin(plugin_id: str, plugin_dir: Path) -> Optional[Plugin]:
    """Import a single plugin's ``backend/plugin.py`` and return the ``Plugin`` instance."""
    backend_dir = plugin_dir / "backend"
    module_path = backend_dir / "plugin.py"
    if not module_path.is_file():
        log.debug("Plugin %r has no backend/plugin.py; skipping", plugin_id)
        return None
    fqmn = f"{_PLUGINS_PKG}.{plugin_id}.backend.plugin"
    try:
        module = importlib.import_module(fqmn)
    except Exception:  # noqa: BLE001
        log.exception("Plugin %r failed to import; skipping", plugin_id)
        return None
    candidate = getattr(module, "plugin", None)
    if candidate is None:
        log.warning("Plugin %r: backend/plugin.py has no 'plugin' attribute; skipping", plugin_id)
        return None
    if not isinstance(candidate, Plugin):
        log.warning(
            "Plugin %r: 'plugin' attribute does not satisfy the Plugin Protocol; skipping",
            plugin_id,
        )
        return None
    return candidate


def _discover() -> list[Plugin]:
    """Walk ``plugins/<id>/`` and return loaded plugin instances.

    A plugin only needs ``plugins/<id>/backend/plugin.py`` to be
    picked up; the ``frontend/`` half is optional (and the frontend
    side handles its own copy/rebuild flow). Sorted by ``id`` so
    aggregation order (and the ``/config`` payload) is stable across
    runs. Non-directory entries, hidden directories, and packages
    without a valid ``backend/plugin.py`` are silently skipped —
    discovery is meant to be best-effort.

    Id collisions (two plugins declaring the same ``id``) are
    detected here and a warning is logged. The second-encountered
    plugin wins in the ``HANDLERS`` and ``TOOLS`` maps (because
    dict assignment) but BOTH appear in the ``routers`` /
    ``system_prompt_fragments`` / ``frontend_manifests`` lists —
    which is the inconsistent state the warning is meant to flag.
    """
    if not _setup_plugins_path():
        log.info("No plugins directory at %s; running with zero plugins", _PLUGINS_DIR)
        return []
    # Key by the plugin's ``id`` attribute (NOT the folder name) —
    # the folder is just a path on disk, the ``id`` is the plugin's
    # actual identity. Two folders with different names can declare the
    # same ``id`` and silently clash in the aggregated maps if we
    # keyed by folder. Sorting the final list by ``id`` (not folder)
    # also keeps ``/config`` output stable when folders are renamed.
    by_id: dict[str, Plugin] = {}
    by_folder: dict[str, str] = {}  # folder -> id, for the warning message
    for entry in sorted(_PLUGINS_DIR.iterdir(), key=lambda p: p.name):
        if not entry.is_dir() or entry.name.startswith(("_", ".")):
            continue
        loaded = _load_plugin(entry.name, entry)
        if loaded is None:
            continue
        pid = loaded.id
        if pid in by_id:
            log.warning(
                "Plugin id collision: %r is declared by both "
                "``%s/`` and ``%s/`` — the second-encountered one wins. "
                "This causes inconsistent state (some maps get one, "
                "others get both). Rename one folder or change one "
                "plugin's ``id`` attribute to a unique value.",
                pid, by_folder[pid], entry.name,
            )
        by_id[pid] = loaded
        by_folder[pid] = entry.name
    return [by_id[pid] for pid in sorted(by_id)]


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
