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
import type { LucideIcon } from "lucide-react";

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
  /**
   * When true, the taskbar launcher (and any other path that calls
   * ``openPluginPanel``) reuses the existing single-instance panel
   * instead of spawning a new one. Used by plugins whose panel is
   * singleton — e.g. the agent-avatar, which is mounted at startup
   * and should only ever have one instance, so a taskbar click
   * focuses it rather than creating a duplicate.
   */
  focusExisting?: boolean;
}

export interface TaskbarEntry {
  id: string;
  label: string;
  /**
   * String name of the icon. Mirrored in the backend manifest so the
   * ``/config`` payload stays serialisable, and used by the taskbar
   * to look the icon up in its (core) fallback registry when the
   * plugin does not self-host an icon via the ``Icon`` field below.
   */
  icon: string;
  toolName: string;
  /**
   * Lucide component to render for the taskbar shortcut. Takes
   * precedence over ``iconRegistry[icon]`` so a plugin can ship its
   * own icon (importing ``lucide-react`` directly in its ``index.ts``)
   * without having to register the string name in the core taskbar.
   * Strongly preferred for plugin-authored taskbar entries — the
   * string-only path is kept as a fallback for built-in icons.
   */
  Icon?: LucideIcon;
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
