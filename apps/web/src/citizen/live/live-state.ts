import type { LiveSnapshot, LiveStreamEvents, LiveTrip, PointEta } from '../api/types';

/**
 * `connecting`: first load; `live`: the stream is open; `reconnecting`: the stream dropped and is
 * being reopened; `polling`: the stream failed repeatedly, the snapshot is fetched periodically.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'polling';

export interface LiveState {
  readonly snapshot: LiveSnapshot | null;
  readonly connection: ConnectionStatus;
}

export const INITIAL_LIVE_STATE: LiveState = { snapshot: null, connection: 'connecting' };

/** Stream events the state applies (`trip.started` triggers a snapshot refetch instead). */
export type AppliedEventName =
  'vehicle.position' | 'eta.updated' | 'point.passed' | 'trip.completed';

export type LiveAction =
  | { readonly type: 'snapshot'; readonly snapshot: LiveSnapshot }
  | { readonly type: 'connection'; readonly status: ConnectionStatus }
  | {
      [K in AppliedEventName]: {
        readonly type: 'event';
        readonly name: K;
        readonly data: LiveStreamEvents[K];
      };
    }[AppliedEventName];

/**
 * Applies the snapshot and the stream events to the live state. Events of a trip the snapshot
 * does not know are ignored: the next snapshot (on reconnection or `trip.started`) resyncs.
 */
export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'snapshot':
      return { ...state, snapshot: action.snapshot };
    case 'connection':
      return state.connection === action.status ? state : { ...state, connection: action.status };
    case 'event': {
      if (state.snapshot === null) return state;
      const snapshot = applyEvent(state.snapshot, action);
      return snapshot === state.snapshot ? state : { ...state, snapshot };
    }
  }
}

function applyEvent(
  snapshot: LiveSnapshot,
  action: Extract<LiveAction, { type: 'event' }>,
): LiveSnapshot {
  switch (action.name) {
    case 'vehicle.position': {
      const { tripId, fixTime, lat, lon } = action.data;
      return updateTrip(snapshot, tripId, (trip) => ({
        ...trip,
        lastFixAt: fixTime,
        lastPosition: { lat, lon, fixTime },
      }));
    }
    case 'eta.updated': {
      const { tripId, lastFixAt, signal, etas } = action.data;
      return updateTrip(snapshot, tripId, (trip) => ({ ...trip, lastFixAt, signal, etas }));
    }
    case 'point.passed': {
      const { tripId, ...pass } = action.data;
      return updateTrip(snapshot, tripId, (trip) =>
        trip.passes.some((p) => p.pointId === pass.pointId)
          ? trip
          : {
              ...trip,
              passes: [...trip.passes, pass],
              etas: trip.etas.map((eta) => (eta.pointId === pass.pointId ? passedEta(eta) : eta)),
            },
      );
    }
    case 'trip.completed': {
      const trips = snapshot.trips.filter((trip) => trip.tripId !== action.data.tripId);
      return trips.length === snapshot.trips.length ? snapshot : { ...snapshot, trips };
    }
  }
}

function passedEta(eta: PointEta): PointEta {
  return { pointId: eta.pointId, pointCode: eta.pointCode, status: 'passed' };
}

function updateTrip(
  snapshot: LiveSnapshot,
  tripId: string,
  update: (trip: LiveTrip) => LiveTrip,
): LiveSnapshot {
  if (!snapshot.trips.some((trip) => trip.tripId === tripId)) return snapshot;
  return {
    ...snapshot,
    trips: snapshot.trips.map((trip) => (trip.tripId === tripId ? update(trip) : trip)),
  };
}

/** What the arrival card shows for the household's point. */
export type ArrivalView =
  | { readonly kind: 'loading' }
  /** No truck runs the route: show the printed schedule. */
  | { readonly kind: 'no_trip' }
  /** The trip started but there is no usable fix yet. */
  | { readonly kind: 'starting'; readonly updatedAt: string | null }
  | {
      readonly kind: 'live';
      readonly minMinutes: number;
      readonly maxMinutes: number;
      readonly updatedAt: string | null;
    }
  /** The telemetry is stale: never show an ETA, show the printed schedule. */
  | { readonly kind: 'stale'; readonly updatedAt: string | null }
  | { readonly kind: 'passed'; readonly passedAt: string | null };

/**
 * The trip shown for `pointCode`. With several active trips (rare), the one with a live
 * prediction for the point wins, then the newest one.
 */
function shownTrip(snapshot: LiveSnapshot, pointCode: string | null): LiveTrip | null {
  const live = snapshot.trips.find((trip) => etaOf(trip, pointCode)?.status === 'live');
  return live ?? snapshot.trips[snapshot.trips.length - 1] ?? null;
}

function etaOf(trip: LiveTrip, pointCode: string | null): PointEta | undefined {
  return trip.etas.find((eta) => eta.pointCode === pointCode);
}

/** The arrival at `pointCode`. */
export function selectArrival(
  snapshot: LiveSnapshot | null,
  pointCode: string | null,
): ArrivalView {
  if (snapshot === null) return { kind: 'loading' };
  const trip = shownTrip(snapshot, pointCode);
  if (trip === null) return { kind: 'no_trip' };
  const updatedAt = trip.lastFixAt;
  const eta = etaOf(trip, pointCode);

  if (eta?.status === 'passed') {
    const pass = trip.passes.find((p) => p.pointCode === pointCode);
    return { kind: 'passed', passedAt: pass?.passedAt ?? null };
  }
  if (trip.signal === 'stale' || eta?.status === 'stale') return { kind: 'stale', updatedAt };
  if (eta?.status === 'live') {
    return {
      kind: 'live',
      minMinutes: eta.window.minMinutes,
      maxMinutes: eta.window.maxMinutes,
      updatedAt,
    };
  }
  return { kind: 'starting', updatedAt };
}

/** The truck position to draw on the map (the trip shown in the arrival card), if any. */
export function selectTruckPosition(
  snapshot: LiveSnapshot | null,
  pointCode: string | null,
): { readonly lat: number; readonly lon: number; readonly stale: boolean } | null {
  const trip = snapshot === null ? null : shownTrip(snapshot, pointCode);
  if (trip?.lastPosition == null) return null;
  return { lat: trip.lastPosition.lat, lon: trip.lastPosition.lon, stale: trip.signal !== 'live' };
}
