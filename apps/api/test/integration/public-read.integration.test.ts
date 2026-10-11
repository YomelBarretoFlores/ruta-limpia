import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { RI01_GEOMETRY, RI01_SNAPSHOT, stopAndGoChainageAt } from '../support/ri01-tracking.js';
import { forwardAt } from '../support/traccar-forward.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { LiveSnapshotResponse } from '../../src/live/infrastructure/http/live-schemas.js';
import type { RouteDetailResponse } from '../../src/routes/infrastructure/http/public-route-routes.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import type { TrackingEvents } from '../../src/tracking/application/tracking-events.js';
import { connectTestDatabase, resetData } from './database.js';

/** Tuesday 2026-10-20, 07:05 in Lima. */
const T0 = Date.parse('2026-10-20T12:05:00Z');

let db: AppDatabase;
let api: Api;
const clock = new ManualClock(new Date(T0));

function get(url: string) {
  return api.app.inject({ method: 'GET', url });
}

/** Drives RI-01 stop-and-go through the ingest endpoint for `seconds`, one fix every 20 s. */
async function drive(seconds: number) {
  let id = 1;
  for (let s = 0; s <= seconds; s += 20) {
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
}

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: 'silent' }),
    notifier: { notify: () => Promise.resolve() },
  });
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  await seedDatabase(db, { vehicleUniqueId: 'ruta-limpia-unidad-a' });
  api.routes.invalidate();
  clock.set(new Date(T0));
});

describe('public route catalog (PostGIS)', () => {
  it('lists the active routes', async () => {
    const response = await get('/api/routes');

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.json()).toEqual({
      routes: [
        {
          code: 'RI-01',
          name: 'Av. Centenario – Independencia',
          district: 'Independencia',
          lengthMeters: Math.round(RI01_GEOMETRY.lengthMeters * 10) / 10,
          pointCount: 15,
        },
      ],
    });
  });

  it('describes a route with its geometry, points and weekly schedule', async () => {
    const response = await get('/api/routes/ri-01');

    expect(response.statusCode).toBe(200);
    const body = response.json<RouteDetailResponse>();
    expect(body).toMatchObject({ code: 'RI-01', pointCount: 15, timeZone: 'America/Lima' });
    expect(body.geometry.type).toBe('LineString');
    expect(body.geometry.coordinates).toHaveLength(17);
    expect(body.geometry.coordinates[1]).toEqual([-77.528621, -9.523207]);
    expect(body.points.map((p) => p.code)).toEqual(RI01_SNAPSHOT.points.map((p) => p.code));
    expect(body.points[7]).toEqual({
      code: 'P08',
      name: 'Reference point P08',
      sequence: 8,
      lat: expect.closeTo(-9.517875, 6) as unknown,
      lon: expect.closeTo(-77.530031, 6) as unknown,
      chainageMeters: Math.round(RI01_SNAPSHOT.points[7]!.chainage * 10) / 10,
      observesMusic: true,
    });
    expect(body.points.filter((p) => p.observesMusic).map((p) => p.code)).toEqual([
      'P04',
      'P08',
      'P12',
    ]);
    expect(body.schedule).toEqual(
      [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, plannedStart: '07:00' })),
    );
    expect(JSON.stringify(body)).not.toMatch(/"id"|routeId/);
  });

  it('answers 404 for an unknown or inactive route and 400 for a malformed code', async () => {
    await db.updateTable('routes').set({ active: false }).execute();

    expect((await get('/api/routes')).json()).toEqual({ routes: [] });
    expect((await get('/api/routes/RI-01')).statusCode).toBe(404);
    expect((await get('/api/routes/XX-99')).statusCode).toBe(404);
    expect((await get('/api/routes/bad%20code')).statusCode).toBe(400);
  });
});

