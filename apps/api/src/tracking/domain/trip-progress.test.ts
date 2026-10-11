import { describe, expect, it } from 'vitest';

import type { LatLon } from '../../shared/domain/geo.js';
import { locateReferencePoints } from '../../routes/domain/reference-points.js';
import { RI01_REFERENCE_POINTS, RI01_ROUTE } from '../../routes/domain/ri01.fixture.js';
import { buildRouteGeometry, positionAtChainage } from '../../routes/domain/route-geometry.js';
import type { PositionFix } from './position-fix.js';
import { startTrip, type TripState } from './trip.js';
import { advanceTrip, type TrackedRoute, type TripEvent } from './trip-progress.js';

const geometry = buildRouteGeometry(RI01_ROUTE.polyline);
const points = locateReferencePoints(geometry, RI01_REFERENCE_POINTS);
const route: TrackedRoute = { geometry, points };
const T0 = Date.parse('2026-10-20T07:00:00Z');

/** A fix at `chainage` on RI-01, `seconds` after T0, optionally shifted east by `eastMeters`. */
function fixAt(chainage: number, seconds: number, eastMeters = 0, valid = true): PositionFix {
  const onRoute = positionAtChainage(geometry, chainage);
  return fixFrom(shiftEast(onRoute, eastMeters), seconds, valid);
}

function fixFrom(position: LatLon, seconds: number, valid = true): PositionFix {
  return {
    vehicleId: 'truck-1',
    fixTime: new Date(T0 + seconds * 1000),
    lat: position.lat,
    lon: position.lon,
    speedKmh: 10,
    valid,
  };
}

