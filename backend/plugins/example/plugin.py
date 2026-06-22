"""Reference / example plugin entry point.

This file is the *only* file the plugin registry looks at. It must
expose a module-level ``plugin`` attribute that satisfies the
:class:`backend.plugins.protocol.Plugin` protocol — a plain object with
``id``, ``tools``, ``router``, ``system_prompt``, and ``frontend``
fields is enough.

The structure below shows the complete, minimal shape of a real plugin.
Every optional field is exercised so a new plugin author can see what
each one is for. Copy this file (and the matching frontend folder) as
the starting point for your own plugin.
"""

from __future__ import annotations

# import logging
from typing import Any

from fastapi import APIRouter

# ---------------------------------------------------------------------------
# 1. The tool the LLM can call.
# ---------------------------------------------------------------------------
# A plugin's tool is defined by two things:
#   - ``SCHEMA``: the OpenAI-compatible function-calling payload that
#     tells the LLM the tool's name, what it does, and what arguments
#     it accepts. Keep the schema small and unambiguous — the model
#     uses this description to decide *when* and *how* to call it.
#   - ``run(**kwargs)``: the executable. Receives the LLM's arguments
#     as keyword arguments and returns either:
#       * a plain string  (used directly as the LLM-visible result), or
#       * a ``{"text": str, **extras}`` dict, where ``text`` is the
#         LLM-visible string and the extras are forwarded to the
#         frontend panel as the panel's ``extra`` parameter (useful
#         for passing structured data the UI needs, e.g. a resolved
#         timezone or a list of suggestions).
#
# The tool defined below, ``example_noop``, takes one optional string
# and echoes it back. It exists purely to exercise the tool-call
# pipeline end-to-end with no real side effects.
SCHEMA: dict[str, Any] = {
    "name": "example_noop",
    "description": (
        "Reference tool that does nothing. Takes an optional short "
        "note and returns a confirmation string. Use it to verify "
        "the plugin system is wired up end-to-end."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "note": {
                "type": "string",
                "description": (
                    "Optional short message. The tool will echo it "
                    "back unchanged so you can confirm round-tripping."
                ),
            },
        },
        # ``additionalProperties: false`` tells the LLM it must not
        # invent extra arguments. Always set this for your own tools
        # so a hallucinated parameter doesn't silently get ignored.
        "additionalProperties": False,
    },
}


def run(note: str = "") -> str:
    """Execute the ``example_noop`` tool.

    Returns a plain string (the LLM-visible result). No side effects,
    no I/O, no state. Replace this body with your real logic.

    If your tool needs to return extra data to the UI (for example, a
    structured payload the panel renders), return a dict like::

        return {"text": "ok", "suggestions": ["a", "b", "c"]}

    The ``text`` field is what the LLM sees; the rest is forwarded to
    the panel's ``params()`` builder on the frontend as ``extra``.
    """
    return f"Example noop executed. note={note!r}"


# ---------------------------------------------------------------------------
# 2. Optional: a FastAPI router with custom HTTP endpoints.
# ---------------------------------------------------------------------------
# If your plugin needs to serve its own HTTP endpoints (autocomplete
# data, status checks, file uploads, anything), define an
# ``APIRouter`` here. The registry auto-mounts it under
# ``/plugins/<id>/...`` at server startup, so a route declared as
# ``@router.get("/status")`` becomes reachable at
# ``GET /plugins/example/status``.
#
# The router is OPTIONAL. If your plugin has no custom endpoints, set
# ``router = None`` in the plugin class below and the registry will
# simply skip it. This router only exists to demonstrate the pattern.
router = APIRouter()


@router.get("/status")
def status() -> dict[str, str]:
    """A trivial endpoint that proves the plugin's router is mounted.

    Real plugins use this kind of endpoint for autocomplete data,
    health checks, or anything else the frontend needs to fetch that
    isn't a tool call. This one is intentionally minimal.
    """
    return {"plugin": "example", "status": "ok"}


# ---------------------------------------------------------------------------
# 3. Optional: per-plugin system-prompt guidance.
# ---------------------------------------------------------------------------
# Anything you put in this string is appended to the LLM's system
# message at the end of the standard prompt. Use it for:
#   - "MUST call this tool for X" rules (the time plugin uses this
#     to force the LLM to call ``get_local_time`` for any time
#     question instead of guessing).
#   - Few-shot examples that demonstrate how to call your tool.
#   - Disclaimers about when *not* to call it.
#
# Empty strings are filtered out by the registry, so it's fine to
# leave this blank while you're prototyping. The string below
# demonstrates the pattern without adding real constraints.
SYSTEM_PROMPT = (
    "You have a reference tool called ``example_noop``. It does "
    "nothing and exists only to verify the plugin pipeline works. "
    "Only call it if the user explicitly asks you to demonstrate "
    "or test the example plugin."
)


