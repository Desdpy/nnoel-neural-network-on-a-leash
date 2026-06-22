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
 * The glob walks up out of this directory to the repo root and
 * picks up each `plugins/<id>/frontend/index.ts` directly. No copy
 * step is needed: the `@` alias in `vite.config.ts` resolves to
 * an absolute path, so plugin files (which live outside the Vite
 * project) can still import `@/lib/logger`, `@/components/ui/...`
 * and `@/plugins/types` from the frontend tree. In Docker the
 * `./plugins:/app/plugins` volume mount makes the host's plugin
 * dir visible at the same path the glob expects, so the same
 * glob works in dev, `startProd.sh`, and the container.
 *
 * **Coupling note:** the glob pattern here MUST match the plugin
 * layout under `plugins/<id>/frontend/`. If you add a deeper
 * subdir or rename `frontend/`, update this glob and the path
 * references in `start.sh` / `startProd.sh` / the Dockerfile.
 * The `App.tsx` startup validator also reads the manifest from
 * `/config` and compares it against `pluginComponents` to catch
 * a panelComponentId mismatch between the two halves.
 */

import type {
    FrontendPlugin,
    TaskbarEntry,
    ToolPanelSpec,
} from "./types";

// Eagerly import every plugin's index.ts. The glob walks up three
// levels (out of `frontend/src/plugins/`, out of `frontend/src/`,
// out of `frontend/`) to reach the repo root, then matches each
// `plugins/<id>/frontend/index.ts`. Vite statically analyses the
// glob at build time and rejects template literals with variables,
// so the path has to be a plain string literal here. If you
// reorganise the plugins dir, update this glob and the plugin
// layout references in `start.sh` / `startProd.sh` / the
// Dockerfile.
const modules = import.meta.glob<{ default: FrontendPlugin }>(
    "../../../plugins/*/frontend/index.ts",
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
