import type { PanelActor } from '../../auth/application/panel-actor.js';
import { telemetrySignal, type TelemetrySignal } from '../../eta/domain/staleness.js';
import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import { summarizeTrack, type TrackSummary } from '../domain/track-summary.js';
import type { TripRecord } from './ports.js';
import { TripLifecycleError } from './trip-lifecycle-service.js';
import type {
  TripDetailRows,
  TripFilter,
  TripHistoryQueries,
  TripSummaryRow,
  VehicleRow,
} from './trip-history.js';

/** The trip lifecycle use cases the panel drives. */
export interface TripLifecycle {
  startTrip(input: { vehicleId: string; routeId: string; mode: 'manual' }): Promise<TripRecord>;
  endTrip(tripId: string, reason?: string, note?: string): Promise<TripRecord>;
}

export interface PanelTripDependencies {
  readonly queries: TripHistoryQueries;
  readonly lifecycle: TripLifecycle;
  readonly audit: AuditLog;
  readonly clock: Clock;
  /** Telemetry older than this is stale. */
  readonly maxFixAgeSec: number;
}

export interface VehicleView extends VehicleRow {
  readonly signal: TelemetrySignal;
}

export interface TripDetail extends Omit<TripDetailRows, 'positions'> {
  readonly summary: TrackSummary & { readonly durationSec: number };
  /** The valid fixes as a GeoJSON LineString (`[lon, lat]`, in fix order). */
  readonly track: { readonly type: 'LineString'; readonly coordinates: [number, number][] };
}

export type StartTripResult =
  | { readonly status: 'started'; readonly trip: TripSummaryRow }
  | { readonly status: 'vehicle_not_found' | 'route_not_found' | 'trip_already_active' };

export type EndTripResult =
  | { readonly status: 'ended'; readonly trip: TripSummaryRow }
  | { readonly status: 'trip_not_found' | 'trip_not_active' };

/** The panel's fleet view, trip history and manual trip control (audited). */
export class PanelTripService {
  constructor(private readonly deps: PanelTripDependencies) {}

  async vehicles(): Promise<VehicleView[]> {
    const now = this.deps.clock.now();
    const rows = await this.deps.queries.vehicles();
    return rows.map((row) => ({
      ...row,
      signal: telemetrySignal(row.lastFix?.at ?? null, now, this.deps.maxFixAgeSec),
    }));
  }

  list(filter: TripFilter, window: { limit: number; offset: number }) {
    return this.deps.queries.list(filter, window);
  }

  async detail(tripId: string): Promise<TripDetail | null> {
    const rows = await this.deps.queries.detail(tripId);
    if (rows === null) return null;
    const { positions, ...rest } = rows;
    const end = rows.trip.endedAt ?? this.deps.clock.now();
    const ordered = [...positions].sort((a, b) => a.fixTime.getTime() - b.fixTime.getTime());
    return {
      ...rest,
      summary: {
        ...summarizeTrack(positions),
        durationSec: Math.max(
          0,
          Math.round((end.getTime() - rows.trip.startedAt.getTime()) / 1000),
        ),
      },
      track: {
        type: 'LineString',
        coordinates: ordered.filter((p) => p.valid).map((p) => [p.lon, p.lat]),
      },
    };
  }

  async start(
    input: { readonly vehicleCode: string; readonly routeCode: string },
    actor: PanelActor,
  ): Promise<StartTripResult> {
    const { queries, lifecycle } = this.deps;
    const vehicleId = await queries.findVehicleIdByCode(input.vehicleCode);
    if (vehicleId === null) return { status: 'vehicle_not_found' };
    const routeId = await queries.findRouteIdByCode(input.routeCode);
    if (routeId === null) return { status: 'route_not_found' };

    let record: TripRecord;
    try {
      record = await lifecycle.startTrip({ vehicleId, routeId, mode: 'manual' });
    } catch (error) {
      const code = error instanceof TripLifecycleError ? error.code : null;
      if (
        code === 'trip_already_active' ||
        code === 'route_not_found' ||
        code === 'vehicle_not_found'
      ) {
        return { status: code };
      }
      throw error;
    }
    const tripId = record.state.tripId;
    await this.record('trip.started', actor, tripId, {
      vehicleCode: input.vehicleCode,
      routeCode: input.routeCode,
    });
    return { status: 'started', trip: await this.summaryOf(tripId) };
  }

  async end(tripId: string, reason: string, actor: PanelActor): Promise<EndTripResult> {
    try {
      await this.deps.lifecycle.endTrip(tripId, 'manual', reason);
    } catch (error) {
      const code = error instanceof TripLifecycleError ? error.code : null;
      if (code === 'trip_not_found' || code === 'trip_not_active') return { status: code };
      throw error;
    }
    await this.record('trip.ended', actor, tripId, { reason });
    return { status: 'ended', trip: await this.summaryOf(tripId) };
  }

  private async summaryOf(tripId: string): Promise<TripSummaryRow> {
    const trip = await this.deps.queries.summary(tripId);
    if (trip === null) throw new Error(`Trip ${tripId} vanished`);
    return trip;
  }

  private async record(
    action: string,
    actor: PanelActor,
    tripId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({
      userId: actor.userId,
      action,
      entity: 'trip',
      entityId: tripId,
      at: this.deps.clock.now(),
      details,
    });
  }
}
