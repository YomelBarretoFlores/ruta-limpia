import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { RI01_GEOMETRY, stopAndGoChainageAt } from '../support/ri01-tracking.js';
import { forwardAt } from '../support/traccar-forward.js';
import type { EmittedAlert } from '../../src/alerts/application/alert-notifier.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase, type SeedResult } from '../../src/shared/infrastructure/db/seed.js';
import type { TrackingEventName } from '../../src/tracking/application/tracking-events.js';
import { connectTestDatabase, resetData } from './database.js';

const TOKEN = TEST_API_CONFIG.ingestToken;
const DEVICE = 'ruta-limpia-unidad-a';
/** Tuesday 2026-10-20, 07:05 in Lima (UTC-5). The seeded schedule starts at 07:00. */
const T0 = Date.parse('2026-10-20T12:05:00Z');

let db: AppDatabase;
let seeded: SeedResult;
const clock = new ManualClock(new Date(T0));
const apis: Api[] = [];
const notified: EmittedAlert[] = [];
const published: TrackingEventName[] = [];

async function startApi(): Promise<Api> {
  const api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: 'silent' }),
    notifier: {
      notify: (alert) => {
        notified.push(alert);
        return Promise.resolve();
      },
    },
  });
  for (const name of ['trip.started', 'point.passed', 'trip.completed', 'alert.emitted'] as const) {
    api.events.subscribe(name, () => published.push(name));
  }
  apis.push(api);
  return api;
}

function forward(id: number, seconds: number, chainage: number, uniqueId = DEVICE) {
  return forwardAt(T0, id, seconds, chainage, uniqueId);
}

function post(app: FastifyInstance, body: unknown, token: string | null = TOKEN) {
  return app.inject({
    method: 'POST',
    url: '/ingest/traccar/positions',
    headers: token === null ? {} : { 'x-ingest-token': token },
    payload: body as object,
  });
}

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await Promise.all(apis.map((api) => api.app.close()));
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  seeded = await seedDatabase(db, { vehicleUniqueId: DEVICE });
  notified.length = 0;
  published.length = 0;
  clock.set(new Date(T0));
});

describe('POST /ingest/traccar/positions (PostGIS)', () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });

  it('rejects requests without a valid token', async () => {
    expect((await post(api.app, forward(1, 0, 0), null)).statusCode).toBe(401);
    expect((await post(api.app, forward(1, 0, 0), 'x'.repeat(TOKEN.length))).statusCode).toBe(401);
    expect(await db.selectFrom('positions').selectAll().execute()).toEqual([]);
  });

  it('rejects malformed payloads with 400', async () => {
    const response = await post(api.app, { position: { id: 1 }, device: {} });

    expect(response.statusCode).toBe(400);
  });

  it('accepts positions of unknown devices with 202 without storing them', async () => {
    const response = await post(api.app, forward(1, 0, 0, 'unregistered-imei'));

    expect(response.statusCode).toBe(202);
    expect(await db.selectFrom('positions').selectAll().execute()).toEqual([]);
  });

  it('stores a replayed position once and answers 200 both times', async () => {
    const first = await post(api.app, forward(7, 0, 0));
    const replay = await post(api.app, forward(7, 0, 0));

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ status: 'duplicate' });
    expect(await db.selectFrom('positions').selectAll().execute()).toHaveLength(1);
  });

  it('accepts a position Traccar forwards before storing it (id 0), and stores it once', async () => {
    // Traccar 6.16 forwards before its database handler runs, so a position can arrive with id 0;
    // when the answer is lost, its retry may then carry the stored id.
    const unstored = await post(api.app, forward(0, 0, 0));
    const replay = await post(api.app, forward(0, 0, 0));
    const retried = await post(api.app, forward(41, 0, 0));

    expect([unstored.statusCode, replay.statusCode, retried.statusCode]).toEqual([200, 200, 200]);
    expect([replay.json(), retried.json()]).toEqual([
      { status: 'duplicate' },
      { status: 'duplicate' },
    ]);
    const rows = await db.selectFrom('positions').select('traccar_position_id').execute();
    expect(rows).toEqual([{ traccar_position_id: null }]);
    expect((await post(api.app, forward(-3, 20, 30))).statusCode).toBe(400);
  });

  it('aborts a manual trip after inactivity', async () => {
    const trip = await api.tripLifecycle.startTrip({
      vehicleId: seeded.vehicleId,
      routeId: seeded.routeId,
      mode: 'manual',
    });
    clock.set(new Date(T0 + 31 * 60_000));

    await api.inactivityJob.runOnce();

    const row = await db
      .selectFrom('trips')
      .select(['status', 'end_reason', 'start_mode'])
      .where('id', '=', trip.state.tripId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'aborted', end_reason: 'inactivity', start_mode: 'manual' });
  });
});

