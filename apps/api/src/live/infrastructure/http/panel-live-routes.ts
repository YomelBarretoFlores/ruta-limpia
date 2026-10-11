import type { FastifyPluginCallback } from 'fastify';

import { panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import {
  invalidRequest,
  routeCodeParamsSchema,
  routeNotFound,
} from '../../../shared/infrastructure/http/public-api.js';
import type { PanelLiveService } from '../../application/panel-live-service.js';

export interface PanelLiveRoutesOptions {
  readonly live: Pick<PanelLiveService, 'snapshotByCode'>;
}

/**
 * `GET /live/routes/:code` (registered under `/api/panel`, `live:read`): the public live snapshot
 * plus, per trip, `points` (pass table with alert status and delivery counts) and the route's
 * `openIncidents`. Live updates come from the public SSE stream; refetch this on `alert.emitted`.
 */
export const panelLiveRoutes: FastifyPluginCallback<PanelLiveRoutesOptions> = (
  app,
  { live },
  done,
) => {
  app.get('/live/routes/:code', panelRoute('live:read'), async (request, reply) => {
    const params = routeCodeParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply, params.error);
    const snapshot = await live.snapshotByCode(params.data.code);
    if (snapshot === null) return routeNotFound(reply);
    return reply.send(snapshot);
  });
  done();
};
