import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = process.env.VITE_BACKEND_URL || "http://localhost:9096";
const WS_BACKEND = BACKEND.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 9095,
    // Proxy API + websocket to the backend so we avoid CORS entirely.
    proxy: {
      "/containers": BACKEND,
      "/networks": BACKEND,
      "/stacks": BACKEND,
      "/compose": BACKEND,
      "/health": BACKEND,
      "/events": { target: WS_BACKEND, ws: true },
    },
  },
});
