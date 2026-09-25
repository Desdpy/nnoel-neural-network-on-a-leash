import type { ComponentType } from "react";

// A UI surface that a core feature contributes to the menu shell.
//
// Core features are first-class menu entries that ship with the
// frontend itself (unlike plugins, which live outside the Vite
// root under ``../../plugins/``). They are discovered at build /
// dev time via ``./registry.ts`` and rendered identically to
// plugins — same satellite style, hover behavior, pulse animation
// — but use a distinct color and a pinned position so they read
// as system features rather than user apps.
//
// This file mirrors ``src/plugins/types.ts`` deliberately so the
// two systems stay in lock-step; if you add a field here, mirror
// it in ``PluginUi`` too.
export interface CoreMenuEntry {
  // Stable identifier (e.g. ``"settings"``, ``"help"``).
  id: string;
  // Human-readable label.
  label: string;
  // Optional React component rendered when the entry is opened.
  component?: ComponentType;
  icon?: string | null;
  // Where on the sphere this entry sits. Core entries are pinned
  // (not auto-distributed like plugins) so they're always findable
  // regardless of how the globe is rotated.
  position: [number, number, number];
  // Visual scale relative to a plugin satellite. ``>1`` makes the
  // ball visibly larger so it reads as a primary system feature.
  scale?: number;
}