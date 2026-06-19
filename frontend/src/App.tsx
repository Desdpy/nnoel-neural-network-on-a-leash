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
import { AgentAvatarPanel } from "./components/AgentAvatarPanel";
import { TimePanel } from "./components/TimePanel";
import { NeuralNetworkBackground } from "./components/NeuralNetworkBackground";
import { TaskBar } from "./components/TaskBar";

// Dark theme for the dockable panel library
const theme: DockviewTheme = {
  ...themeGithubDarkSpaced,
};

const SIDEBAR_WIDTH = 400;

// Map panel component names to their React components for Dockview
const components = {
  chatPanel: ChatPanel,
  agentAvatarPanel: AgentAvatarPanel,
  timePanel: TimePanel,
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
      position?: { direction: "right" | "left" | "above" | "below"; referencePanel: string };
      floating?: true | { x?: number; y?: number; width?: number; height?: number };
    }) => unknown;
    getPanel: (id: string) =>
      | { api: { setActive(): void; focus(): void } }
      | undefined;
  } | null>(null);

  // Open (or focus) the Time tool panel as a floating dock on top of the grid.
  const openTimePanel = () => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel("time");
    if (existing) {
      existing.api.setActive();
      existing.api.focus();
      return;
    }
    api.addPanel({
      id: "time",
      component: "timePanel",
      title: "Time",
      floating: { width: 360, height: 360 },
    });
  };

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

    // Add the two main panels side-by-side: Chat on the left, Agent avatar on the right
    api.addPanel({
      id: "chat",
      component: "chatPanel",
      title: "Chat",
    });

    api.addPanel({
      id: "agent-avatar",
      component: "agentAvatarPanel",
      title: "Agent",
      position: { direction: "right", referencePanel: "chat" },
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

    // Fetch the agent's display name from the backend and update the tab title
    fetch("/config")
      .then((res) => res.json())
      .then((data) => api.getPanel("agent-avatar")?.setTitle(data.agent.name))
      .catch(() => {});
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
            onLaunchTime={openTimePanel}
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
  );
}

export default App;
