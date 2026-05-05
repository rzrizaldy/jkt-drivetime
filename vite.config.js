import { defineConfig } from "vite";

export default defineConfig({
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
    },
  },
});
