import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { DRIVE_VEHICLE_UNIQUE_ID, driveRi01 } from '../support/panel-drive.js';
import {
  createPanelUser,
  panelClient,
  TEST_PASSWORD_HASHER,
  type PanelClient,
} from '../support/panel-client.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, failAuditWritesOf, resetData } from './database.js';

const T0 = Date.parse('2026-10-20T12:00:00Z');

/** Auto-start, P01, an off-route fix, a 60 s gap, then P02. */
const DRIVE = [
  { seconds: 0, chainage: 0 },
  { seconds: 15, chainage: 20 },
  { seconds: 30, chainage: 40 },
  { seconds: 45, chainage: 60, eastMeters: 100 },
  { seconds: 60, chainage: 80 },
  { seconds: 120, chainage: 100 },
  { seconds: 135, chainage: 125 },
];

interface TripSummaryJson {
  id: string;
  status: string;
  routeCode: string;
  vehicleCode: string;
  startMode: string;
  endReason: string | null;
  endNote: string | null;
  passedPoints: number;
  totalPoints: number;
}

let db: AppDatabase;
let clock: ManualClock;
let api: Api;
let supervisor: PanelClient;
let observer: PanelClient;

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  await seedDatabase(db, { vehicleUniqueId: DRIVE_VEHICLE_UNIQUE_ID });
  clock = new ManualClock(new Date(T0));
  if (api !== undefined) await api.app.close();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: 'silent' }),
    passwordHasher: TEST_PASSWORD_HASHER,
  });
  await createPanelUser(api, 'sara.super', 'supervisor');
  await createPanelUser(api, 'omar.obs', 'observer');
  supervisor = await panelClient(api.app, 'sara.super');
  observer = await panelClient(api.app, 'omar.obs');
});

