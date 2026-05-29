import { DockviewReact, themeGithubDarkSpaced } from "dockview";
import type {
  DockviewTheme,
  DockviewReadyEvent,
  DockviewWillDropEvent,
  GetTabContextMenuItemsParams,
  BuiltInContextMenuItem,
} from "dockview";
import { ChatPanel } from "./components/ChatPanel";
import { HelloPanel } from "./components/HelloPanel";

const theme: DockviewTheme = {
  ...themeGithubDarkSpaced,
  // gap: 8,
};

const components = {
  chatPanel: ChatPanel,
  helloPanel: HelloPanel
};

function App() {
  const onReady = (event: DockviewReadyEvent) => {
    event.api.addPanel({
      id: "chat",
      component: "chatPanel",
      title: "Chat",
    });

    event.api.addPanel({
      id: "hello",
      component: "helloPanel",
      title: "Hello",
      position: { direction: "right", referencePanel: "chat" },
    });
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
    <DockviewReact
      theme={theme}
      components={components}
      onReady={onReady}
      onWillDrop={onWillDrop}
      getTabContextMenuItems={getTabContextMenuItems}
      singleTabMode="fullwidth"
    />
  );
}

export default App;
