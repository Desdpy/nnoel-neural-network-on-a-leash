"""Backend plugin registry and aggregation.

A plugin is a self-contained subpackage of this directory: drop a folder
like ``plugins/<id>/`` containing an ``__init__.py`` and a ``plugin.py``
that exposes a module-level ``plugin = MyPlugin()`` instance satisfying
the :class:`Plugin` Protocol. Importing this package triggers the
discovery pass and aggregates every plugin into the module-level
structures the rest of the backend consumes (``TOOLS``, ``HANDLERS``,
``execute``, ``routers``, ``system_prompt_fragments``,
``frontend_manifests``).
"""

from .registry import (
    HANDLERS,
    TOOLS,
    execute,
    frontend_manifests,
    routers,
    system_prompt_fragments,
)
from .protocol import FrontendManifest, Plugin, TaskbarEntry, ToolDef

__all__ = [
    "TOOLS",
    "HANDLERS",
    "execute",
    "routers",
    "system_prompt_fragments",
    "frontend_manifests",
    "Plugin",
    "ToolDef",
    "TaskbarEntry",
    "FrontendManifest",
]
