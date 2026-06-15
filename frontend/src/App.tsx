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
      api: { expand(): void; collapse(): void; isCollapsed(): boolean };
      model: { openPanel(panel: { id: string }): void };
      panels: { id: string }[];
      activePanel: { id: string } | undefined;
    } | undefined;
    if (dockBar) {
      const viewEl = dockBar.element.closest(".dv-view") as HTMLElement | null;
      const sashContainer = viewEl
        ?.closest(".dv-split-view-container")
        ?.querySelector(".dv-sash-container") as HTMLElement | null;

      const toggleSlide = (expanding: boolean) => {
        if (!viewEl || !dockBar) return;
        const splitViewEl = viewEl.closest(".dv-split-view-container") as HTMLElement | null;
        const viewContainer = viewEl.closest(".dv-view-container") as HTMLElement | null;

        if (viewContainer) {
          for (const v of viewContainer.children) {
            const el = v as HTMLElement;
            el.style.transition = "width 0.15s linear, left 0.15s linear";
          }
        }
        if (sashContainer) {
          for (const sash of sashContainer.children) {
            (sash as HTMLElement).style.transition = "left 0.15s linear";
          }
        }
        splitViewEl?.classList.add("dv-edge-sliding-active");
        requestAnimationFrame(() => {
          if (expanding) {
            dockBar.api.expand();
          } else {
            dockBar.api.collapse();
          }
        });
        setTimeout(() => {
          if (viewContainer) {
            for (const v of viewContainer.children) {
              (v as HTMLElement).style.transition = "";
            }
          }
          if (sashContainer) {
            for (const sash of sashContainer.children) {
              (sash as HTMLElement).style.transition = "";
            }
          }
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
