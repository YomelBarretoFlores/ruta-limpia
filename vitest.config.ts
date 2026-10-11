import { defineConfig } from 'vitest/config';

// Each package owns its Vitest projects; `pnpm test` at the root runs them all, including the API
// integration tests (Testcontainers, Docker required) and the simulator's unit tests. The e2e smoke
// test has its own command (`pnpm test:e2e`).
export default defineConfig({
  test: {
    projects: [
      'apps/web',
      'apps/api/vitest.config.ts',
      'apps/api/vitest.integration.config.ts',
      'tools/simulator',
    ],
  },
});
