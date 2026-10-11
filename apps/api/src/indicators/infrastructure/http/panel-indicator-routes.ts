import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import {
  codeSchema,
  invalidRequest,
  localDateSchema,
  sendError,
} from '../../../shared/infrastructure/http/panel-http.js';
import type { IndicatorService } from '../../application/indicator-service.js';
import { reportView } from './indicator-views.js';

/** The longest period one request may cover (the pilot runs nine weeks). */
export const MAX_INDICATOR_DAYS = 366;

/** `?route=RI-01&from=YYYY-MM-DD&to=YYYY-MM-DD`: a route and an inclusive local period. */
export const indicatorQuerySchema = z
  .object({ route: codeSchema, from: localDateSchema, to: localDateSchema })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_INDICATOR_DAYS, {
    message: `the period may span at most ${MAX_INDICATOR_DAYS} days`,
    path: ['to'],
  });

export interface PanelIndicatorRoutesOptions {
  readonly indicators: Pick<IndicatorService, 'report'>;
}

/**
 * The impact indicators (registered under `/api/panel`):
 *
 * - `GET /indicators?route=&from=&to=` → `{ routeCode, from, to, generatedAt, indicators,
 *   adoptionWeeks }`, every indicator of Tabla 16 with its counts, phases, change, paired test,
 *   per-point breakdown and target status; `422 unknown_route`.
 */
export const panelIndicatorRoutes: FastifyPluginCallback<PanelIndicatorRoutesOptions> = (
  app,
  { indicators },
  done,
) => {
  app.get('/indicators', panelRoute('indicators:read'), async (request, reply) => {
    const query = indicatorQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, from, to } = query.data;
    const result = await indicators.report({ routeCode: route, from, to });
    if (result.status === 'unknown_route') {
      return sendError(reply, 422, 'unknown_route', 'There is no route with this code.');
    }
    return reply.send(reportView(result.report));
  });

  done();
};
