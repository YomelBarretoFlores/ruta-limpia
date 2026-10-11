import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import type { AlertDecision } from '../../alerts/domain/alert-policy.js';
import { INITIAL_RECENT_SPEED, type RecentSpeed } from '../../eta/domain/recent-speed.js';
import type { AuditEvent } from '../../shared/application/audit-log.js';
import { KyselyAuditLog } from '../../shared/infrastructure/audit/kysely-audit-log.js';
import type {
  AppDatabase,
  Database,
  StoredRecentSpeed,
  TripsTable,
} from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  NewPosition,
  NewTrip,
  RecordedPass,
  StoredAlert,
  TrackingStore,
  TrackingTransaction,
  TripReader,
  TripRecord,
  Vehicle,
  VehicleDirectory,
} from '../application/ports.js';

/** PostgreSQL implementation of the tracking store. */
export class KyselyTrackingStore implements TrackingStore {
  constructor(private readonly db: AppDatabase) {}

  transaction<T>(work: (tx: TrackingTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(new KyselyTrackingTransaction(trx)));
  }
}

export type TripRow = Selectable<TripsTable>;

class KyselyTrackingTransaction implements TrackingTransaction {
  constructor(private readonly trx: Transaction<Database>) {}

  /**
   * Stores a position once. A replay is the same Traccar id or, since a position Traccar forwards
   * before storing it has no id (and its retry may have one), the same vehicle and fix time: both
   * are unique in the table, so concurrent replays through several API instances store one row.
   */
  async insertPosition(position: NewPosition): Promise<string | null> {
    const row = await this.trx
      .insertInto('positions')
      .values({
        vehicle_id: position.vehicleId,
        traccar_position_id: position.traccarPositionId,
        fix_time: position.fixTime,
        server_time: position.serverTime,
        received_at: position.receivedAt,
        location: sql`ST_SetSRID(ST_MakePoint(${position.lon}, ${position.lat}), 4326)::geography`,
        speed_kmh: position.speedKmh,
        course: position.course,
        valid: position.valid,
        accuracy: position.accuracy,
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async attachPositionToTrip(
    positionId: string,
    tripId: string,
    outcome: { readonly chainage: number | null; readonly offRoute: boolean },
  ): Promise<void> {
    await this.trx
      .updateTable('positions')
      .set({ trip_id: tripId, chainage_m: outcome.chainage, off_route: outcome.offRoute })
      .where('id', '=', positionId)
      .execute();
  }

  async lockActiveTrip(vehicleId: string): Promise<TripRecord | null> {
    // Locking the vehicle row first also serializes the auto-start of a trip, when there is no
    // trip row to lock yet.
    await this.trx
      .selectFrom('vehicles')
      .select('id')
      .where('id', '=', vehicleId)
      .forUpdate()
      .execute();
    const row = await this.trx
      .selectFrom('trips')
      .selectAll()
      .where('vehicle_id', '=', vehicleId)
      .where('status', '=', 'active')
      .forUpdate()
      .executeTakeFirst();
    return row === undefined ? null : this.toRecord(row);
  }

  async lockTrip(tripId: string): Promise<TripRecord | null> {
    if (!isUuid(tripId)) return null;
    const row = await this.trx
      .selectFrom('trips')
      .selectAll()
      .where('id', '=', tripId)
      .forUpdate()
      .executeTakeFirst();
    return row === undefined ? null : this.toRecord(row);
  }

  async lockTripsWithoutFixesSince(cutoff: Date): Promise<TripRecord[]> {
    const rows = await this.trx
      .selectFrom('trips')
      .selectAll()
      .where('status', '=', 'active')
      .where(sql<Date>`coalesce(last_fix_at, started_at)`, '<', cutoff)
      .forUpdate()
      .skipLocked()
      .execute();
    return Promise.all(rows.map((row) => this.toRecord(row)));
  }

  async createTrip(trip: NewTrip): Promise<TripRecord> {
    const row = await this.trx
      .insertInto('trips')
      .values({
        route_id: trip.routeId,
        vehicle_id: trip.vehicleId,
        status: 'active',
        start_mode: trip.startMode,
        started_at: trip.startedAt,
        recent_speed: JSON.stringify(serializeRecentSpeed(INITIAL_RECENT_SPEED)),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toRecord(row);
  }

  async saveTrip(trip: TripRecord): Promise<void> {
    const { state } = trip;
    await this.trx
      .updateTable('trips')
      .set({
        status: state.status,
        ended_at: state.endedAt,
        end_reason: trip.endReason,
        ...(trip.endNote === undefined ? {} : { end_note: trip.endNote }),
        progress_chainage_m: state.progressChainage,
        progress_at: state.progressAt,
        last_fix_at: state.lastFixAt,
        off_route: state.offRoute,
        recent_speed: JSON.stringify(serializeRecentSpeed(trip.recentSpeed)),
      })
      .where('id', '=', state.tripId)
      .execute();
  }

  async recordPasses(tripId: string, passes: readonly RecordedPass[]): Promise<void> {
    if (passes.length === 0) return;
    await this.trx
      .insertInto('trip_point_passes')
      .values(
        passes.map((pass) => ({
          trip_id: tripId,
          point_id: pass.pointId,
          passed_at: pass.passedAt,
          precision: pass.precision,
        })),
      )
      .onConflict((oc) => oc.columns(['trip_id', 'point_id']).doNothing())
      .execute();
  }

  async alertedPointIds(tripId: string): Promise<string[]> {
    const rows = await this.trx
      .selectFrom('alerts')
      .select('point_id')
      .where('trip_id', '=', tripId)
      .execute();
    return rows.map((row) => row.point_id);
  }

  async recordAlerts(decisions: readonly AlertDecision[]): Promise<StoredAlert[]> {
    if (decisions.length === 0) return [];
    const rows = await this.trx
      .insertInto('alerts')
      .values(
        decisions.map((d) => ({
          trip_id: d.tripId,
          point_id: d.pointId,
          emitted_at: d.emittedAt,
          communicated_predicted_pass_at: d.communicatedPredictedPassAt,
          seconds_remaining_at_emission: d.secondsRemainingAtEmission,
          inside_target_window: d.insideTargetWindow,
        })),
      )
      .onConflict((oc) => oc.columns(['trip_id', 'point_id']).doNothing())
      .returning(['id', 'point_id'])
      .execute();
    const idByPoint = new Map(rows.map((row) => [row.point_id, row.id]));
    return decisions.flatMap((d) => {
      const alertId = idByPoint.get(d.pointId);
      return alertId === undefined ? [] : [{ ...d, alertId }];
    });
  }

  recordAudit(event: AuditEvent): Promise<void> {
    return new KyselyAuditLog(this.trx).record(event);
  }

  private toRecord(row: TripRow): Promise<TripRecord> {
    return loadTripRecord(this.trx, row);
  }
}

/** Builds the trip record of a `trips` row (its passed points are read in pass order). */
export async function loadTripRecord(db: Kysely<Database>, row: TripRow): Promise<TripRecord> {
  const passes = await db
    .selectFrom('trip_point_passes')
    .select('point_id')
    .where('trip_id', '=', row.id)
    .orderBy('passed_at')
    .execute();
  return {
    state: {
      tripId: row.id,
      status: row.status,
      progressChainage: row.progress_chainage_m,
      progressAt: row.progress_at,
      lastFixAt: row.last_fix_at,
      offRoute: row.off_route,
      passedPointIds: passes.map((p) => p.point_id),
      endedAt: row.ended_at,
    },
    routeId: row.route_id,
    vehicleId: row.vehicle_id,
    startMode: row.start_mode,
    startedAt: row.started_at,
    endReason: row.end_reason,
    recentSpeed: deserializeRecentSpeed(row.recent_speed),
  };
}

function serializeRecentSpeed(speed: RecentSpeed): StoredRecentSpeed {
  return {
    speedMps: speed.speedMps,
    averageMps: speed.averageMps,
    lastSample:
      speed.lastSample === null
        ? null
        : { chainage: speed.lastSample.chainage, at: speed.lastSample.at.toISOString() },
  };
}

function deserializeRecentSpeed(stored: StoredRecentSpeed | null): RecentSpeed {
  if (stored === null) return INITIAL_RECENT_SPEED;
  return {
    speedMps: stored.speedMps,
    averageMps: stored.averageMps,
    lastSample:
      stored.lastSample === null
        ? null
        : { chainage: stored.lastSample.chainage, at: new Date(stored.lastSample.at) },
  };
}

/** Unlocked trip reads for the live views and the ETA refresh. */
export class KyselyTripReader implements TripReader {
  constructor(private readonly db: AppDatabase) {}

  async activeTrips(): Promise<TripRecord[]> {
    const rows = await this.db
      .selectFrom('trips')
      .selectAll()
      .where('status', '=', 'active')
      .orderBy('started_at')
      .execute();
    return Promise.all(rows.map((row) => loadTripRecord(this.db, row)));
  }

  async activeTripOf(vehicleId: string): Promise<TripRecord | null> {
    if (!isUuid(vehicleId)) return null;
    const row = await this.db
      .selectFrom('trips')
      .selectAll()
      .where('vehicle_id', '=', vehicleId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return row === undefined ? null : loadTripRecord(this.db, row);
  }
}

/** Vehicle registry backed by the `vehicles` table. */
export class KyselyVehicleDirectory implements VehicleDirectory {
  constructor(private readonly db: AppDatabase) {}

  async findByTraccarUniqueId(uniqueId: string): Promise<Vehicle | null> {
    const row = await this.query().where('traccar_unique_id', '=', uniqueId).executeTakeFirst();
    return row === undefined ? null : toVehicle(row);
  }

  async findById(vehicleId: string): Promise<Vehicle | null> {
    if (!isUuid(vehicleId)) return null;
    const row = await this.query().where('id', '=', vehicleId).executeTakeFirst();
    return row === undefined ? null : toVehicle(row);
  }

  private query() {
    return this.db
      .selectFrom('vehicles')
      .select(['id', 'code', 'label', 'traccar_unique_id', 'default_route_id', 'active']);
  }
}

function toVehicle(row: {
  id: string;
  code: string;
  label: string;
  traccar_unique_id: string;
  default_route_id: string | null;
  active: boolean;
}): Vehicle {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    traccarUniqueId: row.traccar_unique_id,
    defaultRouteId: row.default_route_id,
    active: row.active,
  };
}
