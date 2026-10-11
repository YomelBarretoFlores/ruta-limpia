import type { AlertDecision } from '../../alerts/domain/alert-policy.js';
import type { RecentSpeed } from '../../eta/domain/recent-speed.js';
import type { AuditEvent } from '../../shared/application/audit-log.js';
import type { TripState } from '../domain/trip.js';

export interface Vehicle {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly traccarUniqueId: string;
  /** Route a trip auto-starts on when the vehicle shows up at its start; null disables auto-start. */
  readonly defaultRouteId: string | null;
  readonly active: boolean;
}

/** Port: read access to the vehicle registry. */
export interface VehicleDirectory {
  findByTraccarUniqueId(uniqueId: string): Promise<Vehicle | null>;
  findById(vehicleId: string): Promise<Vehicle | null>;
}

/** A raw position as received from Traccar, normalized (speed in km/h). */
export interface NewPosition {
  readonly vehicleId: string;
  readonly traccarPositionId: number;
  readonly fixTime: Date;
  readonly serverTime: Date | null;
  readonly receivedAt: Date;
  readonly lat: number;
  readonly lon: number;
  readonly speedKmh: number;
  readonly course: number | null;
  readonly valid: boolean;
  readonly accuracy: number | null;
}

export type TripStartMode = 'auto' | 'manual';

/** Why a trip ended: the route end was reached, no telemetry arrived, or an operator closed it. */
export type TripEndReason = 'route_completed' | 'inactivity' | 'manual' | (string & {});

/** A persisted trip: the domain state plus what the application tracks around it. */
export interface TripRecord {
  readonly state: TripState;
  readonly routeId: string;
  readonly vehicleId: string;
  readonly startMode: TripStartMode;
  readonly startedAt: Date;
  readonly endReason: TripEndReason | null;
  /** The operator's note on a manual end; undefined leaves the stored note unchanged. */
  readonly endNote?: string | null;
  readonly recentSpeed: RecentSpeed;
}

export interface NewTrip {
  readonly routeId: string;
  readonly vehicleId: string;
  readonly startMode: TripStartMode;
  readonly startedAt: Date;
}

export interface RecordedPass {
  readonly pointId: string;
  readonly passedAt: Date;
  readonly precision: 'interpolated' | 'upper_bound';
}

export interface StoredAlert extends AlertDecision {
  readonly alertId: string;
}

/** Tracking writes inside one database transaction. */
export interface TrackingTransaction {
  /** Stores a position; returns its id, or null when this Traccar position was already stored. */
  insertPosition(position: NewPosition): Promise<string | null>;
  /** Links a stored position to its trip with the tracking outcome of that fix. */
  attachPositionToTrip(
    positionId: string,
    tripId: string,
    outcome: { readonly chainage: number | null; readonly offRoute: boolean },
  ): Promise<void>;
  /**
   * Locks (SELECT … FOR UPDATE) the vehicle and its active trip, if any. Concurrent processing of the
   * same vehicle, in this or another process, waits until this transaction ends.
   */
  lockActiveTrip(vehicleId: string): Promise<TripRecord | null>;
  /** Locks one trip by id, whatever its status. */
  lockTrip(tripId: string): Promise<TripRecord | null>;
  /** Locks the active trips whose last fix (or start, without fixes) is older than `cutoff`. */
  lockTripsWithoutFixesSince(cutoff: Date): Promise<TripRecord[]>;
  /** Inserts an active trip; the database rejects a second active trip for the same vehicle. */
  createTrip(trip: NewTrip): Promise<TripRecord>;
  /** Persists the trip state (status, progress, flags, end, recent speed). */
  saveTrip(trip: TripRecord): Promise<void>;
  /** Records point passes; an already-recorded (trip, point) pass is kept. */
  recordPasses(tripId: string, passes: readonly RecordedPass[]): Promise<void>;
  alertedPointIds(tripId: string): Promise<string[]>;
  /**
   * Records alerts, at most one per (trip, point) — the database is the final guard — and returns
   * only those inserted now.
   */
  recordAlerts(decisions: readonly AlertDecision[]): Promise<StoredAlert[]>;
  /** Appends an audit event in this transaction, so it commits or rolls back with the change. */
  recordAudit(event: AuditEvent): Promise<void>;
}

/** Port: reads trips outside a tracking transaction, without locks (live views, ETA refresh). */
export interface TripReader {
  activeTrips(): Promise<TripRecord[]>;
  activeTripOf(vehicleId: string): Promise<TripRecord | null>;
}

/** Port: runs tracking work atomically. */
export interface TrackingStore {
  transaction<T>(work: (tx: TrackingTransaction) => Promise<T>): Promise<T>;
}
