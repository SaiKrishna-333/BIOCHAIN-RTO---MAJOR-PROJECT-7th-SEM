import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard ships a charting library, a websocket client and React itself.
// Bundled as one file the browser had to download 1.1 MB before the first
// screen, which is what Vite's build warning kept reporting. Splitting by how
// often each part changes - application code versus these stable vendors -
// keeps every chunk small and lets the browser reuse the framework files from
// cache on the next deploy instead of refetching the whole app.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("recharts") ||
            id.includes("victory-vendor") ||
            id.includes("d3-")
          ) {
            return "charts";
          }
          if (id.includes("socket.io") || id.includes("engine.io")) {
            return "realtime";
          }
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("/react/") ||
            id.includes("scheduler")
          ) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
