import { defineProject } from 'vitest/config';

/**
 * Integration tests against a real PostgreSQL 16 + PostGIS started with Testcontainers (Docker is
 * required). One container serves the whole run; files run one at a time because they share it.
 */
export default defineProject({
  test: {
    name: 'api-integration',
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    globalSetup: ['test/integration/postgis-container.global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
