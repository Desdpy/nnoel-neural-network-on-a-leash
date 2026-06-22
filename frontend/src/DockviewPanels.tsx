import { createContext, useContext } from "react";

// ``ToolPanelSpec`` is owned by the frontend plugin system so all
// plugins (and the registry that aggregates them) can use the same
// type. Re-exported here for backwards compatibility with existing
// imports (``import { ToolPanelSpec } from "./DockviewPanels"``).
export type { ToolPanelSpec } from "./plugins/types";
import type { ToolPanelSpec } from "./plugins/types";

interface DockviewPanelsValue {
  // Open the panel described by ``spec``, seeding it with ``params``.
  // If a panel with ``spec.id`` already exists, its parameters are
  // updated and it is focused instead of creating a new one.
  openOrFocusPanel: (
    spec: ToolPanelSpec,
    params: Record<string, unknown>,
  ) => void;
  // Always open a fresh panel, even if one with ``spec.id`` already
  // exists. The new instance gets a unique id and a cascading
  // floating-panel position so multiple instances of the same tool
  // can sit side by side. Returns the new panel's id.
  openNewPanel: (
    spec: ToolPanelSpec,
    params: Record<string, unknown>,
  ) => string | null;
  // Close the panel with the given id, if it exists. No-op otherwise.
  closePanel: (id: string) => void;
  // Look up the panel spec for a given tool name. Returns undefined if
  // the tool has no associated panel.
  getToolPanel: (toolName: string) => ToolPanelSpec | undefined;
}

const DockviewPanelsContext = createContext<DockviewPanelsValue | null>(null);

export function useDockviewPanels(): DockviewPanelsValue {
  const ctx = useContext(DockviewPanelsContext);
  if (!ctx) {
    throw new Error(
      "useDockviewPanels must be used within a DockviewPanelsProvider",
    );
  }
  return ctx;
}

export { DockviewPanelsContext };
export type { DockviewPanelsValue };