describe('RI-01 stop-and-go drive through the HTTP endpoint', () => {
  it('auto-starts, passes every point, alerts each point once and logs Instrument 1', async () => {
    const [apiA, apiB] = [await startApi(), await startApi()];
    const ids = new Set<number>();
    const statuses: number[] = [];
    let nextId = 1;
    const send = async (app: FastifyInstance, id: number, seconds: number) => {
      ids.add(id);
      const response = await post(app, forward(id, seconds, stopAndGoChainageAt(seconds)));
      statuses.push(response.statusCode);
    };

    for (let s = 0; stopAndGoChainageAt(s - 40) < RI01_GEOMETRY.lengthMeters; s += 20) {
      clock.set(new Date(T0 + s * 1000 + 1000));
      if (s === 400 || s === 800) {
        // Concurrent replays through two API instances (separate in-process locks): the same
        // Traccar position twice, plus the same fix under a new Traccar id (a replay too: one row).
        const id = nextId++;
        const twin = nextId++;
        await Promise.all([send(apiA.app, id, s), send(apiB.app, id, s), send(apiB.app, twin, s)]);
        ids.delete(twin);
      } else {
        await send(apiA.app, nextId++, s);
      }
    }

    await Promise.all([apiA, apiB].map((api) => api.ingestPosition.whenNotificationsSettled()));
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(await db.selectFrom('positions').selectAll().execute()).toHaveLength(ids.size);

    const trips = await db.selectFrom('trips').selectAll().execute();
    expect(trips).toHaveLength(1);
    const trip = trips[0]!;
    expect(trip).toMatchObject({
      status: 'completed',
      start_mode: 'auto',
      end_reason: 'route_completed',
      started_at: new Date(T0),
    });

    const passes = await db
      .selectFrom('trip_point_passes')
      .selectAll()
      .where('trip_id', '=', trip.id)
      .execute();
    expect(passes).toHaveLength(15);

    const alerts = await db
      .selectFrom('alerts')
      .selectAll()
      .where('trip_id', '=', trip.id)
      .execute();
    expect(alerts.length).toBeGreaterThan(5);
    expect(new Set(alerts.map((a) => a.point_id)).size).toBe(alerts.length);
    expect(notified.map((a) => a.alertId).sort()).toEqual(alerts.map((a) => a.id).sort());
    expect(published.filter((name) => name === 'point.passed')).toHaveLength(15);
    expect(published.filter((name) => name === 'trip.started')).toHaveLength(1);
    expect(published.filter((name) => name === 'trip.completed')).toHaveLength(1);

    const p05 = await db
      .selectFrom('reference_points')
      .select('id')
      .where('code', '=', 'P05')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('incidents')
      .values({
        trip_id: trip.id,
        route_id: seeded.routeId,
        point_id: p05.id,
        kind: 'route_change',
        occurred_at: new Date(T0 + 300_000),
        reported_by: 'integration-test',
      })
      .execute();

    const log = await db
      .selectFrom('instrument1_route_log')
      .selectAll()
      .where('trip_id', '=', trip.id)
      .orderBy('point_sequence')
      .execute();
    const pointIds = new Map(
      (await db.selectFrom('reference_points').select(['id', 'code']).execute()).map((p) => [
        p.code,
        p.id,
      ]),
    );
    expect(log).toHaveLength(15);
    for (const row of log) {
      const pointId = pointIds.get(row.point_code);
      expect(row).toMatchObject({
        service_date: '2026-10-20',
        route_code: 'RI-01',
        vehicle_code: 'UNIDAD-A',
        trip_status: 'completed',
        planned_start: '07:00:00',
        actual_start: new Date(T0),
        trip_incidents_count: 1,
        point_incidents_count: row.point_code === 'P05' ? 1 : 0,
      });
      const pass = passes.find((p) => p.point_id === pointId);
      expect(row.actual_passed_at).toEqual(pass?.passed_at);
      expect(row.pass_precision).toBe(pass?.precision);
      const alert = alerts.find((a) => a.point_id === pointId);
      if (alert === undefined) {
        // No alert was sent: no ETA and no error, never a reconstructed prediction.
        expect(row.alert_emitted_at).toBeNull();
        expect(row.communicated_eta).toBeNull();
        expect(row.abs_error_minutes).toBeNull();
      } else {
        expect(row.alert_emitted_at).toEqual(alert.emitted_at);
        expect(row.communicated_eta).toEqual(alert.communicated_predicted_pass_at);
        const expected =
          Math.abs(row.actual_passed_at!.getTime() - row.communicated_eta!.getTime()) / 60_000;
        expect(row.abs_error_minutes).toBeCloseTo(expected, 6);
      }
    }
    expect(log.some((row) => row.alert_emitted_at === null)).toBe(true);

    const profile = await apiA.speedProfiles.forRoute(seeded.routeId);
    expect(profile?.bucketSpeedsMps.filter((speed) => speed !== null).length).toBeGreaterThan(10);
  });
});
