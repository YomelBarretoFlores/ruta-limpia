import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type { CsvTable, ExportFilter, InstrumentExports } from '../application/export-ports.js';

const ZONE = 'America/Lima';

export const INSTRUMENT1_COLUMNS = [
  'source',
  'record_id',
  'service_date',
  'route_code',
  'vehicle',
  'planned_start',
  'actual_start',
  'point_sequence',
  'point_code',
  'actual_passed_at',
  'alert_emitted_at',
  'communicated_eta',
  'abs_error_minutes',
  'point_incidents_count',
  'notes',
] as const;

export const INSTRUMENT2_COLUMNS = [
  'record_id',
  'observed_on',
  'route_code',
  'point_code',
  'phase',
  'observers',
  'trip_id',
  'first_placement_time',
  'truck_pass_time',
  'exposure_minutes',
  'exposure_computed',
  'exposure_incomplete',
  'bags_at_pass',
  'broken_bags',
  'dispersion',
  'dispersion_causes',
  'dispersion_cause_other',
  'waste_remaining_after_pass',
  'photo_before_taken',
  'photo_before_code',
  'photo_after_taken',
  'photo_after_code',
  'music_window_start',
  'music_window_end',
  'music_seconds',
  'music_conditions',
  'comparable_window',
  'notes',
] as const;

/** A timestamp as America/Lima `HH:MM`. */
const localTime = (column: string) =>
  sql<string | null>`to_char(${sql.ref(column)} AT TIME ZONE ${ZONE}, 'HH24:MI')`;
/** A time of day as `HH:MM`. */
const timeOfDay = (column: string) => sql<string | null>`to_char(${sql.ref(column)}, 'HH24:MI')`;
const yesNo = (value: boolean | null) => (value === null ? null : value ? 'yes' : 'no');

/** The instrument exports read from PostgreSQL. */
export class KyselyInstrumentExports implements InstrumentExports {
  constructor(private readonly db: AppDatabase) {}

  async instrument1(filter: ExportFilter): Promise<CsvTable> {
    let query = this.db
      .selectFrom('instrument1_export as e')
      .select([
        'e.source',
        'e.record_id',
        'e.service_date',
        'e.route_code',
        'e.vehicle',
        sql<string | null>`substring(e.planned_start from 1 for 5)`.as('planned_start'),
        localTime('e.actual_start').as('actual_start'),
        'e.point_sequence',
        'e.point_code',
        localTime('e.actual_passed_at').as('actual_passed_at'),
        localTime('e.alert_emitted_at').as('alert_emitted_at'),
        localTime('e.communicated_eta').as('communicated_eta'),
        sql<number | null>`round(e.abs_error_minutes::numeric, 2)::double precision`.as(
          'abs_error_minutes',
        ),
        'e.point_incidents_count',
        'e.notes',
      ]);
    if (filter.routeCode !== undefined) query = query.where('e.route_code', '=', filter.routeCode);
    if (filter.from !== undefined) query = query.where('e.service_date', '>=', filter.from);
    if (filter.to !== undefined) query = query.where('e.service_date', '<=', filter.to);
    const rows = await query
      .orderBy('e.service_date')
      .orderBy('e.route_code')
      .orderBy('e.actual_start')
      .orderBy('e.record_id')
      .orderBy('e.point_sequence')
      .execute();
    return {
      header: INSTRUMENT1_COLUMNS,
      rows: rows.map((r) => [
        r.source,
        r.record_id,
        r.service_date,
        r.route_code,
        r.vehicle,
        r.planned_start,
        r.actual_start,
        r.point_sequence,
        r.point_code,
        r.actual_passed_at,
        r.alert_emitted_at,
        r.communicated_eta,
        r.abs_error_minutes,
        r.point_incidents_count,
        r.notes,
      ]),
    };
  }

  async instrument2(filter: ExportFilter): Promise<CsvTable> {
    let query = this.db
      .selectFrom('field_observations as o')
      .innerJoin('routes as r', 'r.id', 'o.route_id')
      .innerJoin('reference_points as p', 'p.id', 'o.point_id')
      .select([
        'o.id',
        sql<string>`to_char(o.observed_on, 'YYYY-MM-DD')`.as('observed_on'),
        'r.code as route_code',
        'p.code as point_code',
        'o.phase',
        'o.observers',
        'o.trip_id',
        timeOfDay('o.first_placement_time').as('first_placement_time'),
        timeOfDay('o.truck_pass_time').as('truck_pass_time'),
        'o.exposure_minutes',
        'o.exposure_computed',
        'o.exposure_incomplete',
        'o.bags_at_pass',
        'o.broken_bags',
        'o.dispersion',
        'o.dispersion_causes',
        'o.dispersion_cause_other',
        'o.waste_remaining_after_pass',
        'o.photo_before_taken',
        'o.photo_before_code',
        'o.photo_after_taken',
        'o.photo_after_code',
        timeOfDay('o.music_window_start').as('music_window_start'),
        timeOfDay('o.music_window_end').as('music_window_end'),
        'o.music_seconds',
        'o.music_conditions',
        'o.comparable_window',
        'o.notes',
      ]);
    if (filter.routeCode !== undefined) query = query.where('r.code', '=', filter.routeCode);
    if (filter.from !== undefined) query = query.where('o.observed_on', '>=', filter.from);
    if (filter.to !== undefined) query = query.where('o.observed_on', '<=', filter.to);
    const rows = await query
      .orderBy('o.observed_on')
      .orderBy('r.code')
      .orderBy('p.sequence')
      .orderBy('o.created_at')
      .execute();
    return {
      header: INSTRUMENT2_COLUMNS,
      rows: rows.map((r) => [
        r.id,
        r.observed_on,
        r.route_code,
        r.point_code,
        r.phase,
        r.observers,
        r.trip_id,
        r.first_placement_time,
        r.truck_pass_time,
        r.exposure_minutes,
        yesNo(r.exposure_computed),
        yesNo(r.exposure_incomplete),
        r.bags_at_pass,
        r.broken_bags,
        r.dispersion,
        r.dispersion_causes.join('|'),
        r.dispersion_cause_other,
        yesNo(r.waste_remaining_after_pass),
        yesNo(r.photo_before_taken),
        r.photo_before_code,
        yesNo(r.photo_after_taken),
        r.photo_after_code,
        r.music_window_start,
        r.music_window_end,
        r.music_seconds,
        r.music_conditions,
        yesNo(r.comparable_window),
        r.notes,
      ]),
    };
  }
}
