import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { z } from 'zod';

import { actorOf, panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import {
  codeSchema,
  householdCodeSchema,
  invalidRequest,
  pageQuerySchema,
  pageWindow,
  paged,
  sendError,
} from '../../../shared/infrastructure/http/panel-http.js';
import type {
  HouseholdRegistryService,
  HouseholdResult,
} from '../../application/household-registry.js';

export interface PanelHouseholdRoutesOptions {
  readonly households: Pick<
    HouseholdRegistryService,
    'enroll' | 'list' | 'find' | 'update' | 'remove' | 'sticker'
  >;
  /** Origin of the sticker links; null derives it from the request (development). */
  readonly publicOrigin: string | null;
}

/** Free-text notes: never addresses, names or phone numbers (the panel says so). */
const notes = z.string().trim().max(280);

const codeParamsSchema = z.object({ code: householdCodeSchema });

const enrollBodySchema = z.object({
  routeCode: codeSchema,
  pointCode: codeSchema,
  consentAt: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
  consentVersion: z.string().trim().min(1).max(32).optional(),
  notes: notes.optional(),
});

const updateBodySchema = z
  .strictObject({
    pointCode: codeSchema.optional(),
    active: z.boolean().optional(),
    notes: notes.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

const listQuerySchema = pageQuerySchema.extend({
  route: codeSchema.optional(),
  point: codeSchema.optional(),
  active: z.stringbool().optional(),
});

const FAILURES: Record<Exclude<HouseholdResult['status'], 'ok'>, [number, string]> = {
  unknown_route: [422, 'There is no active route with this code.'],
  unknown_point: [422, "The household's route has no active point with this code."],
  not_found: [404, 'There is no household with this code.'],
};

function send(reply: FastifyReply, result: HouseholdResult, okStatus: number) {
  if (result.status === 'ok') return reply.code(okStatus).send({ household: result.household });
  const [status, message] = FAILURES[result.status];
  return sendError(reply, status, result.status, message);
}

const notFound = (reply: FastifyReply) => send(reply, { status: 'not_found' }, 200);

/**
 * Household registry (registered under `/api/panel`):
 *
 * - `POST /households` `{ routeCode, pointCode, consentAt?, consentVersion?, notes? }` → 201
 *   `{ household }` with the next code `H-###` (`households:write`);
 * - `GET /households?route=&point=&active=&page=&pageSize=` → paged households with their
 *   subscription status (`households:read`);
 * - `GET /households/:code` → `{ household }`;
 * - `PATCH /households/:code` `{ pointCode?, active?, notes? }` → `{ household }`;
 * - `DELETE /households/:code` → 204 (`households:delete`, administrators; deactivate instead);
 * - `GET /households/:code/sticker` → `{ code, url }`: the QR deep link of the sticker.
 */
export const panelHouseholdRoutes: FastifyPluginCallback<PanelHouseholdRoutesOptions> = (
  app,
  { households, publicOrigin },
  done,
) => {
  app.post('/households', panelRoute('households:write'), async (request, reply) => {
    const body = enrollBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const { consentAt, consentVersion, notes: text, ...codes } = body.data;
    const result = await households.enroll(
      {
        ...codes,
        ...(consentAt === undefined ? {} : { consentAt }),
        ...(consentVersion === undefined ? {} : { consentVersion }),
        ...(text === undefined || text === '' ? {} : { notes: text }),
      },
      actorOf(request),
    );
    return send(reply, result, 201);
  });

  app.get('/households', panelRoute('households:read'), async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, point, active } = query.data;
    const { items, total } = await households.list(
      {
        ...(route === undefined ? {} : { routeCode: route }),
        ...(point === undefined ? {} : { pointCode: point }),
        ...(active === undefined ? {} : { active }),
      },
      pageWindow(query.data),
    );
    return reply.send(paged(items, total, query.data));
  });

  app.get('/households/:code', panelRoute('households:read'), async (request, reply) => {
    const params = codeParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const household = await households.find(params.data.code);
    return household === null ? notFound(reply) : reply.send({ household });
  });

  app.patch('/households/:code', panelRoute('households:write'), async (request, reply) => {
    const params = codeParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const body = updateBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const { notes: text, ...rest } = body.data;
    const result = await households.update(
      params.data.code,
      { ...rest, ...(text === undefined ? {} : { notes: text === '' ? null : text }) },
      actorOf(request),
    );
    return send(reply, result, 200);
  });

  app.delete('/households/:code', panelRoute('households:delete'), async (request, reply) => {
    const params = codeParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const removed = await households.remove(params.data.code, actorOf(request));
    return removed ? reply.code(204).send() : notFound(reply);
  });

  app.get('/households/:code/sticker', panelRoute('households:read'), async (request, reply) => {
    const params = codeParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const origin = publicOrigin ?? `${request.protocol}://${request.host}`;
    const sticker = await households.sticker(params.data.code, origin);
    return sticker === null ? notFound(reply) : reply.send(sticker);
  });

  done();
};
