import type { FastifyPluginCallback } from 'fastify';

import type { RouteSnapshot } from '../../../routes/application/route-catalog.js';
import {
  invalidRequest,
  LIVE_CACHE_CONTROL,
  routeCodeParamsSchema,
  routeNotFound,
} from '../../../shared/infrastructure/http/public-api.js';
import { streamedRoute } from '../../application/live-event-views.js';
import type { LiveRouteSnapshotView } from '../../application/live-views.js';
import type { LiveStreamHub } from '../sse/live-stream-hub.js';
import { liveSnapshotResponseSchema } from './live-schemas.js';

/** The live use cases the HTTP adapter needs. */
export interface LiveSnapshots {
  findRoute(code: string): Promise<RouteSnapshot | null>;
  snapshot(route: RouteSnapshot): Promise<LiveRouteSnapshotView>;
}

export interface LiveRoutesOptions {
  readonly snapshots: LiveSnapshots;
  /** Registers the SSE stream when present. */
  readonly stream?: {
    readonly hub: LiveStreamHub;
    /** Telemetry older than this is stale (for the signal of streamed ETAs). */
    readonly maxFixAgeSec: number;
  };
}

/**
 * Public live API (registered under `/api`):
 *
 * - `GET /live/routes/:code` → the live snapshot of the route (`no-store`); 404 when the route is
 *   unknown or inactive.
 * - `GET /live/routes/:code/stream` → `text/event-stream`: a `snapshot` event, then the route's
 *   `vehicle.position`, `eta.updated`, `point.passed`, `trip.started`, `trip.completed` and
 *   `alert.emitted` events, with a heartbeat comment; 503 when the stream capacity is reached.
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

  const stream = options.stream;
  if (stream !== undefined) {
    // Open streams never end on their own: end them first so the server can close.
    app.addHook('preClose', (hookDone) => {
      stream.hub.closeAll();
      hookDone();
    });

    app.get('/live/routes/:code/stream', async (request, reply) => {
      const params = routeCodeParamsSchema.safeParse(request.params);
      if (!params.success) return invalidRequest(reply, params.error);
      const route = await options.snapshots.findRoute(params.data.code);
      if (route === null) return routeNotFound(reply);
      if (!stream.hub.hasCapacity()) {
        return reply.code(503).header('retry-after', '30').send({
          error: 'stream_capacity_reached',
          message: 'Too many live streams; retry later.',
        });
      }

      reply.hijack();
      await stream.hub.stream(reply.raw, streamedRoute(route, stream.maxFixAgeSec), async () =>
        liveSnapshotResponseSchema.parse(await options.snapshots.snapshot(route)),
      );
    });
  }

  done();
};
