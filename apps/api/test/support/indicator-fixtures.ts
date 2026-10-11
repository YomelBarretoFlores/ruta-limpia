import { sql } from 'kysely';

import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';

/**
 * A small, hand-computable pilot on RI-01 for the indicator and export tests. The period is two
 * weeks, Monday 2026-11-16 to Sunday 2026-11-29 (America/Lima, UTC−5). Expected values, worked
 * out by hand, are in `EXPECTED` below and in docs/indicators.md.
 */
export const PERIOD = { from: '2026-11-16', to: '2026-11-29' } as const;
export const NOW = new Date('2026-12-01T00:00:00Z');

const at = (iso: string) => new Date(iso);

export interface IndicatorFixture {
  readonly routeId: string;
  readonly vehicleId: string;
  readonly tripId: string;
  readonly points: ReadonlyMap<string, string>;
  readonly households: ReadonlyMap<string, string>;
}

/**
 * - Trip A (2026-11-17 07:00–08:00 local, completed): alerts at P01, P02, P03 with errors 2, 7
 *   and 4 minutes; the other 12 points have no alert. Valid fixes every 30 s from 07:00:30 to
 *   07:30:00, one invalid fix at 07:45 and one fix of 07:50 received at 07:52.
 * - Trip C (2026-11-10, outside the period): an alert with a 30-minute error.
 * - Instrument 2 sheets at P01, P04 and P08 (baseline, intervention, post), with an incomplete
 *   exposure, a missing one, a non-comparable window and a zero dispersion baseline.
 * - Households H-001…H-005 (H-004 enrolled 2026-11-25, H-005 inactive), their views, alerts and
 *   pre/post surveys.
 */
