import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest (custom src/sw.js) instead of the previous default
      // generateSW — needed for the `push`/`notificationclick` listeners
      // generateSW's config object has no hook for. The /api/ NetworkOnly
      // bypass that used to live in the `workbox` block below moved into
      // sw.js itself, expressed via Workbox's routing API directly.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        injectionPoint: "self.__WB_MANIFEST",
      },
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "bcc-logo.png", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "BCC-CVote — Cricket Availability Voting",
        short_name: "BCC-CVote",
        description: "Cast your match availability vote for BCC weekend cricket",
        theme_color: "#1e3a5f",
        background_color: "#fef9ee",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
  },
});
