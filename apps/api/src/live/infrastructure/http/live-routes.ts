import type { FastifyPluginCallback } from 'fastify';

import type { RouteSnapshot } from '../../../routes/application/route-catalog.js';
import {
  invalidRequest,
  LIVE_CACHE_CONTROL,
  routeCodeParamsSchema,
  routeNotFound,
} from '../../../shared/infrastructure/http/public-api.js';
import type { LiveRouteSnapshotView } from '../../application/live-views.js';
import { liveSnapshotResponseSchema } from './live-schemas.js';

/** The live use cases the HTTP adapter needs. */
export interface LiveSnapshots {
  findRoute(code: string): Promise<RouteSnapshot | null>;
  snapshot(route: RouteSnapshot): Promise<LiveRouteSnapshotView>;
}

export interface LiveRoutesOptions {
  readonly snapshots: LiveSnapshots;
}

/**
 * Public live API (registered under `/api`):
 *
 * - `GET /live/routes/:code` → the live snapshot of the route (`no-store`); 404 when the route is
 *   unknown or inactive.
 */
export const liveRoutes: FastifyPluginCallback<LiveRoutesOptions> = (app, options, done) => {
  app.get('/live/routes/:code', async (request, reply) => {
    const params = routeCodeParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply, params.error);
    const route = await options.snapshots.findRoute(params.data.code);
    if (route === null) return routeNotFound(reply);

    const snapshot = await options.snapshots.snapshot(route);
    return reply
      .header('cache-control', LIVE_CACHE_CONTROL)
      .send(liveSnapshotResponseSchema.parse(snapshot));
  });

  done();
};
