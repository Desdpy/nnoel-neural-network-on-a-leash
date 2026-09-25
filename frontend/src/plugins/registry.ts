import type { PluginUi } from "./types";

// Discover every plugin entry point.
//
// The glob is evaluated by Vite at build / dev time (the path must
// be a literal — Vite parses globs statically), so adding a new
// plugin is as simple as creating a folder with that shape — no
// edits here required.
//
// ``../plugins/`` lives outside the Vite root, so
// ``vite.config.ts`` explicitly adds it to ``server.fs.allow``.
//
// Each module is expected to export a default ``PluginUi``. Modules
// that don't (e.g. partial migrations, broken builds) are silently
// skipped so a single broken plugin can't take down the whole shell.
const modules = import.meta.glob<{ default: PluginUi }>(
  "../../../plugins/*/frontend/index.tsx",
  { eager: true }
);

export const pluginUis: PluginUi[] = Object.values(modules)
  .map((m) => m.default)
  .filter((ui): ui is PluginUi => Boolean(ui && ui.id));