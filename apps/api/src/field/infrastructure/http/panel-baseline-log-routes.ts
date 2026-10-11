import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { z } from 'zod';

import { actorOf, panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import {
  codeSchema,
  invalidRequest,
  localDateSchema,
  localTimeSchema,
  pageQuerySchema,
  pageWindow,
  paged,
  sendError,
  uuidParamsSchema,
} from '../../../shared/infrastructure/http/panel-http.js';
import type {
  BaselineLogResult,
  BaselineLogService,
} from '../../application/baseline-log-service.js';
import { FIELD_READ, FIELD_WRITE } from './panel-field-observation-routes.js';

export interface PanelBaselineLogRoutesOptions {
  readonly logs: Pick<BaselineLogService, 'list' | 'get' | 'create' | 'update' | 'delete'>;
}

const blankToNull = (text: string | null) => (text === null || text === '' ? null : text);

const logBodySchema = z.object({
  routeCode: codeSchema,
  serviceDate: localDateSchema,
  vehicleLabel: z.string().trim().max(80).nullable().default(null).transform(blankToNull),
  plannedStart: localTimeSchema.nullable().default(null),
  actualStart: localTimeSchema.nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null).transform(blankToNull),
  passes: z
    .array(z.object({ pointCode: codeSchema, passedAt: localTimeSchema }))
    .max(100)
    .default([]),
});

const listQuerySchema = pageQuerySchema.extend({
  route: codeSchema.optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});

const FAILURES: Record<Exclude<BaselineLogResult['status'], 'ok'>, [number, string]> = {
  unknown_route: [422, 'There is no active route with this code.'],
  unknown_point: [422, 'The route has no active point with this code.'],
  duplicate_point: [422, 'A point appears twice in the passes.'],
  not_found: [404, 'There is no such baseline log.'],
  not_owner: [403, 'Only the author or a supervisor may change this log.'],
  edit_window_closed: [403, 'Logs can be changed by their author for 24 hours only.'],
};

function send(reply: FastifyReply, result: BaselineLogResult, okStatus: number) {
  if (result.status === 'ok') {
    return okStatus === 204
      ? reply.code(204).send()
      : reply.code(okStatus).send({ log: result.log });
  }
  const [status, message] = FAILURES[result.status];
  if (result.pointCode !== undefined) {
    return reply.code(status).send({ error: result.status, message, pointCode: result.pointCode });
  }
  return sendError(reply, status, result.status, message);
}

const notFound = (reply: FastifyReply) => send(reply, { status: 'not_found' }, 200);

/**
 * Baseline Instrument 1 logs, filled in by hand before alerts exist (registered under
 * `/api/panel`, field permissions as for the observation sheets):
 *
 * - `POST /baseline-logs` `{ routeCode, serviceDate, vehicleLabel?, plannedStart?, actualStart?,
 *   notes?, passes: [{ pointCode, passedAt }] }` → 201 `{ log }`;
 * - `GET /baseline-logs?route=&from=&to=&page=&pageSize=` → paged logs;
 * - `GET /baseline-logs/:id` → `{ log }`; `PUT /baseline-logs/:id` (whole log) → `{ log }`;
 * - `DELETE /baseline-logs/:id` → 204.
 */
export const panelBaselineLogRoutes: FastifyPluginCallback<PanelBaselineLogRoutesOptions> = (
  app,
  { logs },
  done,
) => {
  app.post('/baseline-logs', panelRoute(FIELD_WRITE), async (request, reply) => {
    const body = logBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    return send(reply, await logs.create(body.data, actorOf(request)), 201);
  });

  app.get('/baseline-logs', panelRoute(FIELD_READ), async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, from, to } = query.data;
    const { items, total } = await logs.list(
      {
        ...(route === undefined ? {} : { routeCode: route }),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      },
      pageWindow(query.data),
      actorOf(request),
    );
    return reply.send(paged(items, total, query.data));
  });

  app.get('/baseline-logs/:id', panelRoute(FIELD_READ), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    const log = params.success ? await logs.get(params.data.id, actorOf(request)) : null;
    return log === null ? notFound(reply) : reply.send({ log });
  });

  app.put('/baseline-logs/:id', panelRoute(FIELD_WRITE), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const body = logBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    return send(reply, await logs.update(params.data.id, body.data, actorOf(request)), 200);
  });

  app.delete('/baseline-logs/:id', panelRoute(FIELD_WRITE), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    return send(reply, await logs.delete(params.data.id, actorOf(request)), 204);
  });

  done();
};
