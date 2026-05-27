import { DockviewReact } from "dockview";
import type { DockviewReadyEvent, DockviewWillDropEvent } from "dockview";
import { ChatPanel } from "./components/ChatPanel";
import { HelloPanel } from "./components/HelloPanel";

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

  return (
    <div
      className="dockview-theme-dark"
      style={{
        height: "calc(100vh - 16px)",
        width: "calc(100vw - 16px)",
        margin: "8px",
      }}
    >
      <DockviewReact
        components={{ chatPanel: ChatPanel, helloPanel: HelloPanel }}
        onReady={onReady}
        onWillDrop={onWillDrop}
      />
    </div>
  );
}

export default App;
