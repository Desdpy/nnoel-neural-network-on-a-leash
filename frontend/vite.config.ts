import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Listen on all interfaces (``host: true``) so the dev server is
  // reachable from container hosts, VMs, and LAN addresses.  Note
  // that microphone access still requires a *secure context* —
  // browsers will only expose ``navigator.mediaDevices`` on
  // ``localhost``, ``127.0.0.1``, or HTTPS origins.  Accessing the
  // dev server via an IP like ``http://192.168.x.x:5173`` will
  // fail the mic check, so users should use ``http://localhost:5173``.
  server: {
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          dockview: ["dockview"],
        },
      },
    },
  },
});
