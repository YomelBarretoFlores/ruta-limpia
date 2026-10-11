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
import type { IncidentResult, IncidentService } from '../../application/incident-service.js';
import { INCIDENT_DESCRIPTION_MAX_LENGTH, INCIDENT_KINDS } from '../../domain/incident.js';

export interface PanelIncidentRoutesOptions {
  readonly incidents: Pick<IncidentService, 'create' | 'list' | 'update'>;
}

const description = z.string().trim().max(INCIDENT_DESCRIPTION_MAX_LENGTH);

const createBodySchema = z.object({
  kind: z.enum(INCIDENT_KINDS),
  routeCode: codeSchema,
  pointCode: codeSchema.optional(),
  tripId: z.uuid().optional(),
  occurredAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
  description: description.optional(),
});

const updateBodySchema = z
  .strictObject({
    kind: z.enum(INCIDENT_KINDS).optional(),
    description: description.optional(),
    resolved: z.boolean().optional(),
    resolutionNote: z.string().trim().max(INCIDENT_DESCRIPTION_MAX_LENGTH).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' })
  .refine((body) => body.resolutionNote === undefined || body.resolved === true, {
    message: 'A resolution note needs resolved: true',
    path: ['resolutionNote'],
  });

const listQuerySchema = pageQuerySchema.extend({
  route: codeSchema.optional(),
  tripId: z.uuid().optional(),
  kind: z.enum(INCIDENT_KINDS).optional(),
  status: z.enum(['open', 'resolved']).optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});

const FAILURES: Record<Exclude<IncidentResult['status'], 'ok'>, [number, string]> = {
  unknown_route: [422, 'There is no active route with this code.'],
  unknown_point: [422, 'The route has no active point with this code.'],
  unknown_trip: [422, 'There is no such trip.'],
  trip_route_mismatch: [422, 'The trip runs on another route.'],
  not_found: [404, 'There is no such incident.'],
};

/**
 * Incident log (registered under `/api/panel`):
 *
 * - `POST /incidents` `{ kind, routeCode, pointCode?, tripId?, occurredAt?, description? }` → 201
 *   `{ incident }` (`incidents:create`);
 * - `GET /incidents?route=&tripId=&kind=&status=open|resolved&from=&to=&page=&pageSize=` → paged
 *   incidents, newest first (`incidents:read`);
 * - `PATCH /incidents/:id` `{ kind?, description?, resolved?, resolutionNote? }` → 200 `{ incident }`
 *   (`incidents:update`); `resolved: false` reopens it.
 */
export const panelIncidentRoutes: FastifyPluginCallback<PanelIncidentRoutesOptions> = (
  app,
  { incidents },
  done,
) => {
  const send = (
    reply: Parameters<typeof sendError>[0],
    result: IncidentResult,
    okStatus: number,
  ) => {
    if (result.status === 'ok') return reply.code(okStatus).send({ incident: result.incident });
    const [status, message] = FAILURES[result.status];
    return sendError(reply, status, result.status, message);
  };

  app.post('/incidents', panelRoute('incidents:create'), async (request, reply) => {
    const body = createBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const { kind, routeCode, pointCode, tripId, occurredAt, description: text } = body.data;
    const result = await incidents.create(
      {
        kind,
        routeCode,
        ...(pointCode === undefined ? {} : { pointCode }),
        ...(tripId === undefined ? {} : { tripId }),
        ...(occurredAt === undefined ? {} : { occurredAt }),
        ...(text === undefined ? {} : { description: text }),
      },
      actorOf(request),
    );
    return send(reply, result, 201);
  });

  app.get('/incidents', panelRoute('incidents:read'), async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, tripId, kind, status, from, to } = query.data;
    const { items, total } = await incidents.list(
      {
        ...(route === undefined ? {} : { routeCode: route }),
        ...(tripId === undefined ? {} : { tripId }),
        ...(kind === undefined ? {} : { kind }),
        ...(status === undefined ? {} : { status }),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      },
      pageWindow(query.data),
    );
    return reply.send(paged(items, total, query.data));
  });

  app.patch('/incidents/:id', panelRoute('incidents:update'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return send(reply, { status: 'not_found' }, 200);
    const body = updateBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    return send(reply, await incidents.update(params.data.id, body.data, actorOf(request)), 200);
  });

  done();
};
