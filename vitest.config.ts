import { defineConfig } from 'vitest/config';

// Each app owns its Vitest project (environment, setup files); `pnpm test` at the root runs them all.
export default defineConfig({
  test: {
    projects: ['apps/*'],
  },
});
