import type { FastifyReply } from 'fastify';
import { z } from 'zod';

/** `:code` path parameter of the public route endpoints, normalized to upper case (`ri-01` → `RI-01`). */
export const routeCodeParamsSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,16}$/)
    .transform((code) => code.toUpperCase()),
});

/** The catalog changes rarely (panel edits): browsers and the proxy may reuse it for 5 minutes. */
export const CATALOG_CACHE_CONTROL = 'public, max-age=300';

/** Live data must never be served from a cache. */
export const LIVE_CACHE_CONTROL = 'no-store';

export function invalidRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'invalid_request', details: z.prettifyError(error) });
}

export function routeNotFound(reply: FastifyReply) {
  return reply
    .code(404)
    .header('cache-control', LIVE_CACHE_CONTROL)
    .send({ error: 'route_not_found', message: 'There is no active route with this code.' });
}
