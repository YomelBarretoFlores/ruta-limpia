import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG, browserSubscription } from '../support/api-config.js';
import { composeApi, type Api, type ApiConfig } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase, type SeedResult } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, resetData } from './database.js';

const NOW = new Date('2026-10-20T12:00:00Z');

let db: AppDatabase;
let seeded: SeedResult;
const apis: Api[] = [];

async function startApi(config: Partial<ApiConfig> = {}): Promise<FastifyInstance> {
  const api = await composeApi({
    config: { ...TEST_API_CONFIG, ...config },
    db,
    clock: new ManualClock(NOW),
    logger: pino({ level: 'silent' }),
  });
  apis.push(api);
  return api.app;
}

const subscribeBody = (overrides: Record<string, unknown> = {}) => ({
  subscription: browserSubscription('device-1'),
  pointCode: 'P08',
  consent: true,
  consentVersion: '2026-10',
  ...overrides,
});

function subscribe(app: FastifyInstance, body: object) {
  return app.inject({ method: 'POST', url: '/api/subscriptions', payload: body });
}

function cancel(app: FastifyInstance, id: string, token?: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/subscriptions/${id}`,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

const subscriptionRows = () => db.selectFrom('push_subscriptions').selectAll().execute();

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await Promise.all(apis.map((api) => api.app.close()));
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  seeded = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
});

describe('public push subscription API (PostGIS)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await startApi();
  });

  it('publishes the VAPID public key', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: TEST_API_CONFIG.vapid?.publicKey });
  });

  it('subscribes a household to a point with consent and stores only the token hash', async () => {
    const p08 = await db
      .selectFrom('reference_points')
      .select(['id', 'route_id'])
      .where('code', '=', 'P08')
      .executeTakeFirstOrThrow();
    const household = await db
      .insertInto('households')
      .values({
        code: 'H-001',
        route_id: seeded.routeId,
        point_id: p08.id,
        enrolled_at: NOW,
        consent_at: NOW,
        consent_version: '2026-10',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const response = await subscribe(app, subscribeBody({ householdCode: 'h-001' }));

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<{ subscriptionId: string; managementToken: string }>();
    expect(body).toEqual({
      subscriptionId: expect.any(String) as unknown,
      managementToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
      point: { id: p08.id, code: 'P08', name: expect.any(String) as unknown, routeCode: 'RI-01' },
    });
    const [row] = await subscriptionRows();
    expect(row).toMatchObject({
      id: body.subscriptionId,
      endpoint: browserSubscription('device-1').endpoint,
      point_id: p08.id,
      household_id: household.id,
      consent_at: NOW,
      consent_version: '2026-10',
      revoked_at: null,
      consecutive_failures: 0,
    });
    expect(row?.management_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(body.managementToken);
  });

  it('rejects a subscription without consent', async () => {
    const refused = await subscribe(app, subscribeBody({ consent: false }));
    const missing = await subscribe(app, subscribeBody({ consent: undefined }));

    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'consent_required' });
    expect(missing.statusCode).toBe(400);
    expect(await subscriptionRows()).toEqual([]);
  });

  it.each([
    ['an unknown point', { pointCode: 'P99' }, 'unknown_point'],
    ['an unknown household', { householdCode: 'H-404' }, 'unknown_household'],
    [
      'an endpoint outside the browser push services',
      {
        subscription: {
          ...browserSubscription('x'),
          endpoint: 'https://internal.example/hook',
        },
      },
      'unsupported_push_service',
    ],
  ])('answers 422 for %s', async (_case, overrides, error) => {
    const response = await subscribe(app, subscribeBody(overrides));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error });
  });

  it('rejects malformed bodies with 400', async () => {
    const both = await subscribe(app, subscribeBody({ pointId: seeded.routeId }));
    const badKeys = await subscribe(
      app,
      subscribeBody({ subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: {} } }),
    );

    expect(both.statusCode).toBe(400);
    expect(badKeys.statusCode).toBe(400);
  });

  it('moves the same endpoint to the new point and rotates its token', async () => {
    const first = (await subscribe(app, subscribeBody())).json<{
      subscriptionId: string;
      managementToken: string;
    }>();
    const second = await subscribe(app, subscribeBody({ pointCode: 'P09' }));

    expect(second.statusCode).toBe(201);
    const body = second.json<{ subscriptionId: string; managementToken: string }>();
    expect(body.subscriptionId).toBe(first.subscriptionId);
    expect(body.managementToken).not.toBe(first.managementToken);
    const rows = await subscriptionRows();
    expect(rows).toHaveLength(1);
    const p09 = await db
      .selectFrom('reference_points')
      .select('id')
      .where('code', '=', 'P09')
      .executeTakeFirstOrThrow();
    expect(rows[0]?.point_id).toBe(p09.id);
    expect((await cancel(app, first.subscriptionId, first.managementToken)).statusCode).toBe(403);
  });

  it('cancels only with the management token, as a soft delete', async () => {
    const { subscriptionId, managementToken } = (await subscribe(app, subscribeBody())).json<{
      subscriptionId: string;
      managementToken: string;
    }>();

    expect((await cancel(app, subscriptionId)).statusCode).toBe(401);
    expect((await cancel(app, subscriptionId, 'wrong-token')).statusCode).toBe(403);
    expect((await cancel(app, seeded.routeId, managementToken)).statusCode).toBe(404);
    expect((await cancel(app, 'not-a-uuid', managementToken)).statusCode).toBe(404);
    expect((await cancel(app, subscriptionId, managementToken)).statusCode).toBe(204);
    expect((await cancel(app, subscriptionId, managementToken)).statusCode).toBe(204);

    const [row] = await subscriptionRows();
    expect(row).toMatchObject({ revoke_reason: 'user_cancelled', revoked_at: NOW });
  });
});

describe('public push subscription API limits and configuration', () => {
  it('rate-limits subscriptions per client IP', async () => {
    const app = await startApi({ publicRateLimitPerMinute: 2 });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await subscribe(app, subscribeBody())).statusCode);

    expect(statuses).toEqual([201, 201, 429]);
  });

  it('answers 503 when Web Push is not configured', async () => {
    const app = await startApi({ vapid: null });

    const key = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    const subscription = await subscribe(app, subscribeBody());

    expect(key.statusCode).toBe(503);
    expect(subscription.statusCode).toBe(503);
  });
});
