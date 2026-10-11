import { defineProject } from 'vitest/config';

/** Unit tests of the simulator: the drive plan, the OsmAnd request and the Traccar bootstrap. */
export default defineProject({
  test: {
    name: 'simulator',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
