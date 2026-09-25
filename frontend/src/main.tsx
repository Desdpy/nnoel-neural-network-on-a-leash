import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Custom Tailwind + theme variable overrides
import "./index.css";

// Mount the root React component inside the #root div
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
