"""Protocol definitions for the Nnoel plugin system.

A plugin is a single self-contained folder under the repo-root
``plugins/`` directory, paired by a shared ``<id>``:

  - ``plugins/<id>/backend/``  — the Python tool, custom HTTP
    endpoints, system-prompt guidance, and UI manifest. Must expose a
    module-level ``plugin`` attribute satisfying the :class:`Plugin`
    Protocol below.
  - ``plugins/<id>/frontend/`` — the optional React panel component
    and a default-exporting ``index.ts`` manifest. The container's
    entrypoint copies this into the Vite project on startup, then
    rebuilds the bundle so the panels are picked up.

The ``registry.py`` module in this package walks ``plugins/<id>/backend/``
at import time, imports each plugin's ``backend/plugin.py`` as
``nnoel_plugins.<id>.backend.plugin`` (via a synthetic parent module),
and aggregates them into the module-level surface (``TOOLS``,
``HANDLERS``, ``execute``, ``routers``, ``system_prompt_fragments``,
``frontend_manifests``) that the rest of the backend consumes without
needing to know about any individual plugin.
"""

from typing import Any, Callable, Optional, Protocol, TypedDict, runtime_checkable


class ToolDef(TypedDict):
    """A single LLM-callable tool provided by a plugin.

    ``schema`` is the OpenAI-compatible function-calling payload (the
    "function" object, e.g. ``{"name": ..., "description": ...,
    "parameters": ...}``). The registry wraps it in the
    ``{"type": "function", "function": schema}`` envelope that the chat
    completion API expects.

    ``run`` is the executable that the LLM (or the UI, via
    ``POST /tools/{name}``) can call. It receives the LLM's arguments as
    keyword arguments and must return either a plain string (used directly
    as the LLM-visible tool result) or a structured ``{"text": str, ...}``
    dict whose extras are surfaced to the UI for panel rendering.
    """

    schema: dict[str, Any]
    run: Callable[..., Any]


class TaskbarEntry(TypedDict, total=False):
    """Declarative description of a taskbar shortcut in the left sidebar.

    Mirrored on the frontend (``frontend/src/plugins/types.ts``) so a
    plugin's manifest can reference a built-in lucide icon by name without
    importing React components in the manifest itself. ``toolName`` is the
    LLM tool whose panel the shortcut opens when clicked.
    """

    id: str
    label: str
    icon: str
    toolName: str


class FrontendManifest(TypedDict, total=False):
    """Static metadata about a plugin's UI surface, serialised into ``/config``.

    Kept deliberately small: it describes *what* the frontend should expose
    (a dockview panel + a taskbar shortcut) and which dockview component id
    to use. The actual React component, the ``params`` builder, and the
    ``instanceTitle`` callback live in the frontend plugin package and are
    bundled at build time — they are not transferred over the wire.
    """

    panel_component: str
    panel_spec: dict[str, Any]
    taskbar: Optional[TaskbarEntry]


@runtime_checkable
class Plugin(Protocol):
    """The contract every backend plugin must satisfy.

    A plugin is typically implemented as a small class instance assigned to
    ``plugin = MyPlugin()`` at module scope, but any object with these
    attributes (including a ``types.SimpleNamespace``) works. The registry
    performs a structural check via :func:`isinstance` against this
    Protocol at load time and logs a clear error if any required field is
    missing.
    """

    id: str
    tools: list[ToolDef]
    router: Optional[Any]
    system_prompt: str
    frontend: FrontendManifest
