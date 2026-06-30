import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.ASSISTANT_GM_API_URL || "http://127.0.0.1:8000";
const uiPort = Number(process.env.ASSISTANT_GM_UI_PORT || "5173");

export default defineConfig({
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
