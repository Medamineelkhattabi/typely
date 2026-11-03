import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <p>Typely</p>
  </StrictMode>,
);
