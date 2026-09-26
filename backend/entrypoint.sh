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

# --- Config sanity check. ---
# ``config.py`` reads a single file, ``/app/config.toml``, and opens it
# at import time with no fallback, so a missing file means the server
# cannot boot. The image bakes the tracked ``config.example.toml`` in
# under that name; the dev compose file bind-mounts the host
# ``config.toml`` over it. If the mount is ever a directory (e.g. a
# stray ``config.toml/`` on the host) or the baked copy is gone, fail
# with an actionable message instead of a TOML parse traceback.
if [ ! -f /app/config.toml ]; then
    echo "[entrypoint] ERROR: /app/config.toml is not a readable file." >&2
    echo "[entrypoint] The server needs it (backend/config.py opens it at" >&2
    echo "[entrypoint] startup with no fallback). Fix with:" >&2
    echo "[entrypoint]     cp config.example.toml config.toml" >&2
    echo "[entrypoint] If a config.toml DIRECTORY exists on the host, remove" >&2
    echo "[entrypoint] it first — a bind mount cannot shadow a file with a" >&2
    echo "[entrypoint] directory and the container will not start." >&2
    exit 1
fi

# If any user frontend plugins are mounted, rebuild the bundle so
# the browser gets the new panels. The glob picks them up
# automatically; we just need to trigger ``npm run build``. Skipped
# (zero overhead) when the plugins mount is empty. Both entry-point
# spellings are accepted (``index.ts`` and ``index.tsx``) to match
# the glob in ``frontend/src/plugins/registry.ts``.
if [ -d /app/plugins ] && \
   find /app/plugins -mindepth 2 \( -name 'index.ts' -o -name 'index.tsx' \) \
        -path '*/frontend/*' -print -quit | grep -q .; then
    echo "[entrypoint] User frontend plugins detected, rebuilding bundle..."
    # Plugin sources live at ``/app/plugins/<id>/frontend/``, i.e.
    # *outside* the Vite project, so bare imports inside them
    # (``react``, ``three``, …) are resolved by walking up the
    # directory tree looking for ``node_modules``. The image ships
    # ``/app/frontend/node_modules`` only — the repo-root symlink that
    # ``frontend/scripts/sync-root-symlink.cjs`` creates during
    # ``npm install`` on a host machine lives in the *builder* stage
    # (``/build/node_modules``) and never reaches this image. Without
    # recreating it here, ``tsc`` fails plugin sources with TS2307 /
    # TS2875 ("Cannot find module 'react/jsx-runtime'") and, because of
    # ``set -eu``, the container would crash-loop at startup.
    ln -sfn frontend/node_modules /app/node_modules
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
