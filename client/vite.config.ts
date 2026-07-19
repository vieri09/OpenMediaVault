import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// During development the React app runs on Vite's port (5173) and proxies the
// API to the Express backend (APP_PORT, default 3000). In production the built
// client is served by the Express server itself, so the proxy is unused.
//
// We read APP_PORT from the repo-root .env (the same file the server reads via
// dotenv) so the proxy target and the backend always agree — even when APP_PORT
// is changed, e.g. to avoid a clash with another dev server on this machine.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.APP_PORT || process.env.APP_PORT || '3000';
  const appHost = env.APP_HOST || process.env.APP_HOST || '127.0.0.1';
  const apiTarget = `http://localhost:${apiPort}`;

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'OpenMedia',
          short_name: 'OpenMedia',
          description: 'A self-hosted music and movie player for your local library.',
          theme_color: '#0d0d0f',
          background_color: '#0d0d0f',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          // Do not cache media streams — Range and HLS requests must hit the backend.
          navigateFallback: '/index.html',
          // Precache only the shell. Route/panel chunks are cached when first
          // requested, avoiding an eager download of screens the user may not use.
          globPatterns: ['**/*.{css,html,svg,png,ico,woff2}', 'assets/index-*.js'],
          runtimeCaching: [
            {
              urlPattern: /\/api\/(?:stream|cover)\/|\/api\/movies\/[^/]+\/(?:stream|hls)\//,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/assets\/.*\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'openmedia-page-chunks',
                expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      host: appHost,
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
