import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import { healthRoutes } from './shared/infrastructure/http/health-routes.js';
import {
  traccarIngestRoutes,
  type PositionIngestor,
} from './tracking/infrastructure/http/traccar-ingest-routes.js';

export interface BuildAppOptions {
  /** Fastify logger options; ignored when `loggerInstance` is given. */
  readonly logger?: FastifyServerOptions['logger'];
  /** A ready-made logger shared with the application services. */
  readonly loggerInstance?: FastifyBaseLogger;
  /** Registers the Traccar ingest endpoint when present. */
  readonly ingest?: { readonly token: string; readonly ingestor: PositionIngestor };
}

/**
 * Assembles the HTTP adapter. Bounded contexts register their routes here; their dependencies are
 * wired in the composition root and passed in through options.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app =
    options.loggerInstance === undefined
      ? Fastify({ logger: options.logger ?? false })
      : Fastify({ loggerInstance: options.loggerInstance });

  await app.register(healthRoutes);
  if (options.ingest !== undefined) {
    await app.register(traccarIngestRoutes, {
      ingestToken: options.ingest.token,
      ingestor: options.ingest.ingestor,
    });
  }

  return app;
}