describe('live route snapshot (PostGIS)', () => {
  it('has no trip before the truck starts', async () => {
    const response = await get('/api/live/routes/RI-01');

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      route: { code: 'RI-01', name: 'Av. Centenario – Independencia' },
      generatedAt: new Date(T0).toISOString(),
      staleAfterSeconds: 60,
      trips: [],
    });
    expect((await get('/api/live/routes/XX-99')).statusCode).toBe(404);
  });

  it('shows the truck, passes, alerts and live ETAs during a drive', async () => {
    await drive(600);

    const snapshot = (await get('/api/live/routes/RI-01')).json<LiveSnapshotResponse>();

    expect(snapshot.generatedAt).toBe(clock.now().toISOString());
    expect(snapshot.trips).toHaveLength(1);
    const [trip] = snapshot.trips;
    expect(trip).toMatchObject({
      startMode: 'auto',
      vehicle: { code: 'UNIDAD-A', label: 'Unidad A (compactadora)' },
      signal: 'live',
      lastFixAt: new Date(T0 + 600_000).toISOString(),
      lastPosition: { fixTime: new Date(T0 + 600_000).toISOString() },
    });
    expect(trip!.progress.chainageMeters).toBeCloseTo(stopAndGoChainageAt(600), 0);
    expect(trip!.progress.percent).toBeGreaterThan(0);
    const passed = trip!.etas.filter((e) => e.status === 'passed').map((e) => e.pointCode);
    expect(trip!.passes.map((p) => p.pointCode)).toEqual(passed);
    expect(passed.length).toBeGreaterThan(0);
    const live = trip!.etas.filter((e) => e.status === 'live');
    expect(live.length).toBe(15 - passed.length);
    for (const eta of live) {
      expect(eta.window.minMinutes).toBeLessThan(eta.window.maxMinutes);
      expect(Date.parse(eta.predictedPassAt)).toBeGreaterThanOrEqual(clock.now().getTime());
    }
    expect(trip!.alerts.length).toBeGreaterThan(0);
    expect(trip!.alerts[0]).toEqual({
      pointId: expect.any(String) as unknown,
      pointCode: expect.stringMatching(/^P\d{2}$/) as unknown,
      emittedAt: expect.any(String) as unknown,
      communicatedPredictedPassAt: expect.any(String) as unknown,
      recipients: 0,
      delivered: 0,
    });
  });

  it('withholds every prediction once the telemetry is stale', async () => {
    await drive(300);
    clock.set(new Date(T0 + 300_000 + 61_000));

    const response = await get('/api/live/routes/RI-01');

    const [trip] = response.json<LiveSnapshotResponse>().trips;
    expect(trip?.signal).toBe('stale');
    const pending = trip!.etas.filter((e) => e.status !== 'passed');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((e) => e.status === 'stale')).toBe(true);
    expect(response.body).not.toContain('"predictedPassAt"');
    expect(response.body).not.toContain('"window"');
  });
});

describe('periodic ETA refresh (PostGIS)', () => {
  it('republishes the ETAs between fixes and suspends them once the telemetry is stale', async () => {
    await drive(300);
    const events: TrackingEvents['eta.updated'][] = [];
    const unsubscribe = api.events.subscribe('eta.updated', (payload) => events.push(payload));
    const alerts = await db.selectFrom('alerts').select('id').execute();

    clock.set(new Date(T0 + 315_000));
    expect(await api.etaRefresh.refreshAll()).toBe(1);
    clock.set(new Date(T0 + 361_000 + 1_000));
    expect(await api.etaRefresh.refreshAll()).toBe(1);
    unsubscribe();

    expect(events.map((e) => e.lastFixAt)).toEqual([
      new Date(T0 + 300_000),
      new Date(T0 + 300_000),
    ]);
    expect(events[0]!.etas.some((e) => e.status === 'live')).toBe(true);
    expect(
      events[1]!.etas.filter((e) => e.status !== 'passed').every((e) => e.status === 'stale'),
    ).toBe(true);
    expect(await db.selectFrom('alerts').select('id').execute()).toHaveLength(alerts.length);
  });
});
