import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Dockview library styles (for the splittable, dockable panel layout)
import "dockview/dist/styles/dockview.css";
// Custom Tailwind + theme variable overrides
import "./index.css";

// Mount the root React component inside the #root div
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
