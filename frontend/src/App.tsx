import { useEffect, useRef, useState } from "react";
import { DockviewReact, themeGithubDarkSpaced } from "dockview";
import type {
  DockviewTheme,
  DockviewReadyEvent,
  DockviewWillDropEvent,
  GetTabContextMenuItemsParams,
  BuiltInContextMenuItem,
} from "dockview";
import { ChatPanel } from "./components/ChatPanel";
import { NeuralNetworkBackground } from "./components/NeuralNetworkBackground";
import { TaskBar } from "./components/TaskBar";
import {
  DockviewPanelsContext,
  type DockviewPanelsValue,
  type ToolPanelSpec,
} from "./DockviewPanels";
import {
  pluginComponents,
  pluginTaskbarEntries,
  pluginToolToPanel,
} from "./plugins/registry";

// Remember the rect of the last few spawned floating panels so the
// position finder can avoid stacking on top of them in its fallback
// path (when the viewport is full enough that no overlap-free spot
// exists). Capped at a small number — we only need the most recent
// ones to break the deterministic-cascade feel.
const recentSpawnRects: Array<{ x: number; y: number; width: number; height: number }> = [];
const RECENT_SPAWN_LIMIT = 2;

// Pick a random x/y for a new floating panel that doesn't overlap with
// any of the panels already rendered as floating windows, and that
// stays out of the bottom 20% of the chat panel (where the chat input
// area lives). When the viewport is saturated the fallback still
// tries to avoid the most recently spawned panels so successive panels
// don't pile up on the same spot.
//
// Spawn bounds are taken from the dockview container's actual rect,
// NOT the full viewport. The dockview sits inside a flex layout with
// a left taskbar and a right sidebar; using window.innerWidth/Height
// would let panels spawn at coordinates that get clipped by the
// dockview's overflow-hidden and then appear in odd positions when
// the layout resizes. Dockview-relative coordinates are returned so
// they can be passed straight to ``addPanel({ floating: { x, y }})``.
//
// We read existing positions from the DOM rather than from dockview's
// ``floatingGroups`` accessor, because the latter lives on the
// component (not the api exposed via ``onReady``) and the DOM view
// also reflects any user drag/resize that's happened since the panel
// was created. The chat panel is located via the ``data-panel-id``
// attribute set on its root by ``ChatPanel.tsx``.
function findFreeFloatingPosition(
  panelWidth: number,
  panelHeight: number,
): { x: number; y: number } {
  const margin = 16;
  const dockviewEl = document.querySelector(".dv-dockview");
  const dockviewRect =
    dockviewEl instanceof HTMLElement ? dockviewEl.getBoundingClientRect() : null;
  const dockviewLeft = dockviewRect?.left ?? 0;
  const dockviewTop = dockviewRect?.top ?? 0;
  const dockviewWidth = dockviewRect?.width ?? window.innerWidth;
  const dockviewHeight = dockviewRect?.height ?? window.innerHeight;

  // Existing rects in viewport coordinates, so the overlap check can
  // compare them against viewport-coordinate candidate positions.
  const existing: Array<{ x: number; y: number; width: number; height: number }> = [];

  // Reserve the bottom 20% of the chat panel (the chat input strip).
  // If the chat panel isn't mounted (loading, no DOM node), skip the
  // exclusion — better to spawn a panel than to fail to spawn at all.
  // Treated as a hard constraint and re-checked in every fallback
  // tier below, so even when the viewport is so full that we have to
  // give up on avoiding other panels, we still never land on the
  // chat input.
  let chatInputRect: { x: number; y: number; width: number; height: number } | null = null;
  const chatEl = document.querySelector("[data-panel-id='chat']");
  if (chatEl instanceof HTMLElement) {
    const r = chatEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const reservedHeight = Math.max(60, r.height * 0.2);
      chatInputRect = {
        x: r.left,
        y: r.bottom - reservedHeight,
        width: r.width,
        height: reservedHeight,
      };
      existing.push(chatInputRect);
    }
  }

  const host = document.querySelector(".dv-floating-overlay-host");
  if (host) {
    for (const child of Array.from(host.children)) {
      const rect = (child as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      existing.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    }
  }

  const overlapsRect = (x: number, y: number, r: { x: number; y: number; width: number; height: number }) =>
    !(
      x + panelWidth + margin <= r.x ||
      r.x + r.width + margin <= x ||
      y + panelHeight + margin <= r.y ||
      r.y + r.height + margin <= y
    );
  const overlapsAny = (x: number, y: number, rects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>) =>
    rects.some((r) => overlapsRect(x, y, r));

  // Spawn bounds in viewport coordinates, clamped to the dockview
  // container so panels never start in clipped territory.
  const minX = dockviewLeft + margin;
  const minY = dockviewTop + margin;
  const maxX = Math.max(minX, dockviewLeft + dockviewWidth - panelWidth - margin);
  const maxY = Math.max(minY, dockviewTop + dockviewHeight - panelHeight - margin);
  const randomPos = () => ({
    x: minX + Math.random() * (maxX - minX),
    y: minY + Math.random() * (maxY - minY),
  });

  // Convert a viewport-coordinate candidate into the dockview-
  // relative coordinates that ``addPanel({floating:{x,y}})`` expects.
  const toDockview = (p: { x: number; y: number }) => ({
    x: p.x - dockviewLeft,
    y: p.y - dockviewTop,
  });

  // 1) Free spot: no overlap with anything (chat input + existing
  //    floating windows).
  for (let i = 0; i < 200; i++) {
    const p = randomPos();
    if (!overlapsAny(p.x, p.y, existing)) return toDockview(p);
  }

  // 2) Viewport saturated: try to at least not land on top of the
  //    most recently spawned panels. The chat-input exclusion is
  //    still a hard constraint and is re-checked here.
  if (recentSpawnRects.length > 0) {
    for (let i = 0; i < 50; i++) {
      const p = randomPos();
      if (!overlapsAny(p.x, p.y, recentSpawnRects) && (!chatInputRect || !overlapsRect(p.x, p.y, chatInputRect))) {
        return toDockview(p);
      }
    }
  }

  // 3) Still no luck avoiding recent panels — try once more with
  //    only the chat-input exclusion as a hard constraint.
  if (chatInputRect) {
    for (let i = 0; i < 30; i++) {
      const p = randomPos();
      if (!overlapsRect(p.x, p.y, chatInputRect)) return toDockview(p);
    }
  }

  // 4) Genuinely no way to avoid the chat input either (very narrow
  //    viewport). Just pick a random spot so the new panel at least
  //    scatters instead of stacking.
  return toDockview(randomPos());
}

