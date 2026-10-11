import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { RI01_GEOMETRY, RI01_SNAPSHOT } from '../support/ri01-tracking.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { RouteDetailResponse } from '../../src/routes/infrastructure/http/public-route-routes.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, resetData } from './database.js';

/** Tuesday 2026-10-20, 07:05 in Lima. */
const T0 = Date.parse('2026-10-20T12:05:00Z');

let db: AppDatabase;
let api: Api;
const clock = new ManualClock(new Date(T0));

function get(url: string) {
  return api.app.inject({ method: 'GET', url });
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
