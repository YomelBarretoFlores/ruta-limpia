import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { healthRoutes } from './shared/infrastructure/http/health-routes.js';

export interface BuildAppOptions {
  readonly logger?: FastifyServerOptions['logger'];
}

/**
 * Assembles the HTTP adapter. Bounded contexts register their routes here as they are added;
 * dependencies are wired in main.ts (the composition root) and passed in through options.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(healthRoutes);

  return app;
}
