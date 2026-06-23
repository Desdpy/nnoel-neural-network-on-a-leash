"""Agent-avatar plugin entry point.

Exposes the :class:`AgentAvatarPlugin` instance as ``plugin`` so the
registry's ``importlib.import_module("plugins.agent-avatar.plugin")``
can pick it up. This plugin is UI-only: it ships no LLM tool, no
custom HTTP router, and no system-prompt fragment (each is left at
its protocol-mandated empty default so the aggregator filters it
out). The frontend half lives at
``plugins/agent-avatar/frontend/index.ts``; the two are paired by
the shared ``id = "agent-avatar"`` and the ``panel_component =
"agentAvatarPanel"`` hook the two sides together at runtime
(frontend registry discovers the TSX at build time; backend
registry imports this module at server start).
"""


class AgentAvatarPlugin:
    """Backend half of the agent-avatar plugin.

    Paired with the frontend half at
    ``plugins/agent-avatar/frontend/index.ts``; the shared
    ``id = "agent-avatar"`` and the ``panel_component =
    "agentAvatarPanel"`` hook the two sides together at runtime
    (frontend registry discovers the TSX at build time; backend
    registry imports this module at server start).
    """

    id = "agent-avatar"
    # UI-only plugin: no LLM tool, so the tool list is empty. The
    # registry skips plugins with no tools when building the
    # ``/tools`` surface, which is the desired behaviour here — the
    # avatar is opened on demand by the user via the taskbar and
    # does not respond to LLM tool calls.
    tools: list[dict] = []
    # No HTTP router: the avatar's PNG is bundled with the frontend
    # (Vite-imported in ``AgentAvatarPanel.tsx``), so the plugin
    # owns all of its assets and needs no core endpoints.
    router = None
    # No system-prompt guidance: the avatar is not an LLM-callable
    # tool, so the prompt stays clean. The registry filters out
    # empty fragments before concatenating them.
    system_prompt: str = ""
    # Frontend manifest: the dockview component id, a default
    # floating-panel spec, and a taskbar shortcut entry that
    # mirrors the one in the frontend manifest. Mirrored on the
    # backend so the ``/config`` payload can advertise the panel
    # and its taskbar shortcut without the frontend having to
    # know about this plugin ahead of time.
    frontend = {
        "panel_component": "agentAvatarPanel",
        "panel_spec": {
            "id": "agent-avatar",
            "component": "agentAvatarPanel",
            "title": "Avatar",
            "floating": {"width": 360, "height": 360},
        },
        "taskbar": {
            "id": "agent-avatar",
            "label": "Avatar",
            "icon": "bot",
            "toolName": "show_agent_avatar",
        },
    }


plugin = AgentAvatarPlugin()