export async function seedIndicatorFixture(db: AppDatabase): Promise<IndicatorFixture> {
  const { routeId, vehicleId } = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
  const pointRows = await db.selectFrom('reference_points').select(['id', 'code']).execute();
  const points = new Map(pointRows.map((p) => [p.code, p.id]));
  const point = (code: string) => {
    const id = points.get(code);
    if (id === undefined) throw new Error(`no point ${code}`);
    return id;
  };

  const trip = (startedAt: string) =>
    db
      .insertInto('trips')
      .values({
        route_id: routeId,
        vehicle_id: vehicleId,
        status: 'completed',
        start_mode: 'auto',
        started_at: at(startedAt),
        ended_at: new Date(at(startedAt).getTime() + 3_600_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const tripA = await trip('2026-11-17T12:00:00Z');
  const tripC = await trip('2026-11-10T12:00:00Z');

  const alert = async (tripId: string, code: string, predicted: string, passed: string) => {
    await db
      .insertInto('trip_point_passes')
      .values({
        trip_id: tripId,
        point_id: point(code),
        passed_at: at(passed),
        precision: 'interpolated',
      })
      .execute();
    return db
      .insertInto('alerts')
      .values({
        trip_id: tripId,
        point_id: point(code),
        emitted_at: new Date(at(predicted).getTime() - 420_000),
        communicated_predicted_pass_at: at(predicted),
        seconds_remaining_at_emission: 420,
        inside_target_window: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  };
  const alertP01 = await alert(tripA.id, 'P01', '2026-11-17T12:10:00Z', '2026-11-17T12:12:00Z');
  const alertP02 = await alert(tripA.id, 'P02', '2026-11-17T12:20:00Z', '2026-11-17T12:27:00Z');
  await alert(tripA.id, 'P03', '2026-11-17T12:30:00Z', '2026-11-17T12:26:00Z');
  await alert(tripC.id, 'P01', '2026-11-10T12:10:00Z', '2026-11-10T12:40:00Z');
  // A pass without an alert: a missing record for the ETA precision.
  await db
    .insertInto('trip_point_passes')
    .values({
      trip_id: tripA.id,
      point_id: point('P04'),
      passed_at: at('2026-11-17T12:35:00Z'),
      precision: 'interpolated',
    })
    .execute();

  const location = sql`ST_GeogFromText('SRID=4326;POINT(-77.5286 -9.5232)')`;
  const fix = (id: number, fixTime: Date, receivedAt: Date, valid = true) => ({
    vehicle_id: vehicleId,
    trip_id: tripA.id,
    traccar_position_id: id,
    fix_time: fixTime,
    received_at: receivedAt,
    location,
    speed_kmh: 10,
    valid,
  });
  const start = at('2026-11-17T12:00:00Z').getTime();
  const fixes = Array.from({ length: 60 }, (_, i) => {
    const time = new Date(start + (i + 1) * 30_000);
    return fix(i + 1, time, new Date(time.getTime() + 1000));
  });
  fixes.push(fix(61, at('2026-11-17T12:45:00Z'), at('2026-11-17T12:45:01Z'), false));
  fixes.push(fix(62, at('2026-11-17T12:50:00Z'), at('2026-11-17T12:52:00Z')));
  await db.insertInto('positions').values(fixes).execute();

  const sheet = (
    code: string,
    phase: 'baseline' | 'intervention' | 'post',
    values: {
      exposure?: number | null;
      incomplete?: boolean;
      dispersion?: 'none' | 'few' | 'many' | null;
      broken?: number | null;
      remaining?: boolean | null;
      music?: number | null;
      comparable?: boolean | null;
    },
  ) => {
    const music = values.music ?? null;
    return {
      route_id: routeId,
      point_id: point(code),
      observed_on: phase === 'baseline' ? '2026-10-20' : '2026-12-10',
      phase,
      observers: 'L.R.',
      exposure_minutes: values.exposure ?? null,
      exposure_incomplete: values.incomplete ?? false,
      dispersion: values.dispersion ?? null,
      broken_bags: values.broken ?? null,
      waste_remaining_after_pass: values.remaining ?? null,
      music_window_start: music === null ? null : '07:00',
      music_window_end: music === null ? null : '07:30',
      music_seconds: music,
      comparable_window: values.comparable ?? null,
      created_at: NOW,
      updated_at: NOW,
    };
  };
  await db
    .insertInto('field_observations')
    .values([
      sheet('P01', 'baseline', { exposure: 60, dispersion: 'none', broken: 2, remaining: true }),
      sheet('P01', 'baseline', { exposure: 80, dispersion: 'none', broken: 0, remaining: false }),
      sheet('P04', 'baseline', { exposure: 100, dispersion: 'none', music: 300 }),
      sheet('P04', 'baseline', { exposure: 30, incomplete: true, music: 200 }),
      sheet('P08', 'baseline', { dispersion: 'none' }),
      sheet('P01', 'intervention', { exposure: 5, dispersion: 'many' }),
      sheet('P01', 'post', { exposure: 40, dispersion: 'none' }),
      sheet('P04', 'post', { exposure: 50, dispersion: 'few', music: 120 }),
      sheet('P04', 'post', { exposure: 20, dispersion: 'many', music: 10, comparable: false }),
      sheet('P08', 'post', { exposure: 30, dispersion: 'none', music: 60, comparable: true }),
    ])
    .execute();

  const household = (code: string, enrolledAt: string, active = true) =>
    db
      .insertInto('households')
      .values({
        code,
        route_id: routeId,
        point_id: point('P02'),
        enrolled_at: at(enrolledAt),
        consent_at: at(enrolledAt),
        consent_version: '2026-10-v1',
        active,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const h1 = await household('H-001', '2026-11-01T15:00:00Z');
  const h2 = await household('H-002', '2026-11-01T15:00:00Z');
  const h3 = await household('H-003', '2026-11-01T15:00:00Z');
  const h4 = await household('H-004', '2026-11-25T15:00:00Z');
  const h5 = await household('H-005', '2026-11-01T15:00:00Z', false);
  const households = new Map([
    ['H-001', h1.id],
    ['H-002', h2.id],
    ['H-003', h3.id],
    ['H-004', h4.id],
    ['H-005', h5.id],
  ]);

  await db
    .insertInto('app_views')
    .values([
      { point_id: point('P02'), household_id: h1.id, viewed_at: at('2026-11-17T14:00:00Z') },
      // Not linked to a household: never counted.
      { point_id: point('P02'), household_id: null, viewed_at: at('2026-11-17T14:00:00Z') },
      // After the period.
      { point_id: point('P02'), household_id: h1.id, viewed_at: at('2026-11-30T14:00:00Z') },
      // An inactive household.
      { point_id: point('P02'), household_id: h5.id, viewed_at: at('2026-11-17T14:00:00Z') },
    ])
    .execute();
  const subscription = (householdId: string, device: string) =>
    db
      .insertInto('push_subscriptions')
      .values({
        endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
        p256dh: 'p256dh',
        auth: 'auth',
        point_id: point('P02'),
        household_id: householdId,
        consent_at: at('2026-11-01T15:00:00Z'),
        consent_version: '2026-10-v1',
        management_token_hash: device,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const s2 = await subscription(h2.id, 'device-2');
  const s3 = await subscription(h3.id, 'device-3');
  await db
    .insertInto('alert_deliveries')
    .values([
      {
        alert_id: alertP01.id,
        subscription_id: s2.id,
        status: 'sent',
        sent_at: at('2026-11-18T12:00:00Z'),
        received_at: at('2026-11-18T12:00:02Z'),
      },
      {
        alert_id: alertP01.id,
        subscription_id: s3.id,
        status: 'failed',
        sent_at: at('2026-11-17T12:00:00Z'),
        received_at: null,
      },
      {
        alert_id: alertP02.id,
        subscription_id: s3.id,
        status: 'sent',
        sent_at: at('2026-11-24T12:00:00Z'),
        received_at: null,
      },
    ])
    .execute();

  const survey = (
    householdId: string,
    wave: 'pre' | 'post',
    answers: {
      q2?: '0_15' | '15_60' | '1_3h' | 'gt_3h' | 'after_pass';
      q11?: number;
      q12?: number;
      notHeard?: boolean;
    },
  ) => ({
    household_id: householdId,
    wave,
    surveyed_on: wave === 'pre' ? '2026-10-15' : '2026-12-15',
    q2_lead_time: answers.q2 ?? null,
    q11_satisfaction: answers.q11 ?? null,
    q12_annoyance: answers.q12 ?? null,
    q12_not_heard: answers.notHeard ?? false,
    created_at: NOW,
    updated_at: NOW,
  });
  await db
    .insertInto('household_surveys')
    .values([
      survey(h1.id, 'pre', { q2: 'gt_3h', q12: 3 }),
      survey(h1.id, 'post', { q2: '0_15', q11: 5, q12: 1 }),
      survey(h2.id, 'pre', { q2: 'after_pass', q12: 2 }),
      survey(h2.id, 'post', { q2: '0_15', q11: 3, notHeard: true }),
      survey(h3.id, 'pre', { q2: '0_15' }),
      survey(h3.id, 'post', { q2: '15_60', q11: 4, q12: 2 }),
      survey(h4.id, 'pre', {}),
    ])
    .execute();

  return { routeId, vehicleId, tripId: tripA.id, points, households };
}