function shiftEast(p: LatLon, meters: number): LatLon {
  return { lat: p.lat, lon: p.lon + meters / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

function drive(fixes: readonly PositionFix[], from: TripState = startTrip('trip-1')) {
  let state = from;
  const events: TripEvent[] = [];
  for (const fix of fixes) {
    const result = advanceTrip(state, fix, route);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

const passes = (events: readonly TripEvent[]) => events.filter((e) => e.type === 'point_passed');

describe('advanceTrip: fix filtering', () => {
  it('ignores invalid fixes', () => {
    const initial = startTrip('trip-1');

    const result = advanceTrip(initial, fixAt(10, 0, 0, false), route);

    expect(result.state).toBe(initial);
    expect(result.events).toEqual([{ type: 'fix_ignored', reason: 'invalid' }]);
  });

  it('ignores out-of-order and duplicate fixes', () => {
    const { state } = drive([fixAt(10, 0), fixAt(40, 20)]);

    const older = advanceTrip(state, fixAt(80, 10), route);
    const duplicate = advanceTrip(state, fixAt(80, 20), route);

    expect(older.state).toBe(state);
    expect(older.events).toEqual([{ type: 'fix_ignored', reason: 'out_of_order' }]);
    expect(duplicate.events).toEqual([{ type: 'fix_ignored', reason: 'out_of_order' }]);
  });
});

describe('advanceTrip: progress', () => {
  it('advances progress to the projected chainage and records the fix times', () => {
    // RI-01 runs north-northwest, so an eastward shift is mostly (not purely) lateral.
    const { state } = drive([fixAt(10, 0), fixAt(25, 20, 8)]);

    expect(state.progressChainage).toBeGreaterThan(22);
    expect(state.progressChainage).toBeLessThan(26);
    expect(state.progressAt).toEqual(new Date(T0 + 20_000));
    expect(state.lastFixAt).toEqual(new Date(T0 + 20_000));
  });

  it('never moves progress backwards on GPS jitter', () => {
    const { state } = drive([fixAt(10, 0), fixAt(200, 40), fixAt(190, 60)]);

    expect(state.progressChainage).toBeCloseTo(200, 0);
    expect(state.progressAt).toEqual(new Date(T0 + 60_000));
  });

  it('flags the truck off route without advancing, once, until it rejoins', () => {
    const { state, events } = drive([fixAt(10, 0), fixAt(100, 20, 80), fixAt(120, 40, 90)]);

    expect(state.progressChainage).toBeCloseTo(10, 0);
    expect(state.offRoute).toBe(true);
    expect(state.lastFixAt).toEqual(new Date(T0 + 40_000));
    expect(events.filter((e) => e.type === 'off_route')).toHaveLength(1);

    const rejoined = advanceTrip(state, fixAt(130, 60), route);

    expect(rejoined.state.offRoute).toBe(false);
    expect(rejoined.state.progressChainage).toBeCloseTo(130, 0);
    expect(rejoined.events[0]).toEqual({ type: 'route_rejoined', at: new Date(T0 + 60_000) });
  });

  it('rejects an implausible jump ahead but accepts the same distance after a long gap', () => {
    const { state } = drive([fixAt(10, 0)]);

    const jump = advanceTrip(state, fixAt(700, 20), route);

    expect(jump.state.progressChainage).toBeCloseTo(10, 0);
    expect(jump.events).toHaveLength(1);
    expect(jump.events[0]).toMatchObject({ type: 'jump_rejected', at: new Date(T0 + 20_000) });
    expect(jump.events[0]?.type === 'jump_rejected' && jump.events[0].chainage).toBeCloseTo(700, 0);
    expect(advanceTrip(state, fixAt(700, 120), route).state.progressChainage).toBeCloseTo(700, 0);
  });

  it('follows an out-and-back route past the overlapping stretch', () => {
    const outAndBack = buildRouteGeometry([
      { lat: -9.52, lon: -77.53 },
      { lat: -9.519, lon: -77.53 },
      { lat: -9.52, lon: -77.53 },
    ]);
    const leg = outAndBack.lengthMeters / 2;
    const trackedRoute: TrackedRoute = { geometry: outAndBack, points: [] };
    let state = startTrip('trip-1');
    for (let s = 0, c = 0; c <= 2 * leg - 40; s += 20, c += 20) {
      const p = positionAtChainage(outAndBack, c);
      state = advanceTrip(state, fixFrom(p, s), trackedRoute).state;
    }

    expect(state.progressChainage).toBeGreaterThan(1.5 * leg);
  });
});

describe('advanceTrip: point passes', () => {
  const p01 = points[0]!;
  const p02 = points[1]!;
  const p03 = points[2]!;

  it('emits one pass per point with the time interpolated by chainage', () => {
    // 0 s at chainage 0, 40 s at P01 + 20 m: P01 is crossed at 40 * (P01 / (P01 + 20)) s.
    const { events } = drive([fixAt(0, 0), fixAt(p01.chainage + 20, 40)]);

    const expectedSeconds = (40 * p01.chainage) / (p01.chainage + 20);
    expect(passes(events)).toEqual([
      {
        type: 'point_passed',
        pointId: p01.id,
        passedAt: new Date(T0 + Math.round(expectedSeconds * 1000)),
        precision: 'interpolated',
      },
    ]);
  });

  it('passes a point once progress is within the pass tolerance of it', () => {
    const { events } = drive([fixAt(0, 0), fixAt(p01.chainage - 10, 20)]);

    expect(passes(events)).toEqual([
      expect.objectContaining({ pointId: p01.id, passedAt: new Date(T0 + 20_000) }),
    ]);
  });

  it('passes several points with one fix, in route order', () => {
    const { events } = drive([fixAt(0, 0), fixAt(p03.chainage + 5, 100)]);

    expect(passes(events).map((e) => e.type === 'point_passed' && e.pointId)).toEqual([
      p01.id,
      p02.id,
      p03.id,
    ]);
  });

  it('never passes the same point twice', () => {
    const { state, events } = drive([
      fixAt(0, 0),
      fixAt(p01.chainage + 5, 20),
      fixAt(p01.chainage + 6, 40),
      fixAt(p01.chainage + 30, 60),
    ]);

    expect(passes(events)).toHaveLength(1);
    expect(state.passedPointIds).toEqual([p01.id]);
  });

  it('marks points behind the first fix as passed no later than that fix', () => {
    const { events } = drive([fixAt(p02.chainage + 10, 0)]);

    expect(passes(events)).toEqual([
      { type: 'point_passed', pointId: p01.id, passedAt: new Date(T0), precision: 'upper_bound' },
      { type: 'point_passed', pointId: p02.id, passedAt: new Date(T0), precision: 'upper_bound' },
    ]);
  });
});

describe('advanceTrip: completion', () => {
  it('completes the trip near the route end and ignores later fixes', () => {
    const end = geometry.lengthMeters;
    const { state, events } = drive([fixAt(end - 60, 0), fixAt(end - 20, 20)]);

    expect(state.status).toBe('completed');
    expect(state.endedAt).toEqual(new Date(T0 + 20_000));
    expect(events.at(-1)).toEqual({ type: 'trip_completed', at: new Date(T0 + 20_000) });
    expect(advanceTrip(state, fixAt(end, 40), route).events).toEqual([
      { type: 'fix_ignored', reason: 'trip_closed' },
    ]);
  });
});
