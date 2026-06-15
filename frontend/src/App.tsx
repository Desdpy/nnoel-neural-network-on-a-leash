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
import { NeuralNetworkBackground } from "./components/NeuralNetworkBackground";

const theme: DockviewTheme = {
  ...themeGithubDarkSpaced,
  // gap: 8,
};

const SIDEBAR_WIDTH = 400;

const components = {
  chatPanel: ChatPanel,
  agentAvatarPanel: AgentAvatarPanel
};

function App() {
  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;

    api.onWillShowOverlay((event) => {
      if (event.group?.api.location.type !== "grid") return;
      if (event.kind === "tab") {
        event.preventDefault();
      }
      if (event.kind === "content" && event.position === "center") {
        event.preventDefault();
      }
    });

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

    api.addEdgeGroup("right", {
      id: "dock-bar",
      initialSize: SIDEBAR_WIDTH,
      minimumSize: Math.round(SIDEBAR_WIDTH / 2),
      collapsed: true,
      collapsedSize: 44,
    });

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

      dockBar.element.addEventListener("mouseenter", () => {
        if (dockBar.api.isCollapsed()) toggleSlide(true);
      });
      dockBar.element.addEventListener("mouseleave", () => {
        if (!dockBar.api.isCollapsed()) toggleSlide(false);
      });

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

    fetch("/config")
      .then((res) => res.json())
      .then((data) => api.getPanel("agent-avatar")?.setTitle(data.agent.name))
      .catch(() => {});
  };

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
      <NeuralNetworkBackground />
      <div className="relative w-full h-full" style={{ zIndex: 1 }}>
        <DockviewReact
          theme={theme}
          components={components}
          onReady={onReady}
          onWillDrop={onWillDrop}
          getTabContextMenuItems={getTabContextMenuItems}
        />
      </div>
    </div>
  );
}

export default App;
