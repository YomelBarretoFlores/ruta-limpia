import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type {
  IndicatorQuery,
  IndicatorReadModel,
  IndicatorSources,
} from '../application/indicator-service.js';
import type { HouseholdWeek } from '../domain/adoption.js';

/** The pilot's time zone: dates, weeks and day bounds are local. */
const ZONE = 'America/Lima';
/** The length of one operating interval of I7. */
const INTERVAL_SEC = 60;
/** The oldest a valid position may be at an interval's end for the interval to be available. */
const FRESHNESS_SEC = 60;
/**
 * The longest the snapshot's queries may run: the read holds a connection of the shared pool (the
 * same one the live tracking uses) and an old snapshot, so a slow report is cut instead.
 */
const SNAPSHOT_TIMEOUT_MS = 15_000;

/**
 * Reads the indicator inputs of one route in one read-only snapshot (`REPEATABLE READ`), so the
 * nine indicators describe the same moment.
 */
export class KyselyIndicatorReadModel implements IndicatorReadModel {
  constructor(private readonly db: AppDatabase) {}

  sources(query: IndicatorQuery, now: Date): Promise<IndicatorSources | null> {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = ${sql.lit(SNAPSHOT_TIMEOUT_MS)}`.execute(trx);
        const route = await trx
          .selectFrom('routes')
          .select('id')
          .where('code', '=', query.routeCode)
          .executeTakeFirst();
        if (route === undefined) return null;
        const reader = new SnapshotReader(trx, route.id, query, now);
        const [etaErrors, observations, surveys, householdWeeks, availability] = await Promise.all([
          reader.etaErrors(),
          reader.observations(),
          reader.surveys(),
          reader.householdWeeks(),
          reader.availability(),
        ]);
        return { etaErrors, observations, surveys, householdWeeks, availability };
      });
  }
}

class SnapshotReader {
  constructor(
    private readonly db: AppDatabase,
    private readonly routeId: string,
    private readonly query: IndicatorQuery,
    private readonly now: Date,
  ) {}

  /** The first instant of `from` and the first instant after `to`, local days. */
  private get bounds() {
    return {
      lo: sql<Date>`(${this.query.from}::date::timestamp AT TIME ZONE ${ZONE})`,
      hi: sql<Date>`((${this.query.to}::date + 1)::timestamp AT TIME ZONE ${ZONE})`,
    };
  }

  /** I1: the Instrument 1 rows of the trips that ended, by service date. */
  async etaErrors() {
    const rows = await this.db
      .selectFrom('instrument1_route_log as log')
      .innerJoin('trips as t', 't.id', 'log.trip_id')
      .select(['log.point_code', 'log.abs_error_minutes'])
      .where('t.route_id', '=', this.routeId)
      .where('log.trip_status', '<>', 'active')
      .where('log.service_date', '>=', this.query.from)
      .where('log.service_date', '<=', this.query.to)
      .orderBy('log.point_sequence')
      .orderBy('log.actual_start')
      .execute();
    return rows.map((r) => ({ pointCode: r.point_code, absErrorMinutes: r.abs_error_minutes }));
  }

  /** I2, I3, I8: every Instrument 2 sheet of the route (the phases are stored). */
  async observations() {
    const rows = await this.db
      .selectFrom('field_observations as o')
      .innerJoin('reference_points as p', 'p.id', 'o.point_id')
      .select([
        'p.code',
        'p.observes_music',
        'o.phase',
        'o.exposure_minutes',
        'o.exposure_incomplete',
        'o.dispersion',
        'o.broken_bags',
        'o.waste_remaining_after_pass',
        'o.music_seconds',
        'o.comparable_window',
      ])
      .where('o.route_id', '=', this.routeId)
      .orderBy('p.sequence')
      .orderBy('o.observed_on')
      .execute();
    return rows.map((r) => ({
      pointCode: r.code,
      phase: r.phase,
      observesMusic: r.observes_music,
      exposureMinutes: r.exposure_minutes,
      exposureIncomplete: r.exposure_incomplete,
      dispersion: r.dispersion,
      brokenBags: r.broken_bags,
      wasteRemainingAfterPass: r.waste_remaining_after_pass,
      musicSeconds: r.music_seconds,
      comparableWindow: r.comparable_window,
    }));
  }

  /** I4, I6, I9: the Instrument 3 surveys of the route's households (both waves). */
  async surveys() {
    const rows = await this.db
      .selectFrom('household_surveys as s')
      .innerJoin('households as h', 'h.id', 's.household_id')
      .select([
        's.household_id',
        's.wave',
        's.q2_lead_time',
        's.q11_satisfaction',
        's.q12_annoyance',
        's.q12_not_heard',
      ])
      .where('h.route_id', '=', this.routeId)
      .orderBy('h.code')
      .orderBy('s.wave')
      .execute();
    return rows.map((r) => ({
      householdId: r.household_id,
      wave: r.wave,
      leadTime: r.q2_lead_time,
      satisfaction: r.q11_satisfaction,
      annoyance: r.q12_annoyance,
      notHeard: r.q12_not_heard,
    }));
  }

  /**
   * I5: each active household enrolled by the end of each week (Monday to Sunday, local, clipped
   * to the range), with its views and alerts of that week.
   */
  async householdWeeks(): Promise<HouseholdWeek[]> {
    const { from, to } = this.query;
    const result = await sql<{
      week_start: string;
      household_id: string;
      household_code: string;
      viewed: boolean;
      alert_sent: boolean;
      alert_confirmed: boolean;
    }>`
      WITH weeks AS (
        SELECT
          w::date AS week_start,
          (greatest(w::date, ${from}::date)::timestamp AT TIME ZONE ${ZONE}) AS lo,
          ((least(w::date + 6, ${to}::date) + 1)::timestamp AT TIME ZONE ${ZONE}) AS hi,
          least(w::date + 6, ${to}::date) AS last_day
        FROM generate_series(
          date_trunc('week', ${from}::date::timestamp), ${to}::date::timestamp, interval '1 week'
        ) AS w
      )
      SELECT
        to_char(w.week_start, 'YYYY-MM-DD') AS week_start,
        h.id AS household_id,
        h.code AS household_code,
        EXISTS (
          SELECT 1 FROM app_views v
          WHERE v.household_id = h.id AND v.viewed_at >= w.lo AND v.viewed_at < w.hi
        ) AS viewed,
        EXISTS (
          SELECT 1 FROM alert_deliveries d
          JOIN push_subscriptions s ON s.id = d.subscription_id
          WHERE s.household_id = h.id AND d.status = 'sent'
            AND d.sent_at >= w.lo AND d.sent_at < w.hi
        ) AS alert_sent,
        EXISTS (
          SELECT 1 FROM alert_deliveries d
          JOIN push_subscriptions s ON s.id = d.subscription_id
          WHERE s.household_id = h.id AND d.status = 'sent' AND d.received_at IS NOT NULL
            AND d.sent_at >= w.lo AND d.sent_at < w.hi
        ) AS alert_confirmed
      FROM weeks w
      JOIN households h
        ON h.route_id = ${this.routeId} AND h.active
        AND (h.enrolled_at AT TIME ZONE ${ZONE})::date <= w.last_day
      ORDER BY w.week_start, h.code`.execute(this.db);
    return result.rows.map((r) => ({
      weekStart: r.week_start,
      householdId: r.household_id,
      householdCode: r.household_code,
      viewed: r.viewed,
      alertSent: r.alert_sent,
      alertConfirmed: r.alert_confirmed,
    }));
  }

  /**
   * I7: the consecutive 60 s intervals of each trip of the route, from its start to its end (now
   * for a running trip), that lie inside the range; an interval is available when the vehicle's
   * latest valid position received by its end was at most 60 s old. The period bound of the route
   * (`MAX_INDICATOR_DAYS`) and the snapshot's statement timeout keep its cost bounded.
   */
  async availability() {
    const { lo, hi } = this.bounds;
    const result = await sql<{ intervals: string; available: string }>`
      WITH spans AS (
        SELECT t.vehicle_id, t.started_at, least(coalesce(t.ended_at, ${this.now}), ${hi}) AS ends_at
        FROM trips t
        WHERE t.route_id = ${this.routeId}
          AND t.started_at < ${hi} AND coalesce(t.ended_at, ${this.now}) > ${lo}
      ),
      intervals AS (
        SELECT s.vehicle_id, s.started_at + make_interval(secs => ${INTERVAL_SEC} * (k + 1)) AS ends_at
        FROM spans s,
          generate_series(
            0, floor(extract(epoch FROM s.ends_at - s.started_at) / ${INTERVAL_SEC})::integer - 1
          ) AS k
      )
      SELECT
        count(*) AS intervals,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM positions p
          WHERE p.vehicle_id = i.vehicle_id AND p.valid
            AND p.fix_time <= i.ends_at
            AND p.fix_time >= i.ends_at - make_interval(secs => ${FRESHNESS_SEC})
            AND p.received_at <= i.ends_at
        )) AS available
      FROM intervals i
      WHERE i.ends_at - make_interval(secs => ${INTERVAL_SEC}) >= ${lo}`.execute(this.db);
    const row = result.rows[0];
    return { intervals: Number(row?.intervals ?? 0), available: Number(row?.available ?? 0) };
  }
}
