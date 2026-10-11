import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** Where the dev server and `vite preview` forward `/api` (the API on its default port). */
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

const proxy = {
  // `/api/live/.../stream` is Server-Sent Events: the proxy streams it through unbuffered.
  '/api': { target: apiTarget, changeOrigin: true },
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Our own service worker (src/sw/sw.ts): precache, push notifications, receipts.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // Registered from main.tsx through `virtual:pwa-register`.
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      manifest: {
        name: 'Ruta Limpia',
        short_name: 'Ruta Limpia',
        description: 'Llegada del camión recolector y avisos de proximidad a tu punto.',
        lang: 'es-PE',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1a6b4f',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      // The service worker also runs under `vite dev`, so push can be tried locally.
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