# ---------------------------------------------------------------------------
# 4. The plugin class itself.
# ---------------------------------------------------------------------------
# A plugin is any object with the five fields the ``Plugin`` protocol
# requires. Using a plain class (not a dataclass / TypedDict) keeps
# the file copy-pasteable and lets you add helper methods if you
# need them (e.g. shared state, internal helpers). The
# ``@runtime_checkable`` Protocol in ``protocol.py`` will accept any
# object that has these attributes, so a ``types.SimpleNamespace``
# would work too — a class is just clearer.
class ExamplePlugin:
    """The backend half of the example plugin.

    The ``id`` is what the frontend uses to pair this with its
    counterpart in ``frontend/src/plugins/example/index.ts``. The two
    must match exactly.

    The ``frontend`` field is a small serializable manifest that the
    registry forwards to the UI via ``GET /config``. It tells the
    frontend which Dockview component id to mount (``panelComponent``)
    and which taskbar shortcut to render (``taskbar``). The actual
    React component, the ``params()`` builder, and the
    ``instanceTitle()`` callback live in the frontend plugin package
    and are bundled at build time — they're not transferred over
    the wire.
    """

    # ---- Required: unique plugin id (must match the frontend id) ----
    id = "example"

    # ---- Required: list of tool definitions this plugin exposes ----
    # Each entry is a ``ToolDef`` (see ``protocol.py``): a dict with
    # ``schema`` (the OpenAI function payload) and ``run`` (the
    # callable). A plugin can expose zero or more tools.
    tools: list[dict[str, Any]] = [{"schema": SCHEMA, "run": run}]

    # ---- Optional: custom HTTP endpoints (see router above) ----
    # Set to ``None`` if your plugin has no custom endpoints. The
    # registry skips ``None`` routers when wiring up the app.
    router = router

    # ---- Optional: per-plugin prompt fragment (see above) ----
    # Empty string == no contribution. The registry filters empties
    # so they don't add blank lines to the system message.
    system_prompt = SYSTEM_PROMPT

    # ---- Required: UI manifest (serialisable, sent via /config) ----
    # The frontend uses ``panel_component`` to register the Dockview
    # component and ``taskbar`` to render a sidebar shortcut. Both
    # are optional in principle, but if you ship a panel component
    # on the frontend, you should reference it here so the manifest
    # stays in sync with what's bundled.
    frontend = {
        # The Dockview component id registered by the frontend
        # plugin's ``index.ts`` (``panelComponentId``). Keep these
        # two values in sync — the manifest is the source of truth
        # the registry sends to the UI.
        "panel_component": "examplePanel",
        # Optional serialisable description of the panel. The
        # frontend's ``FrontendPlugin.toolToPanel`` spec is the
        # richer source of truth (it carries the ``params`` builder
        # and ``instanceTitle`` callback), but keeping a small
        # declarative copy here makes the manifest self-describing
        # and useful for debugging via ``GET /config``.
        "panel_spec": {
            "id": "example",
            "component": "examplePanel",
            "title": "Example",
            "floating": {"width": 360, "height": 300},
        },
        # Optional taskbar shortcut. ``icon`` is a string key the
        # frontend maps to a lucide-react component (see the
        # ``iconRegistry`` in ``TaskBar.tsx`` for the supported
        # names). ``toolName`` is the LLM tool name whose panel the
        # shortcut should open when clicked — the generic
        # ``openPluginPanel(toolName)`` launcher in ``App.tsx``
        # uses this to find and open the right spec.
        "taskbar": {
            "id": "example",
            "label": "Example",
            "icon": "notebook",
            "action": "launchExample",
            "toolName": "example_noop",
        },
    }


# ---------------------------------------------------------------------------
# 5. The module-level instance the registry looks for.
# ---------------------------------------------------------------------------
# The registry's discovery code does ``getattr(module, "plugin", None)``
# and checks the result against the ``Plugin`` protocol. The name
# ``plugin`` is the contract — it must be a module-level attribute
# named exactly ``plugin``. You can assign any value (the class
# above, an instance, a ``SimpleNamespace``), as long as it satisfies
# the protocol.
plugin = ExamplePlugin()
