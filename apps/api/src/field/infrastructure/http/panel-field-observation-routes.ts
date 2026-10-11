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
  FieldObservationService,
  ObservationCommand,
  ObservationResult,
} from '../../application/field-observation-service.js';
import {
  DISPERSION_CAUSES,
  DISPERSION_LEVELS,
  OBSERVATION_PHASES,
} from '../../domain/point-observation.js';
import { blankToNull, editWindowClosedMessage, FIELD_READ, FIELD_WRITE } from './field-http.js';

export interface PanelFieldObservationRoutesOptions {
  readonly observations: Pick<
    FieldObservationService,
    'list' | 'get' | 'create' | 'update' | 'delete'
  >;
}

/** Photo archive codes only (never images): letters, digits, `_` and `-`. */
export const photoSchema = z
  .object({
    taken: z.boolean(),
    code: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .nullable()
      .default(null),
  })
  .default({ taken: false, code: null });

const optionalTime = localTimeSchema.nullable().default(null);
const count = z.number().int().min(0).max(999).nullable().default(null);

const observationBodySchema = z.object({
  routeCode: codeSchema,
  pointCode: codeSchema,
  tripId: z.uuid().nullable().default(null),
  observedOn: localDateSchema,
  phase: z.enum(OBSERVATION_PHASES),
  observers: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).nullable().default(null),
  firstPlacementTime: optionalTime,
  truckPassTime: optionalTime,
  exposureMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  exposureIncomplete: z.boolean().default(false),
  comparableWindow: z.boolean().nullable().default(null),
  bagsAtPass: count,
  brokenBags: count,
  dispersion: z.enum(DISPERSION_LEVELS).nullable().default(null),
  dispersionCauses: z
    .array(z.enum(DISPERSION_CAUSES))
    .max(DISPERSION_CAUSES.length)
    .refine((causes) => new Set(causes).size === causes.length, 'Causes must not repeat')
    .default([]),
  dispersionCauseOther: z.string().trim().max(200).nullable().default(null),
  wasteRemainingAfterPass: z.boolean().nullable().default(null),
  photoBefore: photoSchema,
  photoAfter: photoSchema,
  music: z
    .object({
      windowStart: localTimeSchema,
      windowEnd: localTimeSchema,
      musicSeconds: z.number().int().min(0).max(86_400),
      conditions: z.string().trim().max(300).nullable().default(null),
    })
    .nullable()
    .default(null),
});

const listQuerySchema = pageQuerySchema.extend({
  route: codeSchema.optional(),
  point: codeSchema.optional(),
  phase: z.enum(OBSERVATION_PHASES).optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});

const FAILURES: Record<Exclude<ObservationResult['status'], 'ok'>, [number, string]> = {
  unknown_route: [422, 'There is no active route with this code.'],
  unknown_point: [422, 'The route has no active point with this code.'],
  unknown_trip: [422, 'There is no such trip.'],
  trip_route_mismatch: [422, 'The trip runs on another route.'],
  invalid_observation: [422, 'The sheet is inconsistent; see problems.'],
  not_found: [404, 'There is no such observation.'],
  not_owner: [403, 'Only the author or a supervisor may change this sheet.'],
  edit_window_closed: [403, editWindowClosedMessage('Sheets')],
};

function send(reply: FastifyReply, result: ObservationResult, okStatus: number) {
  if (result.status === 'ok') {
    return okStatus === 204
      ? reply.code(204).send()
      : reply.code(okStatus).send({ observation: result.observation });
  }
  const [status, message] = FAILURES[result.status];
  return result.status === 'invalid_observation'
    ? reply.code(status).send({ error: result.status, message, problems: result.problems })
    : sendError(reply, status, result.status, message);
}

/** Normalizes blank optional texts to null. */
function toCommand(body: z.infer<typeof observationBodySchema>): ObservationCommand {
  return {
    ...body,
    notes: blankToNull(body.notes),
    dispersionCauseOther: blankToNull(body.dispersionCauseOther),
    music:
      body.music === null
        ? null
        : { ...body.music, conditions: blankToNull(body.music.conditions) },
  };
}

/**
 * Instrument 2, the point observation sheet (registered under `/api/panel`):
 *
 * - `POST /field-observations` → 201 `{ observation }`;
 * - `GET /field-observations?route=&point=&phase=&from=&to=&page=&pageSize=` → paged sheets (only
 *   one's own without `field:read_all`);
 * - `GET /field-observations/:id` → `{ observation }`;
 * - `PUT /field-observations/:id` (the whole edited sheet) → `{ observation }`;
 * - `DELETE /field-observations/:id` → 204.
 */
export const panelFieldObservationRoutes: FastifyPluginCallback<
  PanelFieldObservationRoutesOptions
> = (app, { observations }, done) => {
  app.post('/field-observations', panelRoute(FIELD_WRITE), async (request, reply) => {
    const body = observationBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    return send(reply, await observations.create(toCommand(body.data), actorOf(request)), 201);
  });

  app.get('/field-observations', panelRoute(FIELD_READ), async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, point, phase, from, to } = query.data;
    const { items, total } = await observations.list(
      {
        ...(route === undefined ? {} : { routeCode: route }),
        ...(point === undefined ? {} : { pointCode: point }),
        ...(phase === undefined ? {} : { phase }),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      },
      pageWindow(query.data),
      actorOf(request),
    );
    return reply.send(paged(items, total, query.data));
  });

  app.get('/field-observations/:id', panelRoute(FIELD_READ), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    const observation = params.success
      ? await observations.get(params.data.id, actorOf(request))
      : null;
    return observation === null
      ? send(reply, { status: 'not_found' }, 200)
      : reply.send({ observation });
  });

  app.put('/field-observations/:id', panelRoute(FIELD_WRITE), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return send(reply, { status: 'not_found' }, 200);
    const body = observationBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const result = await observations.update(
      params.data.id,
      toCommand(body.data),
      actorOf(request),
    );
    return send(reply, result, 200);
  });

  app.delete('/field-observations/:id', panelRoute(FIELD_WRITE), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return send(reply, { status: 'not_found' }, 204);
    return send(reply, await observations.delete(params.data.id, actorOf(request)), 204);
  });

  done();
};
