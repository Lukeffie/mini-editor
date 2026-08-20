import { defineConfig } from "vite";

// Tauri expects a fixed port and disables auto-open during dev.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  // 强制预构建 highlight.js 及其 CJS 语言包，避免 dev 模式下 import-analysis 解析子路径失败
  optimizeDeps: {
    include: [
      "highlight.js",
      "highlight.js/lib/languages/xml",
      "highlight.js/lib/languages/json",
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
