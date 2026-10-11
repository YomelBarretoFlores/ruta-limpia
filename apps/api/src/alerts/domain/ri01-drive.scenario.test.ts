/**
 * End-to-end domain scenario: a truck drives RI-01 in stop-and-go (40 s at 1.5 m/s, 40 s stopped),
 * reporting every 20 s, through the whole pure pipeline:
 * fix → trip progress and passes → recent speed → ETA per point → alert policy.
 * It includes a GPS gap longer than 60 s, an off-route fix and an out-of-order fix.
 */
import { describe, expect, it } from 'vitest';

import { estimateEtas, type PointEta } from '../../eta/domain/eta-estimator.js';
import type { ProgressSample } from '../../eta/domain/progress-sample.js';
import { INITIAL_RECENT_SPEED, observeProgress } from '../../eta/domain/recent-speed.js';
import { buildSpeedProfile } from '../../eta/domain/speed-profile.js';
import { locateReferencePoints } from '../../routes/domain/reference-points.js';
import { RI01_REFERENCE_POINTS, RI01_ROUTE } from '../../routes/domain/ri01.fixture.js';
import { buildRouteGeometry, positionAtChainage } from '../../routes/domain/route-geometry.js';
import type { PositionFix } from '../../tracking/domain/position-fix.js';
import { startTrip } from '../../tracking/domain/trip.js';
import {
  advanceTrip,
  type TrackedRoute,
  type TripEvent,
} from '../../tracking/domain/trip-progress.js';
import { decideAlerts, etaErrorMinutes, type AlertDecision } from './alert-policy.js';

const geometry = buildRouteGeometry(RI01_ROUTE.polyline);
const points = locateReferencePoints(geometry, RI01_REFERENCE_POINTS);
const route: TrackedRoute = { geometry, points };
const T0 = Date.parse('2026-10-20T07:00:00Z');
const FIX_INTERVAL_SEC = 20;
const GAP = { after: 640, resumeAt: 760 }; // no fixes in between: 120 s without telemetry
const OFF_ROUTE_AT = 300;
const OUT_OF_ORDER_AFTER = 400;

/** True truck position (chainage) `seconds` into the trip: 40 s at 1.5 m/s, then 40 s stopped. */
function trueChainageAt(seconds: number): number {
  const cycle = Math.floor(seconds / 80);
  const moving = Math.min(seconds - cycle * 80, 40);
  return Math.min(geometry.lengthMeters, (cycle * 40 + moving) * 1.5);
}

/** First time (to 0.1 s) the true position reaches `chainage`. */
function trueTimeAt(chainage: number): number {
  let t = 0;
  while (trueChainageAt(t) < chainage) t += 0.1;
  return t;
}

function fixAt(seconds: number, eastMeters = 0): PositionFix {
  const p = positionAtChainage(geometry, trueChainageAt(seconds));
  const lonPerMeter = 1 / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return {
    vehicleId: 'truck-1',
    fixTime: new Date(T0 + seconds * 1000),
    lat: p.lat,
    lon: p.lon + eastMeters * lonPerMeter,
    speedKmh: 0,
    valid: true,
  };
}

/** Yesterday's identical run, as the historical speed profile. */
function historicalProfile() {
  const samples: ProgressSample[] = [];
  for (let s = 0; trueChainageAt(s) < geometry.lengthMeters; s += FIX_INTERVAL_SEC) {
    samples.push({ chainage: trueChainageAt(s), at: new Date(T0 - 86_400_000 + s * 1000) });
  }
  return buildSpeedProfile([samples]);
}

interface Evaluation {
  readonly seconds: number;
  readonly progress: number;
  readonly etas: readonly PointEta[];
  readonly alerts: readonly AlertDecision[];
}

function runScenario() {
  const profile = historicalProfile();
  let trip = startTrip('trip-1');
  let speed = INITIAL_RECENT_SPEED;
  const events: TripEvent[] = [];
  const alerts: AlertDecision[] = [];
  const evaluations: Evaluation[] = [];
  const offRouteResult: { progressBefore: number; progressAfter: number; events: TripEvent[] } = {
    progressBefore: Number.NaN,
    progressAfter: Number.NaN,
    events: [],
  };
  let outOfOrder: { events: readonly TripEvent[]; stateUnchanged: boolean } = {
    events: [],
    stateUnchanged: false,
  };

  const evaluate = (seconds: number) => {
    const now = new Date(T0 + seconds * 1000);
    const etas = estimateEtas({
      now,
      trip,
      points,
      recentSpeedMps: speed.speedMps,
      profile,
    });
    const emitted = decideAlerts({
      tripId: trip.tripId,
      now,
      etas,
      alreadyAlertedPointIds: alerts.map((a) => a.pointId),
    });
    alerts.push(...emitted);
    evaluations.push({ seconds, progress: trip.progressChainage, etas, alerts: emitted });
  };

  for (let s = 0; trip.status === 'active' && s < 3600; s += FIX_INTERVAL_SEC) {
    if (s > GAP.after && s < GAP.resumeAt) {
      evaluate(s); // the application keeps refreshing ETAs while no fix arrives
      continue;
    }
    const fix = s === OFF_ROUTE_AT ? fixAt(s, 100) : fixAt(s);
    const before = trip;
    const update = advanceTrip(trip, fix, route);
    trip = update.state;
    events.push(...update.events);
    if (s === OFF_ROUTE_AT) {
      Object.assign(offRouteResult, {
        progressBefore: before.progressChainage,
        progressAfter: trip.progressChainage,
        events: update.events,
      });
    }
    if (trip.progressAt !== null && trip.progressAt !== before.progressAt) {
      speed = observeProgress(speed, { chainage: trip.progressChainage, at: trip.progressAt });
    }
    evaluate(s);
    if (s === OUT_OF_ORDER_AFTER) {
      const late = advanceTrip(trip, fixAt(s - FIX_INTERVAL_SEC), route);
      outOfOrder = { events: late.events, stateUnchanged: late.state === trip };
    }
  }
  return { trip, events, alerts, evaluations, offRouteResult, outOfOrder };
}

