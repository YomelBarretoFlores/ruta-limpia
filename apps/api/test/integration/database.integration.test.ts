import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RI01_SNAPSHOT } from '../support/ri01-tracking.js';
import { KyselyRouteRepository } from '../../src/routes/infrastructure/kysely-route-repository.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { createMigrator, migrateToLatest } from '../../src/shared/infrastructure/db/migrator.js';
import { seedDatabase, type SeedResult } from '../../src/shared/infrastructure/db/seed.js';
import { SILENT_LOGGER } from '../../src/shared/application/logger.js';
import { connectTestDatabase, resetData } from './database.js';

let db: AppDatabase;

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
});

const count = async (table: 'routes' | 'reference_points' | 'vehicles' | 'route_schedules') =>
  Number(
    (
      await db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );

describe('migrations', () => {
  it('create the schema, the one-active-trip index and the Instrument 1 view', async () => {
    const tables = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`.execute(db);
    const indexes = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'trips_one_active_per_vehicle'`.execute(db);

    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'alerts',
        'incidents',
        'instrument1_route_log',
        'positions',
        'reference_points',
        'route_schedules',
        'routes',
        'trip_point_passes',
        'trips',
        'vehicles',
      ]),
    );
    expect(indexes.rows[0]?.indexdef).toMatch(
      /UNIQUE INDEX .* \(vehicle_id\) WHERE \(status = 'active'/,
    );
  });

  it('roll back completely and apply again', async () => {
    const migrator = createMigrator(db);

    const down = await migrator.migrateDown();
    const tables = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'trips'`.execute(db);
    await migrateToLatest(db, SILENT_LOGGER);

    expect(down.error).toBeUndefined();
    expect(tables.rows[0]?.n).toBe(0);
    expect((await migrator.getMigrations()).every((m) => m.executedAt !== undefined)).toBe(true);
  });
});

describe('seed', () => {
  it('loads RI-01, its points, the truck and a schedule, idempotently', async () => {
    await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
    const second = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });

    expect(await count('routes')).toBe(1);
    expect(await count('reference_points')).toBe(15);
    expect(await count('vehicles')).toBe(1);
    expect(await count('route_schedules')).toBe(6);

    const points = await db
      .selectFrom('reference_points')
      .select(['code', 'chainage_m', 'observes_music'])
      .where('route_id', '=', second.routeId)
      .orderBy('sequence')
      .execute();
    expect(points.filter((p) => p.observes_music).map((p) => p.code)).toEqual([
      'P04',
      'P08',
      'P12',
    ]);
    points.forEach((p, i) => {
      expect(p.chainage_m).toBeCloseTo(RI01_SNAPSHOT.points[i]!.chainage, 6);
    });
    const vehicle = await db.selectFrom('vehicles').selectAll().executeTakeFirstOrThrow();
    expect(vehicle).toMatchObject({ code: 'UNIDAD-A', default_route_id: second.routeId });
  });

  it('produces a route snapshot equivalent to the domain fixture', async () => {
    const { routeId } = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });

    const snapshot = await new KyselyRouteRepository(db).findById(routeId);

    expect(snapshot?.code).toBe('RI-01');
    expect(snapshot?.geometry.lengthMeters).toBeCloseTo(RI01_SNAPSHOT.geometry.lengthMeters, 3);
    expect(snapshot?.points.map((p) => p.code)).toEqual(RI01_SNAPSHOT.points.map((p) => p.code));
    expect(snapshot?.points[7]?.lat).toBeCloseTo(RI01_SNAPSHOT.points[7]!.lat, 9);
    expect(await new KyselyRouteRepository(db).findById('not-a-uuid')).toBeNull();
  });
});

describe('integrity guards', () => {
  let seeded: SeedResult;
  beforeEach(async () => {
    seeded = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
  });

  const insertTrip = (status: 'active' | 'completed') =>
    db
      .insertInto('trips')
      .values({
        route_id: seeded.routeId,
        vehicle_id: seeded.vehicleId,
        status,
        start_mode: 'manual',
        started_at: new Date('2026-10-20T12:00:00Z'),
        ended_at: status === 'active' ? null : new Date('2026-10-20T13:00:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  it('allows at most one active trip per vehicle', async () => {
    await insertTrip('completed');
    await insertTrip('active');

    await expect(insertTrip('active')).rejects.toMatchObject({ code: '23505' });
  });

  it('allows at most one alert per trip and point', async () => {
    const trip = await insertTrip('active');
    const point = await db.selectFrom('reference_points').select('id').executeTakeFirstOrThrow();
    const alert = {
      trip_id: trip.id,
      point_id: point.id,
      emitted_at: new Date(),
      communicated_predicted_pass_at: new Date(),
      seconds_remaining_at_emission: 420,
      inside_target_window: true,
    };
    await db.insertInto('alerts').values(alert).execute();

    await expect(db.insertInto('alerts').values(alert).execute()).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('rejects a raw duplicate Traccar position id', async () => {
    const position = {
      vehicle_id: seeded.vehicleId,
      traccar_position_id: 4242,
      fix_time: new Date('2026-10-20T12:00:00Z'),
      received_at: new Date('2026-10-20T12:00:01Z'),
      location: sql`ST_GeogFromText('SRID=4326;POINT(-77.5286 -9.5232)')`,
      speed_kmh: 5,
      valid: true,
    };
    await db.insertInto('positions').values(position).execute();

    await expect(db.insertInto('positions').values(position).execute()).rejects.toMatchObject({
      code: '23505',
    });
  });
});

describe('instrument1_route_log view', () => {
  let seeded: SeedResult;
  let points: { id: string; code: string }[];
  beforeEach(async () => {
    seeded = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
    points = await db
      .selectFrom('reference_points')
      .select(['id', 'code'])
      .orderBy('sequence')
      .execute();
  });

  const insertTrip = (startedAt: string) =>
    db
      .insertInto('trips')
      .values({
        route_id: seeded.routeId,
        vehicle_id: seeded.vehicleId,
        status: 'completed',
        start_mode: 'auto',
        started_at: new Date(startedAt),
        ended_at: new Date(new Date(startedAt).getTime() + 3_600_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  const rowsOf = (tripId: string) =>
    db
      .selectFrom('instrument1_route_log')
      .selectAll()
      .where('trip_id', '=', tripId)
      .orderBy('point_sequence')
      .execute();

  it('dates a trip in America/Lima and takes the planned start of that local weekday', async () => {
    // Wednesday 2026-10-21 03:00 UTC is still Tuesday 2026-10-20 22:00 in Lima (UTC-5).
    const lateTuesday = await insertTrip('2026-10-21T03:00:00Z');
    // Sunday 2026-10-25 10:00 in Lima: the sample schedule has no Sunday start.
    const sunday = await insertTrip('2026-10-25T15:00:00Z');

    const [tuesdayRow] = await rowsOf(lateTuesday.id);
    const [sundayRow] = await rowsOf(sunday.id);

    expect(tuesdayRow).toMatchObject({ service_date: '2026-10-20', planned_start: '07:00:00' });
    expect(sundayRow).toMatchObject({ service_date: '2026-10-25', planned_start: null });
  });

  it('reports the ETA error only when an alert was sent and the point was passed', async () => {
    const trip = await insertTrip('2026-10-20T12:00:00Z');
    const [alertedAndPassed, passedOnly, alertedOnly] = points;
    await db
      .insertInto('alerts')
      .values(
        [alertedAndPassed!, alertedOnly!].map((point) => ({
          trip_id: trip.id,
          point_id: point.id,
          emitted_at: new Date('2026-10-20T12:02:00Z'),
          communicated_predicted_pass_at: new Date('2026-10-20T12:10:00Z'),
          seconds_remaining_at_emission: 480,
          inside_target_window: true,
        })),
      )
      .execute();
    await db
      .insertInto('trip_point_passes')
      .values(
        [alertedAndPassed!, passedOnly!].map((point) => ({
          trip_id: trip.id,
          point_id: point.id,
          passed_at: new Date('2026-10-20T12:13:30Z'),
          precision: 'interpolated' as const,
        })),
      )
      .execute();

    const rows = await rowsOf(trip.id);

    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({
      alert_emitted_at: new Date('2026-10-20T12:02:00Z'),
      communicated_eta: new Date('2026-10-20T12:10:00Z'),
      actual_passed_at: new Date('2026-10-20T12:13:30Z'),
      abs_error_minutes: 3.5,
    });
    expect(rows[1]).toMatchObject({
      alert_emitted_at: null,
      communicated_eta: null,
      actual_passed_at: new Date('2026-10-20T12:13:30Z'),
      abs_error_minutes: null,
    });
    expect(rows[2]).toMatchObject({
      communicated_eta: new Date('2026-10-20T12:10:00Z'),
      actual_passed_at: null,
      abs_error_minutes: null,
    });
    expect(rows.slice(3).every((row) => row.alert_emitted_at === null)).toBe(true);
  });
});
