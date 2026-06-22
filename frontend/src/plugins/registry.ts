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
 * The glob is rooted at the same directory as this registry
 * (i.e. `frontend/src/plugins/`) and runs at build time. The
 * Dockerfile copies the whole frontend tree into the builder
 * stage so plugin folders are included automatically.
 */

import type {
  FrontendPlugin,
  TaskbarEntry,
  ToolPanelSpec,
} from "./types";

// Eagerly import every plugin's index.ts. The glob is rooted at the
// same directory as this registry file (i.e. `frontend/src/plugins/`),
// so any sibling subfolder with an `index.ts` is picked up. `eager:
// true` makes the glob resolve at build time so the resulting bundles
// are static (no runtime fetch). The `default` export is expected to
// be a FrontendPlugin.
const modules = import.meta.glob<{ default: FrontendPlugin }>(
  "./*/index.ts",
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
