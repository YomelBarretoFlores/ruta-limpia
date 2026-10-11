import { describe, expect, it } from 'vitest';

import { RI01_REFERENCE_POINTS, RI01_ROUTE } from './ri01.fixture.js';
import { locateReferencePoints } from './reference-points.js';
import { buildRouteGeometry, positionAtChainage } from './route-geometry.js';

const geometry = buildRouteGeometry(RI01_ROUTE.polyline);

describe('locateReferencePoints', () => {
  it('locates P01–P15 in order, about 30 m to 1.26 km along RI-01 and on the line', () => {
    const located = locateReferencePoints(geometry, RI01_REFERENCE_POINTS);

    expect(located.map((p) => p.code)).toEqual(RI01_REFERENCE_POINTS.map((p) => p.code));
    expect(located[0]!.chainage).toBeCloseTo(30, -1);
    expect(located.at(-1)!.chainage).toBeCloseTo(geometry.lengthMeters - 30, -1);
    for (let i = 1; i < located.length; i++) {
      expect(located[i]!.chainage).toBeGreaterThan(located[i - 1]!.chainage);
    }
    for (const point of located) {
      expect(point.offsetMeters).toBeLessThan(0.5);
    }
  });

  it('sorts by declared sequence before checking the order', () => {
    const shuffled = [...RI01_REFERENCE_POINTS].reverse();

    const located = locateReferencePoints(geometry, shuffled);

    expect(located[0]!.code).toBe('P01');
  });

  it('rejects a point farther from the route than the configured offset', () => {
    const near = positionAtChainage(geometry, 400);
    const far = { ...RI01_REFERENCE_POINTS[0]!, lat: near.lat, lon: near.lon + 0.0006 }; // ~66 m

    expect(() => locateReferencePoints(geometry, [far])).toThrow(
      expect.objectContaining({ code: 'point_off_route', pointId: far.id }),
    );
    expect(locateReferencePoints(geometry, [far], { maxPointOffsetMeters: 80 })).toHaveLength(1);
  });

  it('rejects points whose chainage contradicts their declared order', () => {
    const [p1, p2] = RI01_REFERENCE_POINTS;
    const swapped = [
      { ...p1!, sequence: 2 },
      { ...p2!, sequence: 1 },
    ];

    expect(() => locateReferencePoints(geometry, swapped)).toThrow(
      expect.objectContaining({ code: 'point_order_mismatch', pointId: p1!.id }),
    );
  });
});
