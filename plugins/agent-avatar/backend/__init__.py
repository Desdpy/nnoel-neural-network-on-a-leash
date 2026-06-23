"""Nnoel agent-avatar plugin (backend).

Provides a static UI surface for the agent avatar panel: declares the
Dockview component id and a default floating-panel spec so the panel
is registered in the ``/config`` payload, the frontend registry can
discover it at build time, and the dockview startup in ``App.tsx``
can mount it next to the chat panel. The plugin has no LLM tool,
no HTTP endpoints, and no system-prompt guidance — the avatar is
purely a presentational component whose animation hooks live on the
frontend side. The plugin is discovered and aggregated by
:mod:`backend.plugins.registry` at server startup; no other code
needs to import it directly.
"""
