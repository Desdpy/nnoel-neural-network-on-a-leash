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

const components = {
  chatPanel: ChatPanel,
  agentAvatarPanel: AgentAvatarPanel
};

function App() {
  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;

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

    fetch("/config")
      .then((res) => res.json())
      .then((data) => api.getPanel("agent-avatar")?.setTitle(data.agent.name))
      .catch(() => {});
  };

  const onWillDrop = (event: DockviewWillDropEvent) => {
    if (event.position === "center") {
      event.preventDefault();
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
          singleTabMode="fullwidth"
        />
      </div>
    </div>
  );
}

export default App;
