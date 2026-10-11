import type { AlertNotifier } from '../../alerts/application/alert-notifier.js';
import { decideAlerts } from '../../alerts/domain/alert-policy.js';
import type { SpeedProfileProvider } from '../../eta/application/speed-profile-provider.js';
import { estimateEtas } from '../../eta/domain/eta-estimator.js';
import type { SpeedProfile } from '../../eta/domain/speed-profile.js';
import { observeProgress } from '../../eta/domain/recent-speed.js';
import type { RouteCatalog, RouteSnapshot } from '../../routes/application/route-catalog.js';
import { projectOntoRoute } from '../../routes/domain/route-geometry.js';
import type { Clock } from '../../shared/application/clock.js';
import type { EventBus } from '../../shared/application/event-bus.js';
import type { KeyedMutex } from '../../shared/application/keyed-mutex.js';
import type { Logger } from '../../shared/application/logger.js';
import type { PositionFix } from '../domain/position-fix.js';
import { advanceTrip } from '../domain/trip-progress.js';
import { publishAll } from './publish.js';
import type {
  NewPosition,
  StoredAlert,
  TrackingStore,
  TrackingTransaction,
  TripRecord,
  Vehicle,
  VehicleDirectory,
} from './ports.js';
import type { PendingEvent, TrackingEvents } from './tracking-events.js';
import type { TrackingPipelineSettings } from './tracking-pipeline-settings.js';

/** One position forwarded by Traccar, already validated and normalized (speed in km/h). */
export interface IngestPositionCommand {
  readonly traccarPositionId: number;
  readonly deviceUniqueId: string;
  readonly fixTime: Date;
  readonly serverTime: Date | null;
  readonly lat: number;
  readonly lon: number;
  readonly speedKmh: number;
  readonly course: number | null;
  readonly valid: boolean;
  readonly accuracy: number | null;
}

export type IngestResult =
  | { readonly status: 'processed'; readonly positionId: string; readonly tripId: string | null }
  | { readonly status: 'duplicate' }
  | { readonly status: 'unknown_device' };

export interface IngestPositionDependencies {
  readonly vehicles: VehicleDirectory;
  readonly store: TrackingStore;
  readonly routes: RouteCatalog;
  readonly profiles: SpeedProfileProvider;
  readonly notifier: AlertNotifier;
  readonly events: EventBus<TrackingEvents>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Shared with the other tracking services so a vehicle is processed by one at a time. */
  readonly mutex: KeyedMutex;
  readonly settings: TrackingPipelineSettings;
}

interface Outcome {
  readonly result: IngestResult;
  readonly events: readonly PendingEvent[];
  readonly alerts: readonly (StoredAlert & { readonly routeId: string })[];
  readonly completedRouteId: string | null;
}

/**
 * The tracking pipeline for one forwarded position:
 * store it → find or auto-start the vehicle's trip → advance the trip (passes, completion) →
 * update the recent speed → estimate ETAs → decide and record alerts.
 *
 * Alerts wait for a speed basis (a measured recent speed or a historical profile); an ETA built on
 * the default speed alone is published but never alerted on.
 *
 * Processing is serialized per vehicle twice: an in-process keyed mutex, and row locks inside one
 * database transaction (which also covers several API processes). Events and alert notifications
 * go out only after the transaction commits; notifications run in the background
 * (`whenNotificationsSettled` waits for them, for example on shutdown).
 */
export class IngestPositionService {
  /** Alert notifications still running in the background. */
  private readonly notifications = new Set<Promise<void>>();

  constructor(private readonly deps: IngestPositionDependencies) {}

  /** Resolves when every background alert notification started so far has finished. */
  async whenNotificationsSettled(): Promise<void> {
    while (this.notifications.size > 0) await Promise.all(this.notifications);
  }

  async ingest(command: IngestPositionCommand): Promise<IngestResult> {
    const vehicle = await this.deps.vehicles.findByTraccarUniqueId(command.deviceUniqueId);
    if (vehicle === null || !vehicle.active) {
      this.deps.logger.warn(
        { deviceUniqueId: command.deviceUniqueId, traccarPositionId: command.traccarPositionId },
        'Position from an unknown or inactive device ignored',
      );
      return { status: 'unknown_device' };
    }

    const outcome = await this.deps.mutex.runExclusive(vehicle.id, () =>
      this.deps.store.transaction((tx) => this.process(tx, vehicle, command)),
    );

    if (outcome.completedRouteId !== null) this.deps.profiles.invalidate(outcome.completedRouteId);
    publishAll(this.deps.events, outcome.events);
    // Delivery runs in the background: pushing to households never delays or fails the ingest.
    if (outcome.alerts.length > 0) this.notifyInBackground(outcome.alerts);
    return outcome.result;
  }

