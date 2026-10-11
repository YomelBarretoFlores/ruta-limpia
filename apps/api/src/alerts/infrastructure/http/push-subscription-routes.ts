import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { z } from 'zod';

import type {
  CancelResult,
  ReceiptResult,
  SubscribeCommand,
  SubscribeResult,
} from '../../application/subscription-service.js';

/** The subscription use cases the HTTP adapter needs. */
export interface SubscriptionUseCases {
  subscribe(command: SubscribeCommand): Promise<SubscribeResult>;
  cancel(subscriptionId: string, managementToken: string): Promise<CancelResult>;
  confirmReceipt(
    alertId: string,
    subscriptionId: string,
    managementToken: string,
  ): Promise<ReceiptResult>;
}

/**
 * Receipts arrive in bursts (every household of a point at once), often through one carrier-grade
 * NAT address, so their per-IP limit is this many times the subscription limit.
 */
const RECEIPT_LIMIT_FACTOR = 10;

export interface PushSubscriptionRoutesOptions {
  readonly subscriptions: SubscriptionUseCases;
  /** Null when VAPID is not configured: push is then unavailable to citizens. */
  readonly vapidPublicKey: string | null;
  /** Per client IP and route, for the mutating routes. */
  readonly mutationsPerMinute: number;
}

const base64Url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url');

const subscribeBodySchema = z
  .object({
    // The shape of the browser's `PushSubscription.toJSON()`.
    subscription: z.object({
      endpoint: z.string().min(1).max(2048),
      keys: z.object({ p256dh: base64Url(80, 100), auth: base64Url(16, 32) }),
    }),
    pointId: z.uuid().optional(),
    pointCode: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,16}$/)
      .optional(),
    routeCode: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,16}$/)
      .optional(),
    householdCode: z.string().min(1).max(20).nullish(),
    consent: z.boolean(),
    consentVersion: z.string().min(1).max(32),
  })
  .refine((body) => (body.pointId === undefined) !== (body.pointCode === undefined), {
    message: 'Give exactly one of pointId and pointCode',
    path: ['pointCode'],
  });

const subscriptionParamsSchema = z.object({ id: z.string().min(1).max(64) });
const receiptParamsSchema = z.object({ alertId: z.string().min(1).max(64) });
const receiptBodySchema = z.object({
  subscriptionId: z.string().min(1).max(64),
  managementToken: z.string().min(1).max(256),
});

const UNPROCESSABLE: Record<Exclude<SubscribeResult['status'], 'subscribed'>, string> = {
  unsupported_push_service: 'The subscription endpoint is not a supported browser push service.',
  unknown_point: 'The reference point does not exist.',
  ambiguous_point: 'Several routes have this point code; give the route code too.',
  unknown_household: 'The household code is not enrolled or no longer active.',
  household_route_mismatch: "The household is enrolled on another route than the point's.",
};

/**
 * Public Web Push subscription API (registered under `/api`):
 *
 * - `GET /push/vapid-public-key` → `{ publicKey }` (503 when push is not configured);
 * - `POST /subscriptions` → 201 `{ subscriptionId, managementToken, point }`; requires `consent: true`;
 *   the same endpoint subscribing again moves to the new point and gets a new token;
 * - `DELETE /subscriptions/:id` with `Authorization: Bearer <managementToken>` → 204;
 * - `POST /alerts/:alertId/receipts` `{ subscriptionId, managementToken }` → 204: the service worker
 *   confirms that the push arrived (idempotent).
 */
export const pushSubscriptionRoutes: FastifyPluginCallback<PushSubscriptionRoutesOptions> = (
  app,
  options,
  done,
) => {
  const rateLimit = { max: options.mutationsPerMinute, timeWindow: 60_000 };

  app.get('/push/vapid-public-key', (_request, reply) => {
    if (options.vapidPublicKey === null) return pushUnavailable(reply);
    return reply.send({ publicKey: options.vapidPublicKey });
  });

  app.post('/subscriptions', { config: { rateLimit } }, async (request, reply) => {
    if (options.vapidPublicKey === null) return pushUnavailable(reply);
    const parsed = subscribeBodySchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply, parsed.error);
    const body = parsed.data;
    if (!body.consent) {
      return reply.code(400).send({
        error: 'consent_required',
        message: 'Subscribing requires explicit consent.',
      });
    }

    const result = await options.subscriptions.subscribe({
      subscription: {
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
      },
      point:
        body.pointId !== undefined
          ? { pointId: body.pointId }
          : {
              pointCode: body.pointCode ?? '',
              ...(body.routeCode === undefined ? {} : { routeCode: body.routeCode }),
            },
      householdCode: body.householdCode ?? null,
      consentVersion: body.consentVersion,
    });
    if (result.status !== 'subscribed') {
      return reply.code(422).send({ error: result.status, message: UNPROCESSABLE[result.status] });
    }
    return reply
      .code(201)
      .header('cache-control', 'no-store')
      .send({
        subscriptionId: result.subscriptionId,
        managementToken: result.managementToken,
        point: {
          id: result.point.id,
          code: result.point.code,
          name: result.point.name,
          routeCode: result.point.routeCode,
        },
      });
  });

  app.delete('/subscriptions/:id', { config: { rateLimit } }, async (request, reply) => {
    const params = subscriptionParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply, params.error);
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer')
        .send({ error: 'unauthorized', message: 'The management token is required.' });
    }

    switch (await options.subscriptions.cancel(params.data.id, token)) {
      case 'cancelled':
        return reply.code(204).send();
      case 'forbidden':
        return reply.code(403).send({ error: 'forbidden' });
      case 'not_found':
        return reply.code(404).send({ error: 'not_found' });
    }
  });

  app.post(
    '/alerts/:alertId/receipts',
    {
      config: {
        rateLimit: { ...rateLimit, max: options.mutationsPerMinute * RECEIPT_LIMIT_FACTOR },
      },
    },
    async (request, reply) => {
      const params = receiptParamsSchema.safeParse(request.params);
      if (!params.success) return invalidRequest(reply, params.error);
      const body = receiptBodySchema.safeParse(request.body);
      if (!body.success) return invalidRequest(reply, body.error);

      const result = await options.subscriptions.confirmReceipt(
        params.data.alertId,
        body.data.subscriptionId,
        body.data.managementToken,
      );
      switch (result) {
        case 'confirmed':
          return reply.code(204).send();
        case 'forbidden':
          return reply.code(403).send({ error: 'forbidden' });
        case 'not_found':
          return reply.code(404).send({ error: 'not_found' });
      }
    },
  );

  done();
};

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S{1,256})$/i.exec(header?.trim() ?? '');
  return match?.[1] ?? null;
}

function pushUnavailable(reply: FastifyReply) {
  return reply
    .code(503)
    .send({ error: 'push_unavailable', message: 'Push notifications are not configured.' });
}

function invalidRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'invalid_request', details: z.prettifyError(error) });
}
