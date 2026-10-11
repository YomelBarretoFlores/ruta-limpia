import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import rateLimit from '@fastify/rate-limit';

import {
  pushSubscriptionRoutes,
  type PushSubscriptionRoutesOptions,
} from './alerts/infrastructure/http/push-subscription-routes.js';
import {
  publicRouteRoutes,
  type PublicRouteRoutesOptions,
} from './routes/infrastructure/http/public-route-routes.js';
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
  /** Registers the public citizen API under `/api` when present. */
  readonly publicApi?: PushSubscriptionRoutesOptions;
  /** Registers the public read API (route catalog) under `/api` when present. */
  readonly publicRead?: {
    readonly catalog: PublicRouteRoutesOptions;
  };
  /** Trust `X-Forwarded-*` headers from the reverse proxy. */
  readonly trustProxy?: boolean;
}

/**
 * Assembles the HTTP adapter. Bounded contexts register their routes here; their dependencies are
 * wired in the composition root and passed in through options.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const trustProxy = options.trustProxy ?? false;
  const app =
    options.loggerInstance === undefined
      ? Fastify({ logger: options.logger ?? false, trustProxy })
      : Fastify({ loggerInstance: options.loggerInstance, trustProxy });

  // Opt-in per route (`config.rateLimit`): only the public mutating routes are limited.
  await app.register(rateLimit, { global: false });

  await app.register(healthRoutes);
  if (options.ingest !== undefined) {
    await app.register(traccarIngestRoutes, {
      ingestToken: options.ingest.token,
      ingestor: options.ingest.ingestor,
    });
  }

  if (options.publicApi !== undefined) {
    await app.register(pushSubscriptionRoutes, { ...options.publicApi, prefix: '/api' });
  }
  if (options.publicRead !== undefined) {
    await app.register(publicRouteRoutes, { ...options.publicRead.catalog, prefix: '/api' });
  }

  return app;
}
