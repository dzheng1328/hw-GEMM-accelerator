import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/fonts.css";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/bands.css";
import "./theme/topbar.css";
import "./theme/replay.css";
import "./theme/performance.css";
import "./theme/live.css";
import "./theme/architecture.css";
import "./theme/panels.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
