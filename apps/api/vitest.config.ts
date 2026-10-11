import { defineProject } from 'vitest/config';

/** Unit tests: domain, application services with in-memory fakes, HTTP adapters with fakes. */
export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
});