const run = runScenario();
const passes = run.events.flatMap((e) => (e.type === 'point_passed' ? [e] : []));
const passedAt = (pointId: string) => passes.find((p) => p.pointId === pointId)!.passedAt;
const etaOf = (evaluation: Evaluation, pointId: string) =>
  evaluation.etas.find((e) => e.pointId === pointId)!;

describe('RI-01 stop-and-go drive', () => {
  it('completes the trip with monotonic progress', () => {
    expect(run.trip.status).toBe('completed');
    for (let i = 1; i < run.evaluations.length; i++) {
      expect(run.evaluations[i]!.progress).toBeGreaterThanOrEqual(run.evaluations[i - 1]!.progress);
    }
  });

  it('passes every point exactly once, with interpolated times close to the truth', () => {
    expect(passes.map((p) => p.pointId)).toEqual(points.map((p) => p.id));
    for (const point of points) {
      const pass = passes.find((p) => p.pointId === point.id)!;
      const seconds = (pass.passedAt.getTime() - T0) / 1000;

      expect(pass.precision).toBe('interpolated');
      // Interpolated at the exact chainage: within one fix interval of the true crossing time.
      expect(Math.abs(seconds - trueTimeAt(point.chainage))).toBeLessThanOrEqual(FIX_INTERVAL_SEC);
    }
  });

  it('counts the last point down: its ETA falls every two stop-and-go cycles', () => {
    const last = points.at(-1)!.id;
    const sampled = run.evaluations
      .filter((e) => e.seconds % 160 === 0)
      .map((e) => etaOf(e, last))
      .flatMap((eta) => (eta.status === 'live' ? [eta.secondsRemaining] : []));

    expect(sampled.length).toBeGreaterThan(8);
    for (let i = 1; i < sampled.length; i++) expect(sampled[i]!).toBeLessThan(sampled[i - 1]!);
  });

  it('alerts each point at most once, and inside the 5–10 min window when it had the lead time', () => {
    const alertedIds = run.alerts.map((a) => a.pointId);
    expect(new Set(alertedIds).size).toBe(alertedIds.length);

    const firstLive = (pointId: string) =>
      run.evaluations.map((e) => etaOf(e, pointId)).find((eta) => eta.status === 'live');
    const farPoints = points.filter((p) => {
      const eta = firstLive(p.id);
      return eta?.status === 'live' && eta.secondsRemaining > 600;
    });

    expect(farPoints.length).toBeGreaterThan(5);
    for (const point of farPoints) {
      const pointAlerts = run.alerts.filter((a) => a.pointId === point.id);
      expect(pointAlerts).toHaveLength(1);
      expect(pointAlerts[0]!.insideTargetWindow).toBe(true);
    }
  });

  it('keeps the median ETA error of communicated alerts within 5 minutes', () => {
    const errors = run.alerts
      .map((a) => etaErrorMinutes(a.communicatedPredictedPassAt, passedAt(a.pointId)))
      .sort((a, b) => a - b);

    expect(errors[Math.floor(errors.length / 2)]!).toBeLessThanOrEqual(5);
  });

  it('suspends ETAs and alerts during a GPS gap over 60 s, then resumes', () => {
    const inGap = run.evaluations.filter(
      (e) => e.seconds > GAP.after + 60 && e.seconds < GAP.resumeAt,
    );
    const resumed = run.evaluations.find((e) => e.seconds === GAP.resumeAt)!;

    expect(inGap.length).toBeGreaterThan(0);
    for (const evaluation of inGap) {
      const pending = evaluation.etas.filter((e) => e.status !== 'passed');
      expect(pending.length).toBeGreaterThan(0);
      for (const eta of pending) {
        expect(eta.status).toBe('stale');
        expect(eta).not.toHaveProperty('predictedPassAt');
      }
      expect(evaluation.alerts).toEqual([]);
    }
    expect(
      resumed.etas.filter((e) => e.status !== 'passed').every((e) => e.status === 'live'),
    ).toBe(true);
  });

  it('does not advance on an off-route fix', () => {
    expect(run.offRouteResult.progressAfter).toBe(run.offRouteResult.progressBefore);
    expect(run.offRouteResult.events).toEqual([expect.objectContaining({ type: 'off_route' })]);
  });

  it('ignores a fix that arrives out of order', () => {
    expect(run.outOfOrder.events).toEqual([{ type: 'fix_ignored', reason: 'out_of_order' }]);
    expect(run.outOfOrder.stateUnchanged).toBe(true);
  });
});
