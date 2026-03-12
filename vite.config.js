import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
const backendPort = process.env.BACKEND_PORT || 3006;

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    https: false,  // HTTPS is handled by nginx, not Vite
    allowedHosts: ["chat-local.sogni.ai", "chat.sogni.ai", "localhost"],
    hmr: false,  // Disabled to avoid WebSocket conflicts with nginx reverse proxy
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    cors: {
      origin: ["https://chat-local.sogni.ai"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    },
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/health': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 750,
    commonjsOptions: {
      include: [/node_modules/, /sogni-client/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'sogni-sdk': ['@sogni-ai/sogni-client'],
          'vendor': ['react', 'react-dom', 'react-router-dom'],
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && /\.(png|jpe?g|gif|svg|webp|ico)$/.test(assetInfo.name)) {
            return 'assets/images/[name]-[hash][extname]';
          }
          if (assetInfo.name && /\.css$/.test(assetInfo.name)) {
            return 'assets/css/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: false,
  },
  optimizeDeps: {
    include: ['@sogni-ai/sogni-client'],
  },
});
