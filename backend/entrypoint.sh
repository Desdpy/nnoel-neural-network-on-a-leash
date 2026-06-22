#!/usr/bin/env bash
# Container entrypoint: normalise the user plugin dir into the
# frontend tree, optionally rebuild the frontend bundle, then exec
# the backend. Runs at every ``docker compose up`` / restart so user
# plugins added on the host (mounted at ``/app/plugins``) are picked
# up without rebuilding the image.

set -eu
cd /app

# 1. Sync: copy each ``plugins/<id>/frontend/`` (from the host mount)
#    into ``frontend/src/plugins/user/<id>/`` (inside the Vite
#    project) so Vite's module resolution works.
bash backend/sync_plugins.sh

# 2. If any user frontend plugins are now in the Vite tree, rebuild
#    the bundle so the browser gets the new panels. Skipped (zero
#    overhead) when nothing's mounted.
if [ -d frontend/src/plugins/user ] && \
   find frontend/src/plugins/user -name 'index.ts' -print -quit | grep -q .; then
    echo "[entrypoint] User frontend plugins detected, rebuilding bundle..."
    ( cd frontend && npm run build )
else
    echo "[entrypoint] No user frontend plugins, using prebuilt dist."
fi

# 3. Hand off to the backend. Python imports the co-located
#    ``plugins/<id>/backend/`` at startup via the synthetic-package
#    registry, so any backend plugins mounted on the host are
#    loaded here without any image rebuild.
echo "[entrypoint] Starting backend..."
exec python3 backend/server.py
