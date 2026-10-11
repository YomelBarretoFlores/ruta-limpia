import { describe, expect, it } from 'vitest';

import { knotsToKmh } from './position-fix.js';
import { abortTrip, isInactive, startTrip } from './trip.js';

describe('knotsToKmh', () => {
  it('converts Traccar knots to km/h', () => {
    expect(knotsToKmh(10)).toBeCloseTo(18.52, 10);
    expect(knotsToKmh(0)).toBe(0);
  });
});

describe('startTrip', () => {
  it('opens an active trip with no progress measured yet', () => {
    expect(startTrip('trip-1')).toEqual({
      tripId: 'trip-1',
      status: 'active',
      progressChainage: 0,
      progressAt: null,
      lastFixAt: null,
      offRoute: false,
      passedPointIds: [],
      endedAt: null,
    });
  });
});

describe('abortTrip', () => {
  it('closes an active trip as aborted at the given time', () => {
    const at = new Date('2026-10-20T07:00:00Z');

    const aborted = abortTrip(startTrip('trip-1'), at);

    expect(aborted.status).toBe('aborted');
    expect(aborted.endedAt).toEqual(at);
  });

  it('leaves an already closed trip unchanged', () => {
    const aborted = abortTrip(startTrip('trip-1'), new Date('2026-10-20T07:00:00Z'));

    expect(abortTrip(aborted, new Date('2026-10-20T08:00:00Z'))).toBe(aborted);
  });
});

describe('isInactive', () => {
  const lastFixAt = new Date('2026-10-20T07:00:00Z');

  it('is false within the timeout (30 min by default)', () => {
    expect(isInactive(lastFixAt, new Date('2026-10-20T07:30:00Z'))).toBe(false);
  });

  it('is true once the timeout has elapsed', () => {
    expect(isInactive(lastFixAt, new Date('2026-10-20T07:30:01Z'))).toBe(true);
  });

  it('accepts a custom timeout', () => {
    expect(isInactive(lastFixAt, new Date('2026-10-20T07:05:01Z'), 300)).toBe(true);
  });
});
