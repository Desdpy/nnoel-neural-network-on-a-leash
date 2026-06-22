"""Reference / example plugin (backend half).

This plugin is a fully-working but intentionally trivial example that
exists to:

1. Demonstrate the shape of a backend plugin end-to-end.
2. Serve as a copy-paste starting point for new plugins.
3. Exercise every optional field of the ``Plugin`` protocol
   (``tools``, ``router``, ``system_prompt``, ``frontend``) so a
   plugin author can see what each one does.

It registers a single tool, ``example_noop``, that does nothing
meaningful — it just echoes back an optional ``note`` string. It also
exposes a ``GET /plugins/example/status`` endpoint and contributes one
line of system-prompt guidance. On the frontend side it adds an
"Example" taskbar shortcut and a minimal panel.

To remove this plugin entirely, delete both ``backend/plugins/example/``
and ``frontend/src/plugins/example/`` and rebuild + restart. To use it
as a starting point for your own plugin, copy both folders to
``backend/plugins/<your_id>/`` and ``frontend/src/plugins/<your_id>/``,
then search-and-replace ``example`` / ``example_noop`` with your own
plugin id and tool name.
"""
