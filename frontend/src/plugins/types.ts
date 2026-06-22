/** Shared types for the frontend plugin system.
 *
 * Mirrors the backend's `backend/plugins/protocol.py` (the `TaskbarEntry`
 * shape is the same) and adds the React-specific bits a frontend plugin
 * needs to ship: the panel component, the `params` builder that turns a
 * tool result into panel parameters, and the `instanceTitle` callback
 * that names individual panel instances.
 *
 * A plugin's `index.ts` exports a default `FrontendPlugin` that the
 * registry in `registry.ts` picks up via Vite's `import.meta.glob`.
 */

import type { ComponentType } from "react";

export interface ToolPanelSpec {
  id: string;
  component: string;
  title: string;
  params: (
    args: Record<string, unknown>,
    result: string,
    extra: Record<string, unknown>,
  ) => Record<string, unknown>;
  floating?: { width?: number; height?: number };
  instanceTitle?: (
    args: Record<string, unknown>,
    result: string,
    extra: Record<string, unknown>,
  ) => string;
}

export interface TaskbarEntry {
  id: string;
  label: string;
  icon: string;
  action: string;
  toolName: string;
}

export interface FrontendPlugin {
  /** Plugin id, matches the backend's ``plugin.id``. */
  id: string;
  /**
   * LLM tool name this plugin's panel handles (e.g. ``"get_local_time"``).
   * The frontend registry uses this to build the
   * ``tool name -> ToolPanelSpec`` map that ``ChatPanel`` looks up when
   * the LLM emits a tool result. Required if the plugin ships a panel.
   */
  toolName?: string;
  /**
   * Dockview component id (e.g. ``"timePanel"``). The component itself
   * is registered in the ``components`` map via the ``component`` field.
   */
  panelComponentId: string;
  /** The React component to render inside the dockview panel. */
  // ``any`` here is intentional: dockview's panel components receive
  // a generic ``IDockviewPanelProps<TParams>`` whose ``params`` shape
  // differs per plugin. The plugin author knows their own params type
  // (they wrote the component); the registry just needs to pass the
  // component through to Dockview's ``components`` map, which itself
  // uses a loose prop type.
  component: ComponentType<any>;
  /** Optional: spec describing how to map tool results into panel params. */
  toolToPanel?: ToolPanelSpec;
  /** Optional: taskbar shortcut entry. Omit for backend-only plugins. */
  taskbar?: TaskbarEntry;
}
