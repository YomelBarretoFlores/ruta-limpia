import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG, browserSubscription } from '../support/api-config.js';
import { RI01_GEOMETRY, stopAndGoChainageAt } from '../support/ri01-tracking.js';
import { forwardAt } from '../support/traccar-forward.js';
import type { PushGateway } from '../../src/alerts/application/push-ports.js';
import { KyselyAlertDeliveryStore } from '../../src/alerts/infrastructure/kysely-alert-delivery-store.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase, type SeedResult } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, resetData } from './database.js';

/** Tuesday 2026-10-20, 07:05 in Lima. */
const T0 = Date.parse('2026-10-20T12:05:00Z');

interface Push {
  readonly endpoint: string;
  readonly payload: { alertId: string; subscriptionId: string; pointCode: string };
  readonly ttlSeconds: number;
}

let db: AppDatabase;
let seeded: SeedResult;
let api: Api;
const clock = new ManualClock(new Date(T0));
const pushes: Push[] = [];
/** Endpoints for which the fake push service answers 410 Gone. */
const goneEndpoints = new Set<string>();

const gateway: PushGateway = {
  send: (target, payload, options) => {
    pushes.push({
      endpoint: target.endpoint,
      payload: JSON.parse(payload) as Push['payload'],
      ttlSeconds: options.ttlSeconds,
    });
    return Promise.resolve({ httpStatus: goneEndpoints.has(target.endpoint) ? 410 : 201 });
  },
};

async function subscribe(app: FastifyInstance, device: string, pointCode: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/subscriptions',
    payload: {
      subscription: browserSubscription(device),
      pointCode,
      consent: true,
      consentVersion: '2026-10',
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ subscriptionId: string; managementToken: string }>();
}

function postReceipt(alertId: string, body: object) {
  return api.app.inject({
    method: 'POST',
    url: `/api/alerts/${alertId}/receipts`,
    payload: body,
  });
}

async function insertAlert(pointCode: string) {
  const point = await db
    .selectFrom('reference_points')
    .select('id')
    .where('code', '=', pointCode)
    .executeTakeFirstOrThrow();
  const trip = await db
    .insertInto('trips')
    .values({
      route_id: seeded.routeId,
      vehicle_id: seeded.vehicleId,
      status: 'active',
      start_mode: 'manual',
      started_at: new Date(T0),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return db
    .insertInto('alerts')
    .values({
      trip_id: trip.id,
      point_id: point.id,
      emitted_at: new Date(T0),
      communicated_predicted_pass_at: new Date(T0 + 420_000),
      seconds_remaining_at_emission: 420,
      inside_target_window: true,
    })
    .returning(['id', 'point_id'])
    .executeTakeFirstOrThrow();
}

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: 'silent' }),
    pushGateway: gateway,
  });
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  seeded = await seedDatabase(db, { vehicleUniqueId: 'ruta-limpia-unidad-a' });
  pushes.length = 0;
  goneEndpoints.clear();
  clock.set(new Date(T0));
});