  private async process(
    tx: TrackingTransaction,
    vehicle: Vehicle,
    command: IngestPositionCommand,
  ): Promise<Outcome> {
    const now = this.deps.clock.now();
    const positionId = await tx.insertPosition(toNewPosition(vehicle, command, now));
    if (positionId === null) {
      return { result: { status: 'duplicate' }, events: [], alerts: [], completedRouteId: null };
    }

    const fix: PositionFix = {
      vehicleId: vehicle.id,
      fixTime: command.fixTime,
      lat: command.lat,
      lon: command.lon,
      speedKmh: command.speedKmh,
      valid: command.valid,
    };
    const events: PendingEvent[] = [];
    let trip = await tx.lockActiveTrip(vehicle.id);
    let route: RouteSnapshot | null;
    if (trip === null) {
      route = await this.autoStartRoute(vehicle, fix);
      if (route !== null) {
        trip = await tx.createTrip({
          routeId: route.id,
          vehicleId: vehicle.id,
          startMode: 'auto',
          startedAt: fix.fixTime,
        });
        events.push({ name: 'trip.started', payload: tripStarted(trip) });
      }
    } else {
      route = await this.loadRoute(trip.routeId, {
        tripId: trip.state.tripId,
        vehicleId: vehicle.id,
      });
    }

    events.unshift({
      name: 'vehicle.position',
      payload: {
        vehicleId: vehicle.id,
        vehicleCode: vehicle.code,
        tripId: trip?.state.tripId ?? null,
        fixTime: fix.fixTime,
        lat: fix.lat,
        lon: fix.lon,
        speedKmh: fix.speedKmh,
        course: command.course,
        valid: fix.valid,
      },
    });
    const tripId = trip?.state.tripId ?? null;
    const stored: Outcome = {
      result: { status: 'processed', positionId, tripId },
      events,
      alerts: [],
      completedRouteId: null,
    };
    if (trip === null) return stored;
    if (route === null) {
      // The position is kept and linked to its trip, but the trip cannot advance without its
      // route. Later fixes keep flowing; the inactivity job ends the trip if the route stays gone.
      await tx.attachPositionToTrip(positionId, trip.state.tripId, {
        chainage: null,
        offRoute: trip.state.offRoute,
      });
      return stored;
    }

    return this.advance(tx, { trip, route, fix, positionId, now, events });
  }

  private async advance(
    tx: TrackingTransaction,
    input: {
      trip: TripRecord;
      route: RouteSnapshot;
      fix: PositionFix;
      positionId: string;
      now: Date;
      events: PendingEvent[];
    },
  ): Promise<Outcome> {
    const { trip, route, fix, positionId, now, events } = input;
    const { settings } = this.deps;
    const tripId = trip.state.tripId;
    const update = advanceTrip(trip.state, fix, route, settings.tracking);
    const state = update.state;
    const accepted =
      state.progressAt?.getTime() === fix.fixTime.getTime() &&
      trip.state.progressAt?.getTime() !== fix.fixTime.getTime();
    const recentSpeed = accepted
      ? observeProgress(
          trip.recentSpeed,
          { chainage: state.progressChainage, at: fix.fixTime },
          settings.eta,
        )
      : trip.recentSpeed;
    const completed = state.status === 'completed';
    const next: TripRecord = {
      ...trip,
      state,
      recentSpeed,
      endReason: completed ? 'route_completed' : trip.endReason,
    };

    const passes = update.events.flatMap((e) => (e.type === 'point_passed' ? [e] : []));
    await tx.recordPasses(tripId, passes);
    await tx.saveTrip(next);
    await tx.attachPositionToTrip(positionId, tripId, {
      chainage: accepted ? state.progressChainage : null,
      offRoute: state.offRoute,
    });

    for (const pass of passes) {
      events.push({
        name: 'point.passed',
        payload: {
          tripId,
          routeId: trip.routeId,
          pointId: pass.pointId,
          passedAt: pass.passedAt,
          precision: pass.precision,
        },
      });
    }
    if (state !== trip.state) events.push({ name: 'trip.updated', payload: tripUpdated(next) });
    if (completed) {
      events.push({ name: 'trip.completed', payload: tripEnded(next) });
      return {
        result: { status: 'processed', positionId, tripId },
        events,
        alerts: [],
        completedRouteId: trip.routeId,
      };
    }

    const profile = await this.loadSpeedProfile(trip.routeId, tripId);
    const etas = estimateEtas(
      { now, trip: state, points: route.points, recentSpeedMps: recentSpeed.speedMps, profile },
      settings.eta,
    );
    events.push({
      name: 'eta.updated',
      payload: { tripId, routeId: trip.routeId, vehicleId: trip.vehicleId, computedAt: now, etas },
    });

    // Until the trip has a measured recent speed or the route a historical profile, the ETA rests
    // on the default speed alone: good enough to display, not to send households an alert.
    const hasSpeedBasis = recentSpeed.speedMps !== null || profile !== null;
    const decisions = hasSpeedBasis
      ? decideAlerts(
          { tripId, now, etas, alreadyAlertedPointIds: await tx.alertedPointIds(tripId) },
          settings.alerts,
        )
      : [];
    const stored = decisions.length === 0 ? [] : await tx.recordAlerts(decisions);
    const alerts = stored.map((alert) => ({ ...alert, routeId: trip.routeId }));
    for (const alert of alerts) {
      events.push({
        name: 'alert.emitted',
        payload: {
          alertId: alert.alertId,
          tripId,
          routeId: trip.routeId,
          pointId: alert.pointId,
          emittedAt: alert.emittedAt,
          communicatedPredictedPassAt: alert.communicatedPredictedPassAt,
          secondsRemainingAtEmission: alert.secondsRemainingAtEmission,
          insideTargetWindow: alert.insideTargetWindow,
        },
      });
    }
    return {
      result: { status: 'processed', positionId, tripId },
      events,
      alerts,
      completedRouteId: null,
    };
  }

