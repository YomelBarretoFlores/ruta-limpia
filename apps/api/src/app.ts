import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import rateLimit from '@fastify/rate-limit';

import {
  panelAuthRoutes,
  type PanelAuthRoutesOptions,
} from './auth/infrastructure/http/panel-auth-routes.js';
import {
  installPanelGuard,
  PANEL_PREFIX,
  type PanelGuardOptions,
} from './auth/infrastructure/http/panel-guard.js';
import {
  panelUserRoutes,
  type PanelUserRoutesOptions,
} from './auth/infrastructure/http/panel-user-routes.js';
import {
  pushSubscriptionRoutes,
  type PushSubscriptionRoutesOptions,
} from './alerts/infrastructure/http/push-subscription-routes.js';
import {
  usageRoutes,
  type UsageRoutesOptions,
} from './indicators/infrastructure/http/usage-routes.js';
import { liveRoutes, type LiveRoutesOptions } from './live/infrastructure/http/live-routes.js';
import {
  publicRouteRoutes,
  type PublicRouteRoutesOptions,
} from './routes/infrastructure/http/public-route-routes.js';
import { healthRoutes } from './shared/infrastructure/http/health-routes.js';
import {
  traccarIngestRoutes,
  type PositionIngestor,
} from './tracking/infrastructure/http/traccar-ingest-routes.js';

/** Registers one context's panel routes inside the guarded `/api/panel` scope. */
export type PanelRouteRegistration = (scope: FastifyInstance) => Promise<unknown>;

export interface PanelOptions {
  readonly guard: PanelGuardOptions;
  readonly auth: PanelAuthRoutesOptions;
  readonly users: PanelUserRoutesOptions;
  readonly routes?: readonly PanelRouteRegistration[];
}

export interface BuildAppOptions {
  /** Fastify logger options; ignored when `loggerInstance` is given. */
  readonly logger?: FastifyServerOptions['logger'];
  /** A ready-made logger shared with the application services. */
  readonly loggerInstance?: FastifyBaseLogger;
  /** Registers the Traccar ingest endpoint when present. */
  readonly ingest?: { readonly token: string; readonly ingestor: PositionIngestor };
  /** Registers the public citizen API under `/api` when present. */
  readonly publicApi?: PushSubscriptionRoutesOptions;
  /** Registers the public read API (route catalog, live snapshot) under `/api` when present. */
  readonly publicRead?: {
    readonly catalog: PublicRouteRoutesOptions;
    readonly live: LiveRoutesOptions;
  };
  /** Registers the usage logging endpoint (adoption indicator) under `/api` when present. */
  readonly usage?: UsageRoutesOptions;
  /** Registers the authenticated municipal panel API under `/api/panel` when present. */
  readonly panel?: PanelOptions;
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
    await app.register(liveRoutes, { ...options.publicRead.live, prefix: '/api' });
  }
  if (options.usage !== undefined) {
    await app.register(usageRoutes, { ...options.usage, prefix: '/api' });
  }
  const panel = options.panel;
  if (panel !== undefined) {
    // One encapsulated scope: the guard's hooks apply to every panel route and to nothing else.
    await app.register(
      async (scope) => {
        await installPanelGuard(scope, panel.guard);
        await scope.register(panelAuthRoutes, panel.auth);
        await scope.register(panelUserRoutes, panel.users);
        for (const register of panel.routes ?? []) await register(scope);
      },
      { prefix: PANEL_PREFIX },
    );
  }

  return app;
}
