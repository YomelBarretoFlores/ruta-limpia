import { describe, expect, it } from 'vitest';

import type { PointEta } from '../../eta/domain/eta-estimator.js';
import { decideAlerts, etaErrorMinutes } from './alert-policy.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
const now = new Date(T0);
const live = (pointId: string, secondsRemaining: number): PointEta => ({
  pointId,
  status: 'live',
  predictedPassAt: new Date(T0 + secondsRemaining * 1000),
  secondsRemaining,
});

describe('decideAlerts', () => {
  it('alerts a live point whose ETA is within 10 min, recording what was communicated', () => {
    const decisions = decideAlerts({
      tripId: 'trip-1',
      now,
      etas: [live('p1', 540)],
      alreadyAlertedPointIds: [],
    });

    expect(decisions).toEqual([
      {
        tripId: 'trip-1',
        pointId: 'p1',
        emittedAt: now,
        communicatedPredictedPassAt: new Date(T0 + 540_000),
        secondsRemainingAtEmission: 540,
        insideTargetWindow: true,
      },
    ]);
  });

  it('waits while the ETA is still more than 10 min away', () => {
    expect(
      decideAlerts({ tripId: 't', now, etas: [live('p1', 601)], alreadyAlertedPointIds: [] }),
    ).toEqual([]);
  });

  it('skips alerts that would arrive too late to be useful (under 1 min)', () => {
    expect(
      decideAlerts({ tripId: 't', now, etas: [live('p1', 59)], alreadyAlertedPointIds: [] }),
    ).toEqual([]);
  });

  it('flags alerts sent outside the 5–10 min target window for analysis', () => {
    const [decision] = decideAlerts({
      tripId: 't',
      now,
      etas: [live('p1', 200)],
      alreadyAlertedPointIds: [],
    });

    expect(decision).toMatchObject({ pointId: 'p1', insideTargetWindow: false });
  });

  it('alerts each point at most once per trip', () => {
    expect(
      decideAlerts({ tripId: 't', now, etas: [live('p1', 500)], alreadyAlertedPointIds: ['p1'] }),
    ).toEqual([]);
  });

  it('never alerts on stale, passed or not-started points', () => {
    const etas: PointEta[] = [
      { pointId: 'p1', status: 'stale' },
      { pointId: 'p2', status: 'passed' },
      { pointId: 'p3', status: 'not_started' },
    ];

    expect(decideAlerts({ tripId: 't', now, etas, alreadyAlertedPointIds: [] })).toEqual([]);
  });

  it('honours custom lead times', () => {
    const decisions = decideAlerts(
      { tripId: 't', now, etas: [live('p1', 700)], alreadyAlertedPointIds: [] },
      { leadMinSec: 60, leadMaxSec: 900, targetWindowMinSec: 300, targetWindowMaxSec: 600 },
    );

    expect(decisions).toHaveLength(1);
  });
});

describe('etaErrorMinutes', () => {
  it('is the absolute difference between communicated and actual pass time, in minutes', () => {
    const predicted = new Date(T0);

    expect(etaErrorMinutes(predicted, new Date(T0 + 150_000))).toBe(2.5);
    expect(etaErrorMinutes(predicted, new Date(T0 - 90_000))).toBe(1.5);
  });
});
