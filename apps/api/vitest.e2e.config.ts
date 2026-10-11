import { defineProject } from 'vitest/config';

/** The longest the whole smoke may take: container starts (PostGIS emulated on Apple Silicon). */
const E2E_TIMEOUT_MS = 300_000;

/**
 * The end-to-end smoke test (`pnpm test:e2e`): PostGIS and Traccar 6.16 in Testcontainers, the API
 * in process, the simulator driving RI-01 through Traccar. Docker is required. It is not part of
 * `pnpm test`: it pulls and starts Traccar and takes a few minutes.
 */
export default defineProject({
  test: {
    name: 'api-e2e',
    environment: 'node',
    include: ['test/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    testTimeout: E2E_TIMEOUT_MS,
    hookTimeout: E2E_TIMEOUT_MS,
  },
});
