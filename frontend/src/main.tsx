import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ThemeDock from "./ThemeDock";
import "./styles.css";
import "./actions.css";
import "./protein-theme.css";
import "./ui-fixes.css";
import "./scientific-tools.css";
import "./v05-workspace.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <ThemeDock />
  </React.StrictMode>,
);
