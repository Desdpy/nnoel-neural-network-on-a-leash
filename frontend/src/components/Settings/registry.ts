import type { CoreMenuEntry } from "./types";

// Discover core feature entry points living in this directory.
//
// Each core feature ships as ``components/Settings/<name>/index.tsx``
// (or just ``components/Settings/index.tsx`` for a single-feature
// directory). The module must default-export a ``CoreMenuEntry``.
//
// ``import.meta.glob`` with ``eager: true`` resolves everything at
// build / dev time, so adding a new core feature is just dropping
// another folder or ``index.tsx`` here — no edits to this file.
const modules = import.meta.glob<{ default: CoreMenuEntry }>(
  "./index.{ts,tsx}",
  { eager: true }
);

export const coreEntries: CoreMenuEntry[] = Object.values(modules)
  .map((m) => m.default)
  .filter((entry): entry is CoreMenuEntry => Boolean(entry && entry.id));

// Reserved color for core entries — a pale cool-blue, brighter
// and cooler than the plugin palette so it reads as "system"
// rather than "app".
export const CORE_COLOR = { r: 200, g: 220, b: 255, hex: 0xc8dcff };