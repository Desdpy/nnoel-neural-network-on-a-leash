/** Frontend plugin discovery and aggregation.
 *
 * Uses Vite's `import.meta.glob` to eagerly import every plugin
 * `index.ts` at build time (see the glob call below) and builds
 * three registries consumed by the rest of the app:
 *
 * - `pluginComponents` map: panelComponentId to React component,
 *   merged into Dockview's `components` prop.
 * - `pluginToolToPanel` map: toolName to ToolPanelSpec, used by
 *   ChatPanel to open a panel when the LLM emits a matching tool
 *   result.
 * - `pluginTaskbarEntries` list: rendered by TaskBar alongside the
 *   core entries (chat/agent/settings).
 *
 * The glob targets the `user` subdirectory of this directory (one
 * level deep into `user`, then any plugin id) — i.e. the
 * normalisation target where the entrypoint / start script copies
 * each `plugins/<id>/frontend/`. The container's
 * `backend/entrypoint.sh` (and `startProd.sh` locally) runs
 * `backend/sync_plugins.sh` to copy each `plugins/<id>/frontend/`
 * from the (mounted or repo) plugin dir into
 * `frontend/src/plugins/user/<id>/` before the Vite build, so the
 * glob finds them. The `user` namespace keeps user plugin
 * artefacts separate from the loader files (`registry.ts`,
 * `types.ts`) in this same directory.
 *
 * **Coupling note:** the user-dir name (`user`) and the Vite
 * glob pattern here MUST match the destination directory in
 * `backend/sync_plugins.sh` (`$FRONTEND_USER_DIR`). If you rename
 * one, rename the other — they are a single shared key. The
 * `App.tsx` startup validator also reads the manifest from
 * `/config` and compares it against `pluginComponents` to catch
 * a panelComponentId mismatch between the two halves.
 */

import type {
    FrontendPlugin,
    TaskbarEntry,
    ToolPanelSpec,
} from "./types";

// Eagerly import every plugin's index.ts. The glob pattern must
// match the destination side in `backend/sync_plugins.sh` —
// that's the single shared key between sync and the Vite build.
// Vite statically analyses the glob at build time and rejects
// template literals with variables, so the path has to be a
// plain string literal here. If you rename the user dir, update
// this glob, the sync script's $FRONTEND_USER_DIR default, and
// the JSDoc cross-reference in sync_plugins.sh. Three places,
// one key.
const modules = import.meta.glob<{ default: FrontendPlugin }>(
    "./user/*/index.ts",
    { eager: true },
);

const loaded: FrontendPlugin[] = [];
for (const [path, mod] of Object.entries(modules)) {
    const plugin = mod?.default;
    if (!plugin || typeof plugin !== "object" || !("id" in plugin)) {
        console.warn(`[plugins] skipping ${path}: no default FrontendPlugin export`);
        continue;
    }
    loaded.push(plugin);
}

// Sort by id so ordering is stable across runs (helps with snapshot
// tests and makes the taskbar list deterministic).
loaded.sort((a, b) => a.id.localeCompare(b.id));

export const pluginComponents: Record<string, FrontendPlugin["component"]> = (() => {
    const map: Record<string, FrontendPlugin["component"]> = {};
    for (const p of loaded) {
        if (p.component && p.panelComponentId) {
            map[p.panelComponentId] = p.component;
        }
    }
    return map;
})();

export const pluginToolToPanel: Record<string, ToolPanelSpec> = (() => {
    const map: Record<string, ToolPanelSpec> = {};
    for (const p of loaded) {
        if (p.toolToPanel && p.toolName) {
            map[p.toolName] = p.toolToPanel;
        }
    }
    return map;
})();

export const pluginTaskbarEntries: TaskbarEntry[] = loaded
    .map((p) => p.taskbar)
    .filter((entry): entry is TaskbarEntry => Boolean(entry));
