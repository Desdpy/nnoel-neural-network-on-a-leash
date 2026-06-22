#!/usr/bin/env bash
# Container entrypoint: optionally rebuild the frontend bundle to
# pick up user plugins mounted at ``/app/plugins``, then exec the
# backend. Runs at every ``docker compose up`` / restart so user
# plugins added on the host are picked up without rebuilding the
# image. The Vite glob in ``frontend/src/plugins/registry.ts``
# walks up to the repo root and globs ``plugins/*/frontend/index.ts``
# directly, so no copy/sync step is needed — the same path the
# host uses is visible in the container via the volume mount.

set -eu
cd /app

# If any user frontend plugins are mounted, rebuild the bundle so
# the browser gets the new panels. The glob picks them up
# automatically; we just need to trigger ``npm run build``. Skipped
# (zero overhead) when the plugins mount is empty.
if [ -d /app/plugins ] && \
   find /app/plugins -mindepth 2 -name 'index.ts' -path '*/frontend/*' -print -quit | grep -q .; then
    echo "[entrypoint] User frontend plugins detected, rebuilding bundle..."
    ( cd frontend && npm run build )
else
    echo "[entrypoint] No user frontend plugins, using prebuilt dist."
fi

# Hand off to the backend. Python imports the co-located
# ``plugins/<id>/backend/`` at startup via the synthetic-package
# registry, so any backend plugins mounted on the host are
# loaded here without any image rebuild.
echo "[entrypoint] Starting backend..."
exec python3 backend/server.py