// Dark theme for the dockable panel library
const theme: DockviewTheme = {
  ...themeGithubDarkSpaced,
};

const SIDEBAR_WIDTH = 400;

// Map panel component names to their React components for Dockview.
// Core panels live here; plugin panels are merged in from the registry
// (Vite glob picks up every ``plugins/*/frontend/index.ts`` at build
// time).
const components = {
  chatPanel: ChatPanel,
  ...pluginComponents,
};

function App() {
  // Track whether the left-side taskbar is collapsed (auto-hide on mouse leave)
  const [taskbarCollapsed, setTaskbarCollapsed] = useState(true);
  const taskbarRef = useRef<HTMLDivElement>(null);
  // Holds the Dockview API once it is ready, so the TaskBar can open panels.
  const apiRef = useRef<{
    addPanel: (options: {
      id: string;
      component: string;
      title: string;
      params?: Record<string, unknown>;
      position?: { direction: "right" | "left" | "above" | "below"; referencePanel: string };
      floating?: true | { x?: number; y?: number; width?: number; height?: number };
    }) => unknown;
    getPanel: (id: string) =>
      | {
          api: {
            setActive(): void;
            focus(): void;
            updateParameters(params: Record<string, unknown>): void;
          };
        }
      | undefined;
    removePanel: (panel: object) => void;
  } | null>(null);

  // Mapping from LLM tool name to the panel that should open when the
  // LLM calls it. Plugin panels are merged in from the registry so
  // adding a new tool with a GUI panel never requires editing this
  // file — just drop a new ``frontend/src/plugins/<id>/index.ts``.
  const toolToPanel = useRef<Record<string, ToolPanelSpec>>({
    ...pluginToolToPanel,
  }).current;

  // Counter for unique panel ids when opening multiple instances of the
  // same tool (e.g. several "Time in <city>" panels from one chat turn).
  const panelInstanceCounter = useRef(0);

  // Open the panel described by ``spec`` — creating it with the given
  // parameters if it doesn't exist, or focusing it and pushing the new
  // parameters if it does.
  const openOrFocusPanel = (
    spec: ToolPanelSpec,
    params: Record<string, unknown>,
  ) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel(spec.id);
    if (existing) {
      existing.api.updateParameters(params);
      existing.api.setActive();
      existing.api.focus();
      return;
    }
    api.addPanel({
      id: spec.id,
      component: spec.component,
      title: spec.title,
      params,
      floating: spec.floating ?? true,
    });
  };

  // Close the panel with the given id. No-op if the panel doesn't exist
  // (e.g. the user already closed it, or it never opened).
  const closePanel = (id: string) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel(id);
    if (existing) api.removePanel(existing);
  };

  // Always create a fresh panel — even if a panel with ``spec.id``
  // already exists. Used by the chat so each LLM tool result can have
  // its own panel, instead of being merged into whichever was opened
  // first. Each new instance gets:
  //   * a unique id (``spec.id_<n>``) so dockview can host several
  //   * a per-instance title (e.g. "Time in Tokyo") so they're
  //     distinguishable in the tab strip
  //   * a random x/y that doesn't overlap with any other open
  //     floating window, with a deterministic cascade as a fallback
  // Returns the new panel's id, or null if the dockview API isn't
  // ready yet.
  const openNewPanel = (
    spec: ToolPanelSpec,
    params: Record<string, unknown>,
  ): string | null => {
    const api = apiRef.current;
    if (!api) return null;
    const n = ++panelInstanceCounter.current;
    const id = `${spec.id}_${n}`;
    const instanceTitle = spec.instanceTitle
      ? spec.instanceTitle(params, "", {})
      : spec.title;
    const baseFloating =
      typeof spec.floating === "object" && spec.floating
        ? spec.floating
        : { width: 360, height: 360 };
    const panelWidth = baseFloating.width ?? 360;
    const panelHeight = baseFloating.height ?? 360;
    const dockviewPos = findFreeFloatingPosition(panelWidth, panelHeight);
    // Record this spawn in viewport coordinates so the next call's
    // overlap check (which also uses viewport coords) can compare
    // apples to apples.
    const dockviewEl = document.querySelector(".dv-dockview");
    const dockviewRect =
      dockviewEl instanceof HTMLElement ? dockviewEl.getBoundingClientRect() : null;
    const dockviewLeft = dockviewRect?.left ?? 0;
    const dockviewTop = dockviewRect?.top ?? 0;
    recentSpawnRects.push({
      x: dockviewPos.x + dockviewLeft,
      y: dockviewPos.y + dockviewTop,
      width: panelWidth,
      height: panelHeight,
    });
    if (recentSpawnRects.length > RECENT_SPAWN_LIMIT) recentSpawnRects.shift();
    api.addPanel({
      id,
      component: spec.component,
      title: instanceTitle,
      params,
      floating: { x: dockviewPos.x, y: dockviewPos.y, ...baseFloating },
    });
    return id;
  };

  // Open a fresh panel for the given LLM tool name as a floating dock.
  // Each click (from the taskbar or any other source) spawns a new
  // instance, so the user can have several side by side. The panel
  // auto-fetches on mount when it has no seeded result. This is the
  // generic launcher used by every plugin's taskbar shortcut; a
  // plugin's ``taskbar.toolName`` is what we look up here.
  //
  // Plugins whose panel is singleton (only one instance should ever
  // exist — e.g. a single agent-avatar) set ``focusExisting: true``
  // on their ``ToolPanelSpec``; the launcher then reuses the existing
  // instance via ``openOrFocusPanel`` instead of spawning a new one.
  const openPluginPanel = (toolName: string) => {
    const spec = toolToPanel[toolName];
    if (!spec) return;
    const params = spec.params({}, "", {});
    if (spec.focusExisting) {
      openOrFocusPanel(spec, params);
    } else {
      openNewPanel(spec, params);
    }
  };

  // Stable value for the context so consumers don't re-render on every
  // parent render.
  const panelsContextValue = useRef<DockviewPanelsValue>({
    openOrFocusPanel,
    openNewPanel,
    closePanel,
    getToolPanel: (name) => toolToPanel[name],
  }).current;
  // Keep the callbacks pointed at the latest closures (which read from
  // ``apiRef.current``) without changing the context identity.
  panelsContextValue.openOrFocusPanel = openOrFocusPanel;
  panelsContextValue.openNewPanel = openNewPanel;
  panelsContextValue.closePanel = closePanel;

  // Auto-hide/show the taskbar based on mouse position. Expand is
  // delayed by 100ms (matching the dock bar) so a quick cursor pass
  // doesn't flash the sidebar open; collapse stays instant.
  useEffect(() => {
    let wasInside = false;
    let expandTimer: number | undefined;

    const cancelPending = () => {
      if (expandTimer !== undefined) {
        clearTimeout(expandTimer);
        expandTimer = undefined;
      }
    };

    const scheduleExpand = () => {
      cancelPending();
      expandTimer = window.setTimeout(() => {
        setTaskbarCollapsed(false);
        expandTimer = undefined;
      }, 100);
    };

    function onMove(e: MouseEvent) {
      const el = taskbarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      if (inside && !wasInside) {
        // Cursor just entered — schedule a delayed expand.
        scheduleExpand();
      } else if (!inside && wasInside) {
        // Cursor just left — cancel any pending expand and collapse now.
        cancelPending();
        setTaskbarCollapsed(true);
      }
      wasInside = inside;
    }

    function onLeave() {
      cancelPending();
      setTaskbarCollapsed(true);
    }

    // mouseenter on the element itself fires reliably even when the
    // cursor enters the browser window from outside (e.g. from the OS
    // chrome on the left), which document-level mousemove can miss if
    // the cursor doesn't move after entry.
    const el = taskbarRef.current;
    el?.addEventListener("mouseenter", scheduleExpand);

    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave, { passive: true });
    return () => {
      cancelPending();
      el?.removeEventListener("mouseenter", scheduleExpand);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // Called once the Dockview layout is ready — set up panels and interactivity
  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api as unknown as typeof apiRef.current;

    // Prevent dropping tabs into the center of a grid group (only side-docking allowed)
    api.onWillShowOverlay((event) => {
      if (event.group?.api.location.type !== "grid") return;
      if (event.kind === "tab") {
        event.preventDefault();
      }
      if (event.kind === "content" && event.position === "center") {
        event.preventDefault();
      }
    });

    // Add the chat panel on the left. Plugin panels (including the
    // agent avatar) are opened on demand by the user via the taskbar
    // — see ``openPluginPanel`` and the plugin's own ``toolToPanel``
    // spec. No plugin is mounted at startup so the plugin system
    // stays self-contained: a new plugin never needs an edit here.
    api.addPanel({
      id: "chat",
      component: "chatPanel",
      title: "Chat",
    });

    // Add a collapsible right-side edge group (the "dock bar" / sidebar)
    api.addEdgeGroup("right", {
      id: "dock-bar",
      initialSize: SIDEBAR_WIDTH,
      minimumSize: Math.round(SIDEBAR_WIDTH / 2),
      collapsed: true,
      collapsedSize: 44,
    });

    // --- Sidebar (dock-bar) interactivity setup ---
    const dockBar = api.getGroup("dock-bar") as {
      element: HTMLElement;
      api: {
        expand(): void;
        collapse(): void;
        isCollapsed(): boolean;
        onDidCollapsedChange: (cb: () => void) => { dispose: () => void };
      };
      model: {
        openPanel(panel: { id: string }): void;
        onDidAddPanel: (cb: () => void) => { dispose: () => void };
        onDidRemovePanel: (cb: () => void) => { dispose: () => void };
      };
      panels: { id: string }[];
      activePanel: { id: string } | undefined;
    } | undefined;
    if (dockBar) {
      // Animate slide-in/out by toggling a CSS class before expanding/collapsing
      const toggleSlide = (expanding: boolean) => {
        if (!dockBar) return;
        const splitViewEl = dockBar.element.closest(
          ".dv-split-view-container",
        ) as HTMLElement | null;

        splitViewEl?.classList.add("dv-edge-sliding-active");
        requestAnimationFrame(() => {
          if (expanding) {
            dockBar.api.expand();
          } else {
            dockBar.api.collapse();
          }
        });
        setTimeout(() => {
          splitViewEl?.classList.remove("dv-edge-sliding-active");
        }, 200);
      };

      // Hover to expand / auto-collapse on leave. The expand is delayed
      // by 200ms so a quick cursor pass doesn't flash the sidebar open.
      let expandTimer: number | undefined;
      dockBar.element.addEventListener("mouseenter", () => {
        if (!dockBar.api.isCollapsed()) return;
        expandTimer = window.setTimeout(() => toggleSlide(true), 100);
      });
      dockBar.element.addEventListener("mouseleave", () => {
        if (expandTimer !== undefined) {
          clearTimeout(expandTimer);
          expandTimer = undefined;
          return;
        }
        if (!dockBar.api.isCollapsed()) toggleSlide(false);
      });

      // The element-level mouseleave never fires when the cursor exits
      // the browser window entirely (e.g. into the OS chrome on the
      // right edge), so the sidebar would stay expanded. Track the
      // cursor's position and collapse whenever it's outside the dock
      // bar's hit area — that covers both viewport-exit and the OS
      // chrome. Also collapse when the window loses focus.
      const collapseIfOpen = () => {
        if (!dockBar.api.isCollapsed()) toggleSlide(false);
      };
      const onDocMove = (e: MouseEvent) => {
        if (dockBar.api.isCollapsed()) return;
        const rect = dockBar.element.getBoundingClientRect();
        // Account for the 44px-wide collapsed handle that sticks out
        // even when the sidebar is expanded.
        const handle = 44;
        const inside =
          e.clientX >= rect.left - handle &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!inside) collapseIfOpen();
      };
      document.addEventListener("mousemove", onDocMove, { passive: true });
      document.addEventListener("mouseleave", collapseIfOpen, { passive: true });
      window.addEventListener("blur", collapseIfOpen, { passive: true });

      // Hovering over a tab in the sidebar switches to that panel
      dockBar.element.addEventListener("mouseover", (e) => {
        const tabEl = (e.target as HTMLElement).closest(".dv-tab");
        if (!tabEl) return;
        const scrollable = tabEl.closest(".dv-scrollable");
        if (!scrollable) return;
        const tabs = Array.from(scrollable.querySelectorAll(".dv-tab"));
        const index = tabs.indexOf(tabEl);
        const panel = dockBar.panels[index];
        if (panel && panel !== dockBar.activePanel) {
          dockBar.model.openPanel(panel);
        }
      });

      // Show an "empty" message when the sidebar has no panels
      const contentEl = dockBar.element.querySelector(
        ".dv-content-container",
      ) as HTMLElement | null;
      const emptyMsg = document.createElement("div");
      emptyMsg.textContent = "Currently no tabs in sidebar";
      emptyMsg.style.cssText =
        "display:none;align-items:center;justify-content:center;height:100%;color:#666;font-size:13px;text-align:center;padding:16px;box-sizing:border-box;";
      contentEl?.appendChild(emptyMsg);

      function updateEmptyMsg() {
        if (!dockBar) return;
        emptyMsg.style.display =
          dockBar.panels.length === 0 && !dockBar.api.isCollapsed()
            ? "flex"
            : "none";
      }
      updateEmptyMsg();
      dockBar.model.onDidAddPanel(updateEmptyMsg);
      dockBar.model.onDidRemovePanel(updateEmptyMsg);
      dockBar.api.onDidCollapsedChange(updateEmptyMsg);
    }

    // --- Active group border highlighting ---
    let activeGroupEl: HTMLElement | null = null;

    function setGroupBorder(group: any) {
      if (activeGroupEl) {
        activeGroupEl.style.outline = "";
      }
      if (group && group.api.location.type !== "edge") {
        group.element.style.outline = "1px solid #EE8C57";
        group.element.style.outlineOffset = "-1px";
        activeGroupEl = group.element;
      } else {
        activeGroupEl = null;
      }
    }

    api.onDidActiveGroupChange((group) => {
      setGroupBorder(group);
    });

    // Apply border to the initially active group
    const initialGroup = api.groups.find(
      (g) => g.api.isActive,
    );
    setGroupBorder(initialGroup);

    // Focus panels on mouse enter (convenience for keyboard shortcuts)
    function addHoverFocus(group: any) {
      if (group.api.location.type === "edge") return;
      group.element.addEventListener("mouseenter", () => {
        group.activePanel?.focus();
      });
    }

    api.groups.forEach(addHoverFocus);
    api.onDidAddGroup(addHoverFocus);
  };

  // Prevent dropping panels into the center of a group that already has grid content
  const onWillDrop = (event: DockviewWillDropEvent) => {
    if (event.position === "center") {
      const targetType = event.group?.api.location.type;
      const hasGridGroup = event.api.groups.some(
        (g) => g.api.location.type === "grid",
      );
      if (
        targetType === "floating" ||
        (targetType === "grid" && hasGridGroup)
      ) {
        event.preventDefault();
      }
    }
  };

  // Custom right-click context menu for panel tabs
  const getTabContextMenuItems = (
    params: GetTabContextMenuItemsParams,
  ): (BuiltInContextMenuItem | { label: string; action: () => void })[] => {
    return [
      { label: "Float", action: () => params.api.addFloatingGroup(params.panel) },
      "separator",
      "close",
    ];
  };

  return (
    <DockviewPanelsContext.Provider value={panelsContextValue}>
      <div className="relative w-full h-full overflow-hidden">
        <div className="relative w-full h-full flex" style={{ zIndex: 1 }}>
          {/* Left-side auto-hiding taskbar */}
          <div
            ref={taskbarRef}
            className={`${taskbarCollapsed ? 'w-9' : 'w-40'} shrink-0 transition-[width] duration-200`}
          >
            <TaskBar
              collapsed={taskbarCollapsed}
              onToggle={() => setTaskbarCollapsed(c => !c)}
              pluginEntries={pluginTaskbarEntries}
              onLaunchPlugin={openPluginPanel}
            />
          </div>
          {/* Main content area with animated NN background + Dockview panels */}
          <div className="flex-1 min-w-0 relative rounded-l-2xl overflow-hidden">
            <NeuralNetworkBackground />
            <DockviewReact
              theme={theme}
              components={components}
              onReady={onReady}
              onWillDrop={onWillDrop}
              getTabContextMenuItems={getTabContextMenuItems}
            />
          </div>
        </div>
      </div>
    </DockviewPanelsContext.Provider>
  );
}

export default App;
