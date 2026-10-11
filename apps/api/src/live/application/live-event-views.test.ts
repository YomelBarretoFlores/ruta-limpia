import { describe, expect, it } from 'vitest';

import { RI01_SNAPSHOT } from '../../../test/support/ri01-tracking.js';
import type { TrackingEvents } from '../../tracking/application/tracking-events.js';
import { streamedRoute, toLiveStreamEvent } from './live-event-views.js';

const route = streamedRoute(RI01_SNAPSHOT, 60);
const OTHER = 'route-other';
const AT = new Date('2026-10-20T12:10:00Z');
const p08 = RI01_SNAPSHOT.points[7]!;

const position: TrackingEvents['vehicle.position'] = {
  vehicleId: 'vehicle-uuid',
  vehicleCode: 'UNIDAD-A',
  tripId: 'trip-1',
  routeId: RI01_SNAPSHOT.id,
  fixTime: AT,
  lat: -9.52,
  lon: -77.53,
  speedKmh: 5.4,
  course: 340,
  valid: true,
};

describe('toLiveStreamEvent', () => {
  it('maps a position of the route without the vehicle id', () => {
    expect(toLiveStreamEvent('vehicle.position', position, route)).toEqual({
      event: 'vehicle.position',
      data: {
        tripId: 'trip-1',
        vehicleCode: 'UNIDAD-A',
        fixTime: '2026-10-20T12:10:00.000Z',
        lat: -9.52,
        lon: -77.53,
        speedKmh: 5.4,
        course: 340,
      },
    });
  });

  it.each([
    ['another route', { routeId: OTHER }],
    ['no trip', { tripId: null, routeId: null }],
    ['an invalid fix', { valid: false }],
  ])('drops a position of %s', (_case, overrides) => {
    expect(toLiveStreamEvent('vehicle.position', { ...position, ...overrides }, route)).toBeNull();
  });

  it('maps ETAs with their signal, codes and windows, never a stale prediction', () => {
    const event = toLiveStreamEvent(
      'eta.updated',
      {
        tripId: 'trip-1',
        routeId: RI01_SNAPSHOT.id,
        vehicleId: 'vehicle-uuid',
        computedAt: AT,
        lastFixAt: new Date(AT.getTime() - 61_000),
        etas: [
          { pointId: p08.id, status: 'stale' },
          {
            pointId: RI01_SNAPSHOT.points[8]!.id,
            status: 'live',
            predictedPassAt: new Date(AT.getTime() + 300_000),
            secondsRemaining: 300,
          },
        ],
      },
      route,
    );

    expect(event).toEqual({
      event: 'eta.updated',
      data: {
        tripId: 'trip-1',
        computedAt: '2026-10-20T12:10:00.000Z',
        lastFixAt: '2026-10-20T12:08:59.000Z',
        signal: 'stale',
        etas: [
          { pointId: p08.id, pointCode: 'P08', status: 'stale' },
          {
            pointId: RI01_SNAPSHOT.points[8]!.id,
            pointCode: 'P09',
            status: 'live',
            predictedPassAt: '2026-10-20T12:15:00.000Z',
            secondsRemaining: 300,
            window: { minMinutes: 4, maxMinutes: 6 },
          },
        ],
      },
    });
    expect(JSON.stringify(event)).not.toContain('vehicle-uuid');
  });

  it('maps passes, trip starts and ends', () => {
    expect(
      toLiveStreamEvent(
        'point.passed',
        {
          tripId: 'trip-1',
          routeId: RI01_SNAPSHOT.id,
          pointId: p08.id,
          passedAt: AT,
          precision: 'interpolated',
        },
        route,
      ),
    ).toEqual({
      event: 'point.passed',
      data: {
        tripId: 'trip-1',
        pointId: p08.id,
        pointCode: 'P08',
        passedAt: '2026-10-20T12:10:00.000Z',
        precision: 'interpolated',
      },
    });
    expect(
      toLiveStreamEvent(
        'trip.started',
        {
          tripId: 'trip-1',
          routeId: RI01_SNAPSHOT.id,
          vehicleId: 'vehicle-uuid',
          startMode: 'auto',
          startedAt: AT,
        },
        route,
      )?.data,
    ).toEqual({ tripId: 'trip-1', startedAt: '2026-10-20T12:10:00.000Z', startMode: 'auto' });
    expect(
      toLiveStreamEvent(
        'trip.completed',
        {
          tripId: 'trip-1',
          routeId: RI01_SNAPSHOT.id,
          vehicleId: 'vehicle-uuid',
          status: 'aborted',
          endedAt: AT,
          endReason: 'inactivity',
        },
        route,
      )?.data,
    ).toEqual({
      tripId: 'trip-1',
      status: 'aborted',
      endedAt: '2026-10-20T12:10:00.000Z',
      endReason: 'inactivity',
    });
  });

  it('maps an alert without its id or delivery data', () => {
    const event = toLiveStreamEvent(
      'alert.emitted',
      {
        alertId: 'alert-uuid',
        tripId: 'trip-1',
        routeId: RI01_SNAPSHOT.id,
        pointId: p08.id,
        emittedAt: AT,
        communicatedPredictedPassAt: new Date(AT.getTime() + 420_000),
        secondsRemainingAtEmission: 420,
        insideTargetWindow: true,
      },
      route,
    );

    expect(event?.data).toEqual({
      tripId: 'trip-1',
      pointId: p08.id,
      pointCode: 'P08',
      emittedAt: '2026-10-20T12:10:00.000Z',
      communicatedPredictedPassAt: '2026-10-20T12:17:00.000Z',
    });
  });

  it('drops events of other routes and of points no longer on the route', () => {
    const pass = {
      tripId: 'trip-1',
      routeId: RI01_SNAPSHOT.id,
      pointId: 'retired-point',
      passedAt: AT,
      precision: 'interpolated' as const,
    };

    expect(toLiveStreamEvent('point.passed', pass, route)).toBeNull();
    expect(
      toLiveStreamEvent('point.passed', { ...pass, pointId: p08.id, routeId: OTHER }, route),
    ).toBeNull();
    expect(
      toLiveStreamEvent(
        'trip.started',
        { tripId: 't', routeId: OTHER, vehicleId: 'v', startMode: 'manual', startedAt: AT },
        route,
      ),
    ).toBeNull();
  });
});
