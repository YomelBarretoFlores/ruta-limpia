import { describe, expect, it } from 'vitest';

import { RI01_SNAPSHOT } from '../../../test/support/ri01-tracking.js';
import type { LiveTripView } from './live-views.js';
import { panelAlertStatus, toPanelPoints } from './panel-live-views.js';

const [p01, p02, p03, p04] = RI01_SNAPSHOT.points;
const AT = '2026-10-20T12:10:00.000Z';

const trip: LiveTripView = {
  tripId: 'trip-1',
  startedAt: AT,
  startMode: 'auto',
  vehicle: { code: 'UNIDAD-A', label: 'Unidad A' },
  signal: 'live',
  lastFixAt: AT,
  lastPosition: null,
  progress: { chainageMeters: 150, percent: 11.7, offRoute: false },
  etas: [
    { pointId: p01!.id, pointCode: 'P01', status: 'passed' },
    { pointId: p02!.id, pointCode: 'P02', status: 'passed' },
    {
      pointId: p03!.id,
      pointCode: 'P03',
      status: 'live',
      predictedPassAt: AT,
      secondsRemaining: 400,
      window: { minMinutes: 5, maxMinutes: 8 },
    },
    { pointId: p04!.id, pointCode: 'P04', status: 'stale' },
  ],
  passes: [
    { pointId: p01!.id, pointCode: 'P01', passedAt: AT, precision: 'interpolated' },
    { pointId: p02!.id, pointCode: 'P02', passedAt: AT, precision: 'interpolated' },
  ],
  alerts: [
    {
      pointId: p02!.id,
      pointCode: 'P02',
      emittedAt: AT,
      communicatedPredictedPassAt: AT,
      recipients: 3,
      delivered: 2,
    },
  ],
};

describe('panel alert status', () => {
  it('is sent with an alert, not sent when passed without one, preparing on a live ETA, else waiting', () => {
    expect(panelAlertStatus({ alert: trip.alerts[0], pass: trip.passes[1], eta: undefined })).toBe(
      'sent',
    );
    expect(panelAlertStatus({ alert: undefined, pass: trip.passes[0], eta: undefined })).toBe(
      'not_sent',
    );
    expect(panelAlertStatus({ alert: undefined, pass: undefined, eta: trip.etas[2] })).toBe(
      'preparing',
    );
    expect(panelAlertStatus({ alert: undefined, pass: undefined, eta: trip.etas[3] })).toBe(
      'waiting',
    );
    expect(panelAlertStatus({ alert: undefined, pass: undefined, eta: undefined })).toBe('waiting');
  });
});

describe('toPanelPoints', () => {
  it('lists every point in sequence with its status and delivery counts', () => {
    const points = toPanelPoints(trip, RI01_SNAPSHOT, [
      {
        tripId: 'trip-1',
        pointId: p02!.id,
        recipients: 3,
        delivered: 2,
        receiptsReceived: 1,
        failed: 1,
      },
      {
        tripId: 'other',
        pointId: p02!.id,
        recipients: 9,
        delivered: 9,
        receiptsReceived: 9,
        failed: 0,
      },
    ]);

    expect(points).toHaveLength(15);
    expect(points.slice(0, 5).map((p) => [p.pointCode, p.alertStatus])).toEqual([
      ['P01', 'not_sent'],
      ['P02', 'sent'],
      ['P03', 'preparing'],
      ['P04', 'waiting'],
      ['P05', 'waiting'],
    ]);
    expect(points[1]?.alert).toEqual({
      emittedAt: AT,
      communicatedPredictedPassAt: AT,
      recipients: 3,
      delivered: 2,
      receiptsReceived: 1,
      failed: 1,
    });
    expect(points[0]).toMatchObject({ passedAt: AT, alert: null });
    expect(points[4]).toMatchObject({ eta: null, passedAt: null });
  });
});
