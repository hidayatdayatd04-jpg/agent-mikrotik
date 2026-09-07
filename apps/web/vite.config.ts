import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("error", (_err, _req, res) => {
            // WebSocket errors receive a Socket instead of a ServerResponse.
            if (!("writeHead" in res) || res.headersSent || res.writableEnded) return;
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({
              error: {
                code: "BACKEND_UNAVAILABLE",
                message: "Backend API (port 3001) tidak aktif atau baru restart. Tunggu sebentar lalu coba lagi.",
              },
            }));
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