  /**
   * The route of a trip, or null when it is missing or cannot be loaded: the fix is then stored
   * without advancing the trip, so one bad route never blocks a vehicle's later positions.
   */
  private async loadRoute(
    routeId: string,
    context: { readonly tripId: string | null; readonly vehicleId: string },
  ): Promise<RouteSnapshot | null> {
    let route: RouteSnapshot | null = null;
    let failure: unknown;
    try {
      route = await this.deps.routes.get(routeId);
    } catch (error) {
      failure = error;
    }
    if (route === null) {
      this.deps.logger.error(
        { err: failure, routeId, ...context },
        'Trip route could not be loaded; position stored without trip advancement',
      );
    }
    return route;
  }

  /**
   * The route's historical speed profile, or null when it cannot be loaded: the ETA then relies on
   * the recent speed only, and the fix is processed as usual.
   */
  private async loadSpeedProfile(routeId: string, tripId: string): Promise<SpeedProfile | null> {
    try {
      return await this.deps.profiles.forRoute(routeId);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, routeId, tripId },
        'Historical speed profile unavailable; using recent speed only',
      );
      return null;
    }
  }

  /** The vehicle's default route when this fix is a plausible start of it (on route, near its start). */
  private async autoStartRoute(vehicle: Vehicle, fix: PositionFix): Promise<RouteSnapshot | null> {
    if (vehicle.defaultRouteId === null || !fix.valid) return null;
    const route = await this.loadRoute(vehicle.defaultRouteId, {
      tripId: null,
      vehicleId: vehicle.id,
    });
    if (route === null) return null;
    const match = projectOntoRoute(route.geometry, fix);
    const { tracking, startZoneMeters } = this.deps.settings;
    const startsHere =
      match !== null &&
      match.offsetMeters <= tracking.offRouteThresholdMeters &&
      match.chainage <= startZoneMeters;
    return startsHere ? route : null;
  }

  private notifyInBackground(alerts: Outcome['alerts']): void {
    const running = this.notify(alerts).finally(() => this.notifications.delete(running));
    this.notifications.add(running);
  }

  private async notify(alerts: Outcome['alerts']): Promise<void> {
    for (const alert of alerts) {
      try {
        await this.deps.notifier.notify(alert);
      } catch (error) {
        this.deps.logger.error({ err: error, alertId: alert.alertId }, 'Alert notification failed');
      }
    }
  }
}

function toNewPosition(vehicle: Vehicle, command: IngestPositionCommand, now: Date): NewPosition {
  return {
    vehicleId: vehicle.id,
    traccarPositionId: command.traccarPositionId,
    fixTime: command.fixTime,
    serverTime: command.serverTime,
    receivedAt: now,
    lat: command.lat,
    lon: command.lon,
    speedKmh: command.speedKmh,
    course: command.course,
    valid: command.valid,
    accuracy: command.accuracy,
  };
}

export function tripStarted(trip: TripRecord): TrackingEvents['trip.started'] {
  return {
    tripId: trip.state.tripId,
    routeId: trip.routeId,
    vehicleId: trip.vehicleId,
    startMode: trip.startMode,
    startedAt: trip.startedAt,
  };
}

export function tripUpdated(trip: TripRecord): TrackingEvents['trip.updated'] {
  return {
    tripId: trip.state.tripId,
    routeId: trip.routeId,
    vehicleId: trip.vehicleId,
    progressChainage: trip.state.progressChainage,
    progressAt: trip.state.progressAt,
    lastFixAt: trip.state.lastFixAt,
    offRoute: trip.state.offRoute,
    passedPointIds: trip.state.passedPointIds,
  };
}

export function tripEnded(trip: TripRecord): TrackingEvents['trip.completed'] {
  const { state } = trip;
  if (state.status === 'active' || state.endedAt === null) {
    throw new Error(`Trip ${state.tripId} has not ended`);
  }
  return {
    tripId: state.tripId,
    routeId: trip.routeId,
    vehicleId: trip.vehicleId,
    status: state.status,
    endedAt: state.endedAt,
    endReason: trip.endReason ?? 'unknown',
  };
}