describe('POST /api/alerts/:alertId/receipts (PostGIS)', () => {
  it('confirms the reception once, with the management token', async () => {
    const { subscriptionId, managementToken } = await subscribe(api.app, 'device-1', 'P08');
    const alert = await insertAlert('P08');
    await new KyselyAlertDeliveryStore(db).recordDelivery({
      alertId: alert.id,
      subscriptionId,
      status: 'sent',
      httpStatus: 201,
      sentAt: new Date(T0),
    });
    clock.set(new Date(T0 + 2_000));

    const first = await postReceipt(alert.id, { subscriptionId, managementToken });
    clock.set(new Date(T0 + 9_000));
    const again = await postReceipt(alert.id, { subscriptionId, managementToken });

    expect([first.statusCode, again.statusCode]).toEqual([204, 204]);
    const delivery = await db
      .selectFrom('alert_deliveries')
      .select('received_at')
      .executeTakeFirstOrThrow();
    expect(delivery.received_at).toEqual(new Date(T0 + 2_000));
  });

  it('refuses a wrong token, an unknown delivery and a malformed body', async () => {
    const { subscriptionId, managementToken } = await subscribe(api.app, 'device-1', 'P08');
    const alert = await insertAlert('P08');

    const wrongToken = await postReceipt(alert.id, { subscriptionId, managementToken: 'nope' });
    const noDelivery = await postReceipt(alert.id, { subscriptionId, managementToken });
    const unknownAlert = await postReceipt('not-an-alert', { subscriptionId, managementToken });
    const malformed = await postReceipt(alert.id, { subscriptionId });

    expect(wrongToken.statusCode).toBe(403);
    expect(noDelivery.statusCode).toBe(404);
    expect(unknownAlert.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(400);
  });
});

describe('KyselyAlertDeliveryStore (PostGIS)', () => {
  it('revokes a subscription when its failure streak reaches the limit, once', async () => {
    const { subscriptionId } = await subscribe(api.app, 'device-1', 'P08');
    const store = new KyselyAlertDeliveryStore(db);
    const at = new Date(T0);

    const revoked = [];
    for (let i = 0; i < 4; i++) revoked.push(await store.markFailure(subscriptionId, 3, at));

    expect(revoked).toEqual([false, false, true, false]);
    const row = await db
      .selectFrom('push_subscriptions')
      .select(['revoked_at', 'revoke_reason', 'consecutive_failures'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      revoked_at: at,
      revoke_reason: 'too_many_failures',
      consecutive_failures: 4,
    });
  });

  it('records one delivery per subscription and recomputes the alert counts', async () => {
    const a = await subscribe(api.app, 'device-a', 'P08');
    const b = await subscribe(api.app, 'device-b', 'P08');
    const alert = await insertAlert('P08');
    const store = new KyselyAlertDeliveryStore(db);
    const delivery = { alertId: alert.id, httpStatus: 201, sentAt: new Date(T0) };

    await store.recordDelivery({ ...delivery, subscriptionId: a.subscriptionId, status: 'sent' });
    await store.recordDelivery({ ...delivery, subscriptionId: a.subscriptionId, status: 'failed' });
    await store.recordDelivery({
      ...delivery,
      subscriptionId: b.subscriptionId,
      status: 'expired',
      httpStatus: 410,
    });
    const counts = await store.refreshAlertCounts(alert.id);

    expect(counts).toEqual({ recipients: 2, delivered: 1, failed: 1 });
    expect(
      await db
        .selectFrom('alerts')
        .select(['recipients_count', 'delivered_count', 'failed_count'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ recipients_count: 2, delivered_count: 1, failed_count: 1 });
    expect(await store.activeTargets(alert.point_id)).toHaveLength(2);
  });
});

describe('alert dispatch: RI-01 drive through the ingest endpoint', () => {
  it('pushes each alert once to every active subscription of its point, and only those', async () => {
    const codes = Array.from({ length: 15 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
    const byEndpoint = new Map<string, { subscriptionId: string; pointCode: string }>();
    for (const code of codes) {
      const device = `device-${code}`;
      const { subscriptionId } = await subscribe(api.app, device, code);
      byEndpoint.set(browserSubscription(device).endpoint, { subscriptionId, pointCode: code });
    }
    await subscribe(api.app, 'device-P08-second', 'P08');
    const cancelled = await subscribe(api.app, 'device-P08-cancelled', 'P08');
    await api.subscriptions.cancel(cancelled.subscriptionId, cancelled.managementToken);
    goneEndpoints.add(browserSubscription('device-P09').endpoint);

    let id = 1;
    for (let s = 0; stopAndGoChainageAt(s - 40) < RI01_GEOMETRY.lengthMeters; s += 20) {
      clock.set(new Date(T0 + s * 1000 + 1000));
      const response = await api.app.inject({
        method: 'POST',
        url: '/ingest/traccar/positions',
        headers: { 'x-ingest-token': TEST_API_CONFIG.ingestToken },
        payload: forwardAt(T0, id++, s, stopAndGoChainageAt(s)),
      });
      expect(response.statusCode).toBe(200);
    }
    await api.ingestPosition.whenNotificationsSettled();

    const alerts = await db
      .selectFrom('alerts as a')
      .innerJoin('reference_points as p', 'p.id', 'a.point_id')
      .select(['a.id', 'p.code', 'a.recipients_count', 'a.delivered_count', 'a.failed_count'])
      .execute();
    expect(alerts.length).toBeGreaterThan(5);
    expect(alerts.map((a) => a.code)).toContain('P08');
    const expected = alerts.flatMap((alert) =>
      [...byEndpoint.entries()]
        .filter(([, sub]) => sub.pointCode === alert.code)
        .map(([endpoint]) => `${alert.id} ${endpoint}`)
        .concat(
          alert.code === 'P08'
            ? [`${alert.id} ${browserSubscription('device-P08-second').endpoint}`]
            : [],
        ),
    );
    expect(pushes.map((p) => `${p.payload.alertId} ${p.endpoint}`).sort()).toEqual(expected.sort());
    expect(pushes.map((p) => p.endpoint)).not.toContain(
      browserSubscription('device-P08-cancelled').endpoint,
    );
    for (const push of pushes) {
      const alert = alerts.find((a) => a.id === push.payload.alertId);
      expect(push.payload.pointCode).toBe(alert?.code);
      expect(push.ttlSeconds).toBeGreaterThanOrEqual(60);
    }
    const p08 = alerts.find((a) => a.code === 'P08');
    expect(p08).toMatchObject({ recipients_count: 2, delivered_count: 2, failed_count: 0 });
    expect(await db.selectFrom('alert_deliveries').selectAll().execute()).toHaveLength(
      pushes.length,
    );

    const p09Alerted = alerts.some((a) => a.code === 'P09');
    const p09 = await db
      .selectFrom('push_subscriptions')
      .select(['revoke_reason'])
      .where('endpoint', '=', browserSubscription('device-P09').endpoint)
      .executeTakeFirstOrThrow();
    expect(p09.revoke_reason).toBe(p09Alerted ? 'expired' : null);
  });
});
