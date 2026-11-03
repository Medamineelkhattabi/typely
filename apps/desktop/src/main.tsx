import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./main-window/App.tsx";
import { Panel } from "./panel/Panel.tsx";
import "./styles.css";

// Both windows load this page; the window label picks the UI.
const isPanel = getCurrentWebviewWindow().label === "panel";
document.documentElement.classList.add(isPanel ? "is-panel" : "is-main");

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root");
createRoot(root).render(<StrictMode>{isPanel ? <Panel /> : <App />}</StrictMode>);
