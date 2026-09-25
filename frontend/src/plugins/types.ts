import type { ComponentType } from "react";

// A UI surface that a plugin contributes to the frontend shell.
//
// Plugins live at ``../../plugins/<id>/frontend/`` (outside the Vite root),
// so they are loaded via Vite's glob import in ``registry.ts``. Each plugin
// exports a default ``PluginUi`` describing how it should appear.
//
// This file is intentionally tiny — concrete shapes (chat panels, tools,
// taskbar entries, …) can be added incrementally as the shell grows.
export interface PluginUi {
  // Stable identifier; should match the plugin folder name (e.g. ``nnoel-time-plugin``).
  id: string;
  // Human-readable label for menus / debug surfaces.
  label: string;
  // Optional React component rendered when the plugin is opened.
  // Keep it lazy / optional so a plugin can ship metadata-only entries.
  component?: ComponentType;
  // Optional icon shown inside the 3D ball. A bare name (e.g.
  // ``"clock"``) is looked up as a Lucide icon. A name ending in
  // ``.png`` / ``.svg`` is loaded from ``/icons/`` (the Vite
  // ``public/`` directory). ``undefined`` = no icon.
  icon?: string | null;
}