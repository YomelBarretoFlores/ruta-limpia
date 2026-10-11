import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { round1 } from '../../../shared/domain/rounding.js';
import {
  CATALOG_CACHE_CONTROL,
  invalidRequest,
  routeCodeParamsSchema,
  routeNotFound,
} from '../../../shared/infrastructure/http/public-api.js';
import type { PublicRouteQueries, RouteSummary } from '../../application/public-route-queries.js';

export interface PublicRouteRoutesOptions {
  readonly queries: PublicRouteQueries;
}

const routeSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  district: z.string(),
  lengthMeters: z.number(),
  pointCount: z.number().int(),
});

/** `GET /api/routes` response. */
export const routeListResponseSchema = z.object({ routes: z.array(routeSummarySchema) });

/** `GET /api/routes/:code` response. */
export const routeDetailResponseSchema = routeSummarySchema.extend({
  timeZone: z.literal('America/Lima'),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  points: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      sequence: z.number().int(),
      lat: z.number(),
      lon: z.number(),
      chainageMeters: z.number(),
      observesMusic: z.boolean(),
    }),
  ),
  schedule: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      plannedStart: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ),
});

export type RouteDetailResponse = z.infer<typeof routeDetailResponseSchema>;

/**
 * Public route catalog (registered under `/api`). Responses are parsed through their schemas, so
 * nothing outside the documented shape (internal ids) can leak:
 *
 * - `GET /routes` → `{ routes: [{ code, name, district, lengthMeters, pointCount }] }`;
 * - `GET /routes/:code` → the route geometry (GeoJSON LineString), its reference points and its
 *   weekly planned starts (the printed-schedule fallback); 404 when unknown or inactive.
 */
export const publicRouteRoutes: FastifyPluginCallback<PublicRouteRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.get('/routes', async (_request, reply) => {
    const routes = await options.queries.listActive();
    return reply
      .header('cache-control', CATALOG_CACHE_CONTROL)
      .send(routeListResponseSchema.parse({ routes: routes.map(summary) }));
  });

  app.get('/routes/:code', async (request, reply) => {
    const params = routeCodeParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply, params.error);
    const route = await options.queries.findActiveByCode(params.data.code);
    if (route === null) return routeNotFound(reply);

    return reply.header('cache-control', CATALOG_CACHE_CONTROL).send(
      routeDetailResponseSchema.parse({
        ...summary(route),
        timeZone: 'America/Lima',
        geometry: { type: 'LineString', coordinates: route.coordinates },
        points: route.points.map((p) => ({ ...p, chainageMeters: round1(p.chainageMeters) })),
        schedule: route.schedule,
      }),
    );
  });

  done();
};

function summary(route: RouteSummary) {
  return {
    code: route.code,
    name: route.name,
    district: route.district,
    lengthMeters: round1(route.lengthMeters),
    pointCount: route.pointCount,
  };
}
