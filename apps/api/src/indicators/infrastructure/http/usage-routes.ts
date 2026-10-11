import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { invalidRequest } from '../../../shared/infrastructure/http/public-api.js';
import type { RecordViewCommand, RecordViewResult } from '../../application/app-view-service.js';

/** The usage use case the HTTP adapter needs. */
export interface UsageRecorder {
  record(command: RecordViewCommand): Promise<RecordViewResult>;
}

/**
 * Views are reported on every app open, often by many households behind one carrier NAT
 * address, so their per-IP limit is this many times the public mutation limit.
 */
const VIEW_LIMIT_FACTOR = 10;

export interface UsageRoutesOptions {
  readonly views: UsageRecorder;
  /** The public mutation limit per client IP and route (`PUBLIC_RATE_LIMIT_PER_MINUTE`). */
  readonly mutationsPerMinute: number;
}

const code = z.string().regex(/^[A-Za-z0-9-]{1,16}$/);

const viewBodySchema = z.object({
  pointCode: code,
  routeCode: code.optional(),
  subscriptionId: z.string().min(1).max(64).optional(),
  managementToken: z.string().min(1).max(256).optional(),
});

const UNPROCESSABLE: Record<Exclude<RecordViewResult, 'recorded'>, string> = {
  unknown_point: 'The reference point does not exist.',
  ambiguous_point: 'Several routes have this point code; give the route code too.',
};

/**
 * Usage logging for the adoption indicator (registered under `/api`):
 *
 * - `POST /usage/views` `{ pointCode, routeCode?, subscriptionId?, managementToken? }` → 204. With a
 *   valid subscription id and management token the view is linked to the subscription and its
 *   household; otherwise (also with a wrong token) it is recorded anonymously. 422 for an unknown
 *   or ambiguous point; rate-limited per client IP.
 */
export const usageRoutes: FastifyPluginCallback<UsageRoutesOptions> = (app, options, done) => {
  app.post(
    '/usage/views',
    {
      config: {
        rateLimit: { max: options.mutationsPerMinute * VIEW_LIMIT_FACTOR, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const body = viewBodySchema.safeParse(request.body);
      if (!body.success) return invalidRequest(reply, body.error);
      const { pointCode, routeCode, subscriptionId, managementToken } = body.data;

      const result = await options.views.record({
        pointCode,
        ...(routeCode === undefined ? {} : { routeCode }),
        ...(subscriptionId === undefined ? {} : { subscriptionId }),
        ...(managementToken === undefined ? {} : { managementToken }),
      });
      if (result !== 'recorded') {
        return reply.code(422).send({ error: result, message: UNPROCESSABLE[result] });
      }
      return reply.code(204).header('cache-control', 'no-store').send();
    },
  );

  done();
};
