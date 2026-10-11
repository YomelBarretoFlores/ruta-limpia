import type { AlertDecision } from '../../src/alerts/domain/alert-policy.js';
import { INITIAL_RECENT_SPEED } from '../../src/eta/domain/recent-speed.js';
import { startTrip } from '../../src/tracking/domain/trip.js';
import type {
  NewPosition,
  NewTrip,
  RecordedPass,
  StoredAlert,
  TrackingStore,
  TrackingTransaction,
  TripRecord,
  Vehicle,
  VehicleDirectory,
} from '../../src/tracking/application/ports.js';

export interface StoredPosition extends NewPosition {
  readonly id: string;
  tripId: string | null;
  chainage: number | null;
  offRoute: boolean | null;
}

interface Data {
  positions: StoredPosition[];
  trips: TripRecord[];
  passes: (RecordedPass & { tripId: string })[];
  alerts: StoredAlert[];
  nextId: number;
}

/**
 * In-memory TrackingStore for application tests. Transactions roll back on error, and the database
 * integrity rules are enforced: unique Traccar ids, one active trip per vehicle, one alert and one
 * pass per (trip, point).
 */
export class InMemoryTrackingStore implements TrackingStore {
  data: Data = { positions: [], trips: [], passes: [], alerts: [], nextId: 1 };

  async transaction<T>(work: (tx: TrackingTransaction) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.data);
    try {
      return await work(new InMemoryTransaction(this.data));
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  get trips(): readonly TripRecord[] {
    return this.data.trips;
  }

  get positions(): readonly StoredPosition[] {
    return this.data.positions;
  }

  get alerts(): readonly StoredAlert[] {
    return this.data.alerts;
  }

  passesOf(tripId: string): RecordedPass[] {
    return this.data.passes.filter((p) => p.tripId === tripId);
  }
}

class InMemoryTransaction implements TrackingTransaction {
  constructor(private readonly data: Data) {}

  insertPosition(position: NewPosition): Promise<string | null> {
    if (this.data.positions.some((p) => p.traccarPositionId === position.traccarPositionId)) {
      return Promise.resolve(null);
    }
    const id = String(this.data.nextId++);
    this.data.positions.push({ ...position, id, tripId: null, chainage: null, offRoute: null });
    return Promise.resolve(id);
  }

  attachPositionToTrip(
    positionId: string,
    tripId: string,
    outcome: { chainage: number | null; offRoute: boolean },
  ): Promise<void> {
    const position = this.data.positions.find((p) => p.id === positionId);
    if (position === undefined) throw new Error(`Position ${positionId} not found`);
    Object.assign(position, { tripId, ...outcome });
    return Promise.resolve();
  }

  lockActiveTrip(vehicleId: string): Promise<TripRecord | null> {
    const trip = this.data.trips.find(
      (t) => t.vehicleId === vehicleId && t.state.status === 'active',
    );
    return Promise.resolve(trip ?? null);
  }

  lockTrip(tripId: string): Promise<TripRecord | null> {
    return Promise.resolve(this.data.trips.find((t) => t.state.tripId === tripId) ?? null);
  }

  lockTripsWithoutFixesSince(cutoff: Date): Promise<TripRecord[]> {
    return Promise.resolve(
      this.data.trips.filter(
        (t) =>
          t.state.status === 'active' &&
          (t.state.lastFixAt ?? t.startedAt).getTime() < cutoff.getTime(),
      ),
    );
  }

  createTrip(trip: NewTrip): Promise<TripRecord> {
    if (
      this.data.trips.some((t) => t.vehicleId === trip.vehicleId && t.state.status === 'active')
    ) {
      throw new Error('unique violation: trips_one_active_per_vehicle');
    }
    const record: TripRecord = {
      ...trip,
      state: startTrip(`trip-${this.data.nextId++}`),
      endReason: null,
      recentSpeed: INITIAL_RECENT_SPEED,
    };
    this.data.trips.push(record);
    return Promise.resolve(record);
  }

  saveTrip(trip: TripRecord): Promise<void> {
    const index = this.data.trips.findIndex((t) => t.state.tripId === trip.state.tripId);
    if (index < 0) throw new Error(`Trip ${trip.state.tripId} not found`);
    this.data.trips[index] = trip;
    return Promise.resolve();
  }

  recordPasses(tripId: string, passes: readonly RecordedPass[]): Promise<void> {
    for (const pass of passes) {
      const exists = this.data.passes.some(
        (p) => p.tripId === tripId && p.pointId === pass.pointId,
      );
      if (!exists) this.data.passes.push({ ...pass, tripId });
    }
    return Promise.resolve();
  }

  alertedPointIds(tripId: string): Promise<string[]> {
    return Promise.resolve(
      this.data.alerts.filter((a) => a.tripId === tripId).map((a) => a.pointId),
    );
  }

  recordAlerts(decisions: readonly AlertDecision[]): Promise<StoredAlert[]> {
    const inserted: StoredAlert[] = [];
    for (const decision of decisions) {
      const exists = this.data.alerts.some(
        (a) => a.tripId === decision.tripId && a.pointId === decision.pointId,
      );
      if (exists) continue;
      const alert = { ...decision, alertId: `alert-${this.data.nextId++}` };
      this.data.alerts.push(alert);
      inserted.push(alert);
    }
    return Promise.resolve(inserted);
  }
}

export class InMemoryVehicleDirectory implements VehicleDirectory {
  constructor(private readonly vehicles: readonly Vehicle[]) {}

  findByTraccarUniqueId(uniqueId: string): Promise<Vehicle | null> {
    return Promise.resolve(this.vehicles.find((v) => v.traccarUniqueId === uniqueId) ?? null);
  }

  findById(vehicleId: string): Promise<Vehicle | null> {
    return Promise.resolve(this.vehicles.find((v) => v.id === vehicleId) ?? null);
  }
}

/** A clock the test moves by hand. */
export class ManualClock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(at: Date): void {
    this.current = at;
  }
}
