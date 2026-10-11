import { describe, expect, it } from 'vitest';

import { FIX_AT, eta, liveEta, snapshot, trip } from '../test/fixtures';
import {
  INITIAL_LIVE_STATE,
  liveReducer,
  selectArrival,
  selectTruckSignal,
  selectTruckPosition,
  type LiveAction,
  type LiveState,
} from './live-state';

const withSnapshot = (s = snapshot()): LiveState => ({ snapshot: s, connection: 'live' });
const apply = (state: LiveState, ...actions: LiveAction[]) => actions.reduce(liveReducer, state);

describe('liveReducer', () => {
  it('stores the snapshot and the connection status', () => {
    const state = apply(
      INITIAL_LIVE_STATE,
      { type: 'snapshot', snapshot: snapshot() },
      { type: 'connection', status: 'live' },
    );

    expect(state).toEqual({ snapshot: snapshot(), connection: 'live' });
  });

  it('moves the truck on vehicle.position', () => {
    const state = apply(withSnapshot(), {
      type: 'event',
      name: 'vehicle.position',
      data: {
        tripId: 'trip-1',
        vehicleCode: 'UNIDAD-A',
        fixTime: '2026-10-20T22:31:00.000Z',
        lat: -9.524,
        lon: -77.528,
        speedKmh: 12,
        course: 90,
      },
    });

    expect(state.snapshot?.trips[0]).toMatchObject({
      lastFixAt: '2026-10-20T22:31:00.000Z',
      lastPosition: { lat: -9.524, lon: -77.528, fixTime: '2026-10-20T22:31:00.000Z' },
    });
  });

  it('replaces the ETAs and the signal on eta.updated', () => {
    const state = apply(withSnapshot(), {
      type: 'event',
      name: 'eta.updated',
      data: {
        tripId: 'trip-1',
        computedAt: FIX_AT,
        lastFixAt: FIX_AT,
        signal: 'stale',
        etas: [eta('P01', 'passed'), eta('P08', 'stale'), eta('P09', 'stale')],
      },
    });

    expect(state.snapshot?.trips[0]?.signal).toBe('stale');
    expect(state.snapshot?.trips[0]?.etas.map((e) => e.status)).toEqual([
      'passed',
      'stale',
      'stale',
    ]);
  });

  it('records a pass once and marks the point as passed', () => {
    const pass = {
      tripId: 'trip-1',
      pointId: 'id-P08',
      pointCode: 'P08',
      passedAt: '2026-10-20T22:42:00.000Z',
      precision: 'interpolated' as const,
    };

    const state = apply(
      withSnapshot(),
      { type: 'event', name: 'point.passed', data: pass },
      { type: 'event', name: 'point.passed', data: pass },
    );

    expect(state.snapshot?.trips[0]?.passes.map((p) => p.pointCode)).toEqual(['P01', 'P08']);
    expect(state.snapshot?.trips[0]?.etas[1]).toEqual(eta('P08', 'passed'));
  });

  it('removes the trip on trip.completed', () => {
    const state = apply(withSnapshot(), {
      type: 'event',
      name: 'trip.completed',
      data: {
        tripId: 'trip-1',
        status: 'completed',
        endedAt: FIX_AT,
        endReason: 'route_completed',
      },
    });

    expect(state.snapshot?.trips).toEqual([]);
  });

  it('ignores events of unknown trips and events before the first snapshot', () => {
    const event: LiveAction = {
      type: 'event',
      name: 'trip.completed',
      data: { tripId: 'trip-9', status: 'aborted', endedAt: FIX_AT, endReason: null },
    };
    const state = withSnapshot();

    expect(liveReducer(state, event)).toBe(state);
    expect(liveReducer(INITIAL_LIVE_STATE, event)).toBe(INITIAL_LIVE_STATE);
  });
});

describe('selectArrival', () => {
  it('shows the arrival window of a live prediction with the last fix time', () => {
    expect(selectArrival(snapshot(), 'P08')).toEqual({
      kind: 'live',
      minMinutes: 8,
      maxMinutes: 12,
      updatedAt: FIX_AT,
    });
  });

  it('never shows a prediction when the signal is stale', () => {
    const stale = snapshot([trip({ signal: 'stale' })]);

    expect(selectArrival(stale, 'P08')).toEqual({ kind: 'stale', updatedAt: FIX_AT });
  });

  it('reports the pass time of a passed point', () => {
    expect(selectArrival(snapshot(), 'P01')).toEqual({
      kind: 'passed',
      passedAt: '2026-10-20T22:20:00.000Z',
    });
  });

  it('distinguishes loading, no trip and a trip still starting', () => {
    const starting = snapshot([
      trip({
        signal: 'none',
        lastFixAt: null,
        lastPosition: null,
        etas: [eta('P08', 'not_started')],
      }),
    ]);

    expect(selectArrival(null, 'P08')).toEqual({ kind: 'loading' });
    expect(selectArrival(snapshot([]), 'P08')).toEqual({ kind: 'no_trip' });
    expect(selectArrival(starting, 'P08')).toEqual({ kind: 'starting', updatedAt: null });
  });

  it('prefers the trip with a live prediction for the point', () => {
    const older = trip({ tripId: 'trip-0', etas: [liveEta('P08', 3, 5)] });
    const newer = trip({ tripId: 'trip-2', etas: [eta('P08', 'not_started')] });

    expect(selectArrival(snapshot([older, newer]), 'P08')).toMatchObject({ minMinutes: 3 });
    expect(selectTruckPosition(snapshot([older, newer]), 'P08')).toEqual({
      lat: -9.5235,
      lon: -77.5283,
      stale: false,
      fixTime: FIX_AT,
      course: null,
    });
  });
});

describe('selectTruckSignal', () => {
  it('follows the signal of the shown trip, not the connection', () => {
    const stale = snapshot([trip({ signal: 'stale' })]);
    const none = snapshot([trip({ signal: 'none', lastPosition: null, lastFixAt: null })]);

    expect(selectTruckSignal(null, 'P08')).toBe('loading');
    expect(selectTruckSignal(snapshot([]), 'P08')).toBe('no_trip');
    expect(selectTruckSignal(snapshot(), 'P08')).toBe('live');
    expect(selectTruckSignal(stale, 'P08')).toBe('stale');
    expect(selectTruckSignal(none, 'P08')).toBe('none');
  });
});
