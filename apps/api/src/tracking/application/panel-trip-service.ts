import type { PanelActor } from '../../auth/application/panel-actor.js';
import { telemetrySignal, type TelemetrySignal } from '../../eta/domain/staleness.js';
import type { AuditEvent } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import { summarizeTrack, type TrackSummary } from '../domain/track-summary.js';
import type { TripEndReason, TripRecord } from './ports.js';
import { TripLifecycleError, type TripAudit } from './trip-lifecycle-service.js';
import type {
  TripDetailRows,
  TripFilter,
  TripHistoryQueries,
  TripSummaryRow,
  VehicleRow,
} from './trip-history.js';

/**
 * The trip lifecycle use cases the panel drives. The audit event is written in the trip's own
 * transaction, so a manual start or end and its audit event commit or roll back together.
 */
export interface TripLifecycle {
  startTrip(
    input: { vehicleId: string; routeId: string; mode: 'manual' },
    options: { readonly audit: TripAudit },
  ): Promise<TripRecord>;
  endTrip(
    tripId: string,
    options: { readonly reason: TripEndReason; readonly note: string; readonly audit: TripAudit },
  ): Promise<TripRecord>;
}

export interface PanelTripDependencies {
  readonly queries: TripHistoryQueries;
  readonly lifecycle: TripLifecycle;
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
      record = await lifecycle.startTrip(
        { vehicleId, routeId, mode: 'manual' },
        {
          audit: (trip) =>
            this.auditEvent('trip.started', actor, trip, {
              vehicleCode: input.vehicleCode,
              routeCode: input.routeCode,
            }),
        },
      );
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
    return { status: 'started', trip: await this.summaryOf(record.state.tripId) };
  }

  /**
   * Ends an active trip by hand. It is stored as aborted with the end reason `manual`; `note` is
   * the operator's free text (why it was ended), stored as the trip's `endNote`.
   */
  async end(tripId: string, note: string, actor: PanelActor): Promise<EndTripResult> {
    try {
      await this.deps.lifecycle.endTrip(tripId, {
        reason: 'manual',
        note,
        audit: (trip) => this.auditEvent('trip.ended', actor, trip, { note }),
      });
    } catch (error) {
      const code = error instanceof TripLifecycleError ? error.code : null;
      if (code === 'trip_not_found' || code === 'trip_not_active') return { status: code };
      throw error;
    }
    return { status: 'ended', trip: await this.summaryOf(tripId) };
  }

  private async summaryOf(tripId: string): Promise<TripSummaryRow> {
    const trip = await this.deps.queries.summary(tripId);
    if (trip === null) throw new Error(`Trip ${tripId} vanished`);
    return trip;
  }

  private auditEvent(
    action: string,
    actor: PanelActor,
    trip: TripRecord,
    details: Record<string, unknown>,
  ): AuditEvent {
    return {
      userId: actor.userId,
      action,
      entity: 'trip',
      entityId: trip.state.tripId,
      at: this.deps.clock.now(),
      details,
    };
  }
}
