import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "/",
  server: {
    proxy: {
      "/api/valhalla": {
        target: "https://valhalla1.openstreetmap.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/valhalla/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept", "application/json");
          });
        },
      },
      "/api/overpass": {
        target: "https://overpass-api.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, ""),
      },
      "/v1": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
