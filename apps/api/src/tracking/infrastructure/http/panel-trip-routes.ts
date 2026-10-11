import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { actorOf, panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import {
  codeSchema,
  invalidRequest,
  localDateSchema,
  pageQuerySchema,
  pageWindow,
  paged,
  sendError,
  uuidParamsSchema,
} from '../../../shared/infrastructure/http/panel-http.js';
import type { PanelTripService } from '../../application/panel-trip-service.js';

export interface PanelTripRoutesOptions {
  readonly trips: Pick<PanelTripService, 'vehicles' | 'list' | 'detail' | 'start' | 'end'>;
}

const listQuerySchema = pageQuerySchema.extend({
  route: codeSchema.optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  status: z.enum(['active', 'completed', 'aborted']).optional(),
});

const startBodySchema = z.object({ vehicleCode: codeSchema, routeCode: codeSchema });
const endBodySchema = z.object({ reason: z.string().trim().min(1).max(500) });

const NOT_FOUND = { error: 'trip_not_found', message: 'There is no such trip.' } as const;

const START_FAILURES = {
  vehicle_not_found: [404, 'There is no active vehicle with this code.'],
  route_not_found: [404, 'There is no active route with this code.'],
  trip_already_active: [409, 'The vehicle already has an active trip.'],
} as const;

/**
 * Fleet and trip history (registered under `/api/panel`; dates are serialized as ISO strings):
 *
 * - `GET /vehicles` → `{ vehicles }` with the last fix and the telemetry signal;
 * - `GET /trips?route=&from=&to=&status=&page=&pageSize=` → paged trip summaries, newest first
 *   (`from`/`to` are service dates in America/Lima, inclusive);
 * - `GET /trips/:id` → `{ trip, summary, points, incidents, track }`;
 * - `POST /trips` `{ vehicleCode, routeCode }` → 201 `{ trip }` (manual start);
 * - `POST /trips/:id/end` `{ reason }` → 200 `{ trip }` (recorded as aborted, end reason `manual`).
 */
export const panelTripRoutes: FastifyPluginCallback<PanelTripRoutesOptions> = (
  app,
  { trips },
  done,
) => {
  app.get('/vehicles', panelRoute('vehicles:read'), async (_request, reply) =>
    reply.send({ vehicles: await trips.vehicles() }),
  );

  app.get('/trips', panelRoute('trips:read'), async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, from, to, status } = query.data;
    const { items, total } = await trips.list(
      {
        ...(route === undefined ? {} : { routeCode: route }),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
        ...(status === undefined ? {} : { status }),
      },
      pageWindow(query.data),
    );
    return reply.send(paged(items, total, query.data));
  });

  app.get('/trips/:id', panelRoute('trips:read'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send(NOT_FOUND);
    const detail = await trips.detail(params.data.id);
    if (detail === null) return reply.code(404).send(NOT_FOUND);
    const { summary, ...rest } = detail;
    const { maxGapSec, ...counts } = summary;
    return reply.send({ ...rest, summary: { ...counts, maxGpsGapSec: maxGapSec } });
  });

  app.post('/trips', panelRoute('trips:write'), async (request, reply) => {
    const body = startBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const result = await trips.start(body.data, actorOf(request));
    if (result.status === 'started') return reply.code(201).send({ trip: result.trip });
    const [status, message] = START_FAILURES[result.status];
    return sendError(reply, status, result.status, message);
  });

  app.post('/trips/:id/end', panelRoute('trips:write'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send(NOT_FOUND);
    const body = endBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const result = await trips.end(params.data.id, body.data.reason, actorOf(request));
    if (result.status === 'ended') return reply.send({ trip: result.trip });
    if (result.status === 'trip_not_found') return reply.code(404).send(NOT_FOUND);
    return sendError(reply, 409, 'trip_not_active', 'The trip has already ended.');
  });

  done();
};