describe('panel trips (PostGIS)', () => {
  it('lists trips by route, service date and status', async () => {
    await driveRi01(api.app, clock, T0, DRIVE);

    const page = await supervisor.get(
      '/api/panel/trips?route=ri-01&from=2026-10-20&to=2026-10-20&status=active',
    );

    expect(page.statusCode).toBe(200);
    const body = page.json<{ items: TripSummaryJson[]; total: number; page: number }>();
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(body.items[0]).toMatchObject({
      routeCode: 'RI-01',
      vehicleCode: 'UNIDAD-A',
      status: 'active',
      startMode: 'auto',
      passedPoints: 2,
      totalPoints: 15,
      alertsCount: expect.any(Number) as number,
    });
    expect(
      (await supervisor.get('/api/panel/trips?from=2026-10-21')).json<{ total: number }>().total,
    ).toBe(0);
    expect((await supervisor.get('/api/panel/trips?status=completed')).json()).toMatchObject({
      total: 0,
      items: [],
    });
    expect((await supervisor.get('/api/panel/trips?from=20-10-2026')).statusCode).toBe(400);
  });

  it('details a trip: passes per point, summary, incidents and GeoJSON track', async () => {
    await driveRi01(api.app, clock, T0, DRIVE);
    const [trip] = (await supervisor.get('/api/panel/trips')).json<{ items: TripSummaryJson[] }>()
      .items;
    clock.set(new Date(T0 + 300_000));

    const detail = await supervisor.get(`/api/panel/trips/${trip?.id ?? ''}`);

    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      summary: object;
      points: { pointCode: string; passedAt: string | null; alert: object | null }[];
      incidents: unknown[];
      track: { type: string; coordinates: [number, number][] };
    }>();
    expect(body.summary).toEqual({
      durationSec: 300,
      fixCount: 7,
      offRouteCount: 1,
      maxGpsGapSec: 60,
    });
    expect(body.points).toHaveLength(15);
    expect(body.points.slice(0, 3).map((p) => [p.pointCode, p.passedAt !== null])).toEqual([
      ['P01', true],
      ['P02', true],
      ['P03', false],
    ]);
    expect(body.incidents).toEqual([]);
    expect(body.track.type).toBe('LineString');
    expect(body.track.coordinates).toHaveLength(7);
    expect(body.track.coordinates[0]?.[1]).toBeCloseTo(-9.52, 1);

    expect((await supervisor.get('/api/panel/trips/not-a-uuid')).statusCode).toBe(404);
    expect(
      (await supervisor.get('/api/panel/trips/00000000-0000-4000-8000-000000000000')).json(),
    ).toMatchObject({ error: 'trip_not_found' });
  });

  it("details each point's alert with its delivery counts, and the trip's incidents", async () => {
    await driveRi01(api.app, clock, T0, DRIVE);
    const [trip] = (await supervisor.get('/api/panel/trips')).json<{ items: TripSummaryJson[] }>()
      .items;
    const tripId = trip?.id ?? '';
    const points = await db
      .selectFrom('reference_points')
      .select(['id', 'code', 'route_id'])
      .where('code', 'in', ['P03', 'P05'])
      .orderBy('code')
      .execute();
    const [p03, p05] = points;
    // Replace whatever the drive emitted with one alert of known content.
    await db.deleteFrom('alerts').where('trip_id', '=', tripId).execute();
    const alert = await db
      .insertInto('alerts')
      .values({
        trip_id: tripId,
        point_id: p03?.id ?? '',
        emitted_at: new Date(T0 + 60_000),
        communicated_predicted_pass_at: new Date(T0 + 480_000),
        seconds_remaining_at_emission: 419.6,
        inside_target_window: true,
        recipients_count: 3,
        delivered_count: 2,
        failed_count: 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const subscriptions = await db
      .insertInto('push_subscriptions')
      .values(
        ['a', 'b', 'c'].map((device) => ({
          endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
          p256dh: 'key',
          auth: 'auth',
          point_id: p03?.id ?? '',
          consent_at: new Date(T0),
          consent_version: 'v1',
          management_token_hash: `hash-${device}`,
        })),
      )
      .returning('id')
      .execute();
    await db
      .insertInto('alert_deliveries')
      .values(
        subscriptions.map((sub, index) => ({
          alert_id: alert.id,
          subscription_id: sub.id,
          status: index < 2 ? 'sent' : 'failed',
          sent_at: new Date(T0 + 61_000),
          received_at: index === 0 ? new Date(T0 + 62_000) : null,
        })),
      )
      .execute();
    await db
      .insertInto('incidents')
      .values([
        {
          trip_id: tripId,
          route_id: p05?.route_id ?? '',
          point_id: p05?.id ?? '',
          kind: 'route_change',
          description: 'Market on the street',
          occurred_at: new Date(T0 + 90_000),
          reported_by: 'Sara',
        },
        {
          trip_id: tripId,
          route_id: p05?.route_id ?? '',
          point_id: null,
          kind: 'gps_failure',
          description: '',
          occurred_at: new Date(T0 + 30_000),
          reported_by: 'Sara',
        },
      ])
      .execute();

    const body = (await supervisor.get(`/api/panel/trips/${tripId}`)).json<{
      points: { pointCode: string; alert: object | null }[];
      incidents: object[];
    }>();

    expect(body.points.find((p) => p.pointCode === 'P03')?.alert).toEqual({
      emittedAt: new Date(T0 + 60_000).toISOString(),
      communicatedPredictedPassAt: new Date(T0 + 480_000).toISOString(),
      secondsRemainingAtEmission: 420,
      insideTargetWindow: true,
      recipients: 3,
      delivered: 2,
      receiptsReceived: 1,
      failed: 1,
    });
    expect(body.points.filter((p) => p.alert !== null).map((p) => p.pointCode)).toEqual(['P03']);
    expect(body.incidents).toEqual([
      {
        id: expect.any(String) as string,
        kind: 'gps_failure',
        pointCode: null,
        description: '',
        occurredAt: new Date(T0 + 30_000).toISOString(),
        resolvedAt: null,
      },
      {
        id: expect.any(String) as string,
        kind: 'route_change',
        pointCode: 'P05',
        description: 'Market on the street',
        occurredAt: new Date(T0 + 90_000).toISOString(),
        resolvedAt: null,
      },
    ]);
  });

  it('starts a trip by hand, refuses a second one, and ends it with a note', async () => {
    const started = await supervisor.post('/api/panel/trips', {
      vehicleCode: 'unidad-a',
      routeCode: 'RI-01',
    });
    expect(started.statusCode).toBe(201);
    const trip = started.json<{ trip: TripSummaryJson }>().trip;
    expect(trip).toMatchObject({ status: 'active', startMode: 'manual', vehicleCode: 'UNIDAD-A' });

    const again = await supervisor.post('/api/panel/trips', {
      vehicleCode: 'UNIDAD-A',
      routeCode: 'RI-01',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'trip_already_active' });

    const ended = await supervisor.post(`/api/panel/trips/${trip.id}/end`, {
      note: 'Truck breakdown at P07',
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toMatchObject({
      trip: { status: 'aborted', endReason: 'manual', endNote: 'Truck breakdown at P07' },
    });
    expect(
      (await supervisor.post(`/api/panel/trips/${trip.id}/end`, { note: 'x' })).json(),
    ).toMatchObject({ error: 'trip_not_active' });

    const audit = await db
      .selectFrom('audit_events')
      .select(['action', 'entity_id', 'details'])
      .where('entity', '=', 'trip')
      .orderBy('id')
      .execute();
    expect(audit).toEqual([
      {
        action: 'trip.started',
        entity_id: trip.id,
        details: { vehicleCode: 'UNIDAD-A', routeCode: 'RI-01' },
      },
      { action: 'trip.ended', entity_id: trip.id, details: { note: 'Truck breakdown at P07' } },
    ]);
  });

  it('starts and ends nothing when the audit event cannot be written, so a retry works', async () => {
    const start = { vehicleCode: 'UNIDAD-A', routeCode: 'RI-01' };
    let restore = await failAuditWritesOf(db, 'trip.started');
    try {
      expect((await supervisor.post('/api/panel/trips', start)).statusCode).toBe(500);
    } finally {
      await restore();
    }
    expect((await supervisor.get('/api/panel/trips')).json()).toMatchObject({ total: 0 });
    const started = await supervisor.post('/api/panel/trips', start);
    expect(started.statusCode).toBe(201);
    const trip = started.json<{ trip: TripSummaryJson }>().trip;

    restore = await failAuditWritesOf(db, 'trip.ended');
    try {
      const failed = await supervisor.post(`/api/panel/trips/${trip.id}/end`, {
        note: 'Breakdown',
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await restore();
    }
    const retried = await supervisor.post(`/api/panel/trips/${trip.id}/end`, { note: 'Breakdown' });
    expect(retried.json()).toMatchObject({ trip: { status: 'aborted', endNote: 'Breakdown' } });

    const audit = await db
      .selectFrom('audit_events')
      .select('action')
      .where('entity', '=', 'trip')
      .orderBy('id')
      .execute();
    expect(audit.map((e) => e.action)).toEqual(['trip.started', 'trip.ended']);
  });

  it('answers 404 for unknown vehicles and routes and 400 without a note', async () => {
    expect(
      (
        await supervisor.post('/api/panel/trips', { vehicleCode: 'X-1', routeCode: 'RI-01' })
      ).json(),
    ).toMatchObject({ error: 'vehicle_not_found' });
    expect(
      (await supervisor.post('/api/panel/trips', { vehicleCode: 'UNIDAD-A', routeCode: 'XX-99' }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await supervisor.post('/api/panel/trips/00000000-0000-4000-8000-000000000000/end', {
          note: '',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('lists vehicles with their last fix, active trip and telemetry signal', async () => {
    await driveRi01(api.app, clock, T0, DRIVE);

    const live = (await supervisor.get('/api/panel/vehicles')).json<{ vehicles: object[] }>();
    expect(live.vehicles).toEqual([
      expect.objectContaining({
        code: 'UNIDAD-A',
        defaultRoute: { code: 'RI-01', name: 'Av. Centenario – Independencia' },
        signal: 'live',
        lastFix: expect.objectContaining({ at: new Date(T0 + 135_000).toISOString() }) as object,
        activeTrip: expect.objectContaining({ routeCode: 'RI-01' }) as object,
      }),
    ]);

    clock.set(new Date(T0 + 135_000 + 61_000));
    const stale = (await supervisor.get('/api/panel/vehicles')).json<{
      vehicles: { signal: string }[];
    }>();
    expect(stale.vehicles[0]?.signal).toBe('stale');
  });

  it('keeps observers away from trip control, the history and the fleet', async () => {
    const started = await supervisor.post('/api/panel/trips', {
      vehicleCode: 'UNIDAD-A',
      routeCode: 'RI-01',
    });
    const trip = started.json<{ trip: TripSummaryJson }>().trip;

    const end = await observer.post(`/api/panel/trips/${trip.id}/end`, { note: 'test' });
    expect(end.statusCode).toBe(403);
    expect(end.json()).toMatchObject({ error: 'forbidden' });
    expect((await observer.post('/api/panel/trips', {})).statusCode).toBe(403);
    expect((await observer.get('/api/panel/trips')).statusCode).toBe(403);
    expect((await observer.get('/api/panel/vehicles')).statusCode).toBe(403);
  });
});
