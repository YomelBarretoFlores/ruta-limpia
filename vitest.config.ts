import { defineConfig } from 'vitest/config';

// Each app owns its Vitest projects; `pnpm test` at the root runs them all, including the API
// integration tests (Testcontainers, Docker required).
export default defineConfig({
  test: {
    projects: ['apps/web', 'apps/api/vitest.config.ts', 'apps/api/vitest.integration.config.ts'],
  },
});
