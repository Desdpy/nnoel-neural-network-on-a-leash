#!/usr/bin/env bash
# Normalise the co-located user plugin dir into the frontend tree so
# Vite/TypeScript can resolve ``node_modules`` against the plugin
# code. The backend doesn't need this step (Python imports the
# co-located ``plugins/<id>/backend/`` directly via a synthetic
# package), but the frontend MUST live inside the Vite project for
# Vite's module resolution to work.
#
# Source:      ``$PLUGINS_DIR/<id>/frontend/``  (co-located, mounted)
# Destination: ``frontend/src/plugins/user/<id>/``  (inside Vite)
#
# The script is idempotent and safe to run on every container start
# and every local dev run. It removes stale destination folders for
# plugins that no longer exist on the source side, then copies each
# ``<id>/frontend/`` into the Vite tree. ``.gitkeep`` files in the
# destination are preserved so the empty-mount case (no plugins)
# keeps the dir tracked by git.
#
# **Coupling note:** the destination directory name (`user`) and
# the subdir name are the single shared key between this script and
# the frontend's `import.meta.glob` pattern in
# ``frontend/src/plugins/registry.ts``. If you rename one, rename
# the other — they must agree or plugins silently fail to load.

set -eu

# ``PLUGINS_DIR`` mirrors the registry's resolution order: the env
# var first, then the conventional ``plugins/`` at the repo root
# (``/app/plugins`` in the container).
PLUGINS_DIR="${PLUGINS_DIR:-${NNOEL_PLUGINS_DIR:-/app/plugins}}"
# ``FRONTEND_USER_DIR`` is where the frontend halves get copied to
# (inside the Vite project so module resolution works). Container
# default is ``/app/frontend/src/plugins/user``; local dev can
# override to a repo-relative path. The ``user`` segment MUST
# match the glob path in ``frontend/src/plugins/registry.ts``.
FRONTEND_USER_DIR="${FRONTEND_USER_DIR:-/app/frontend/src/plugins/user}"

# If the plugins dir doesn't exist (e.g. first run, no mount), there
# is nothing to sync. Create the target dir so Vite's glob has a
# stable path to scan, then exit quietly.
if [ ! -d "$PLUGINS_DIR" ]; then
    mkdir -p "$FRONTEND_USER_DIR"
    exit 0
fi

mkdir -p "$FRONTEND_USER_DIR"

# 1. Remove stale destination folders for plugins whose ``frontend/``
#    half no longer exists on the source side. We only remove
#    ``<id>/`` subdirs (not stray files), and we leave ``.gitkeep``
#    in place (it's the only file in the empty case).
for dest in "$FRONTEND_USER_DIR"/*/; do
    [ -d "$dest" ] || continue
    name=$(basename "$dest")
    if [ ! -d "$PLUGINS_DIR/$name/frontend" ]; then
        rm -rf "$dest"
    fi
done

# 2. Copy each plugin's ``frontend/`` half into the Vite tree. We
#    wipe the destination's non-``.gitkeep`` contents first so removed
#    files in the source don't linger in the copy.
for src in "$PLUGINS_DIR"/*/frontend; do
    [ -d "$src" ] || continue
    name=$(basename "$(dirname "$src")")
    dest="$FRONTEND_USER_DIR/$name"
    mkdir -p "$dest"
    # Wipe stale files but keep .gitkeep. ``shopt -s dotglob`` would
    # include dotfiles if we needed to wipe a .gitkeep too, but we
    # don't — .gitkeep is the marker that keeps the dir tracked.
    rm -rf "$dest"/* 2>/dev/null || true
    # Copy contents (cp -rT copies the *contents* of src into dest).
    cp -rT "$src" "$dest"
done

echo "[sync_plugins] Synchronised plugins into $FRONTEND_USER_DIR"
