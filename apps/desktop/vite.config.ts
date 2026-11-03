import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri serves the built files itself; the dev server is only used by `tauri dev`.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  build: { target: "es2023", outDir: "dist", emptyOutDir: true },
});
