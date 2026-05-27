import { DockviewReact } from "dockview";
import type {
  DockviewReadyEvent,
  DockviewWillDropEvent,
  GetTabContextMenuItemsParams,
  BuiltInContextMenuItem,
} from "dockview";
import { ChatPanel } from "./components/ChatPanel";
import { HelloPanel } from "./components/HelloPanel";

const components = {
  chatPanel: ChatPanel,
  helloPanel: HelloPanel
};

function App() {
  const onReady = (event: DockviewReadyEvent) => {
    event.api.addPanel({
      id: "chat-main",
      component: "chatPanel",
      title: "Nnoel Chat",
    });

    event.api.addPanel({
      id: "hello-panel",
      component: "helloPanel",
      title: "Hello",
      position: { direction: "right", referencePanel: "chat-main" },
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
      className="dockview-theme-dark"
      components={components}
      onReady={onReady}
      onWillDrop={onWillDrop}
      getTabContextMenuItems={getTabContextMenuItems}
      singleTabMode="fullwidth"
    />
  );
}

export default App;
