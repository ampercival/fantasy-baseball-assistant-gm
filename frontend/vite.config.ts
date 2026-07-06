import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.ASSISTANT_GM_API_URL || "http://127.0.0.1:8000";
const uiPort = Number(process.env.ASSISTANT_GM_UI_PORT || "5173");
// "/" for local dev; the GitHub Pages build sets this to "/<repo-name>/".
const basePath = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    port: uiPort,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
