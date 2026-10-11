import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Where the dev server and `vite preview` forward `/api` (the API on its default port). */
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

const proxy = {
  // `/api/live/.../stream` is Server-Sent Events: the proxy streams it through unbuffered.
  '/api': { target: apiTarget, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
