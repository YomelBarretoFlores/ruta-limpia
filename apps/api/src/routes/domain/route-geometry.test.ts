import { describe, expect, it } from 'vitest';

import { haversineMeters } from '../../shared/domain/geo.js';
import { RI01_POINT_COORDINATES, RI01_ROUTE } from './ri01.fixture.js';
import { RouteValidationError } from './route-validation-error.js';
import { buildRouteGeometry, positionAtChainage, projectOntoRoute } from './route-geometry.js';

const geometry = buildRouteGeometry(RI01_ROUTE.polyline);

describe('buildRouteGeometry', () => {
  it('measures RI-01 as the sum of its legs (about 1.3 km)', () => {
    let expected = 0;
    for (let i = 1; i < RI01_ROUTE.polyline.length; i++) {
      expected += haversineMeters(RI01_ROUTE.polyline[i - 1]!, RI01_ROUTE.polyline[i]!);
    }

    expect(geometry.lengthMeters).toBeCloseTo(expected, 0);
    expect(geometry.lengthMeters).toBeGreaterThan(1200);
    expect(geometry.lengthMeters).toBeLessThan(1400);
  });

  it('extends the fixture about 30 m before P01 and after P15', () => {
    const first = RI01_POINT_COORDINATES[0]!;
    const last = RI01_POINT_COORDINATES[RI01_POINT_COORDINATES.length - 1]!;

    expect(haversineMeters(RI01_ROUTE.polyline[0]!, first)).toBeCloseTo(30, -1);
    expect(haversineMeters(last, RI01_ROUTE.polyline.at(-1)!)).toBeCloseTo(30, -1);
  });

  it('rejects a route with fewer than two vertices', () => {
    expect(() => buildRouteGeometry([{ lat: -9.52, lon: -77.53 }])).toThrow(
      expect.objectContaining({ code: 'degenerate_route' }),
    );
  });

  it('rejects a route with zero length', () => {
    const p = { lat: -9.52, lon: -77.53 };

    expect(() => buildRouteGeometry([p, p])).toThrow(RouteValidationError);
  });
});

describe('projectOntoRoute', () => {
  it('returns chainage and lateral offset for a point beside the route', () => {
    const atTwoHundred = positionAtChainage(geometry, 200);
    const shifted = { lat: atTwoHundred.lat, lon: atTwoHundred.lon + 0.0002 }; // ~22 m east

    const result = projectOntoRoute(geometry, shifted);

    expect(result).not.toBeNull();
    expect(result!.chainage).toBeGreaterThan(190);
    expect(result!.chainage).toBeLessThan(210);
    expect(result!.offsetMeters).toBeGreaterThan(15);
    expect(result!.offsetMeters).toBeLessThan(25);
  });

  it('restricts candidates to a chainage window', () => {
    const atNineHundred = positionAtChainage(geometry, 900);

    const result = projectOntoRoute(geometry, atNineHundred, { from: 0, to: 500 });

    expect(result!.chainage).toBeCloseTo(500, 6);
    expect(result!.offsetMeters).toBeCloseTo(400, -1);
  });

  it('returns null when the window misses the route', () => {
    expect(
      projectOntoRoute(geometry, RI01_ROUTE.polyline[0]!, { from: 5000, to: 6000 }),
    ).toBeNull();
  });

  it('disambiguates an out-and-back route through the window', () => {
    const outAndBack = buildRouteGeometry([
      { lat: -9.52, lon: -77.53 },
      { lat: -9.519, lon: -77.53 },
      { lat: -9.52, lon: -77.53 },
    ]);
    const leg = outAndBack.lengthMeters / 2;
    const p = positionAtChainage(outAndBack, leg / 2);

    expect(projectOntoRoute(outAndBack, p, { from: 0, to: leg })!.chainage).toBeCloseTo(leg / 2, 3);
    expect(projectOntoRoute(outAndBack, p, { from: leg, to: 2 * leg })!.chainage).toBeCloseTo(
      1.5 * leg,
      3,
    );
  });
});

describe('positionAtChainage', () => {
  it('returns the route ends at 0 and at full length', () => {
    const start = positionAtChainage(geometry, 0);
    const end = positionAtChainage(geometry, geometry.lengthMeters);

    expect(haversineMeters(start, RI01_ROUTE.polyline[0]!)).toBeLessThan(0.01);
    expect(haversineMeters(end, RI01_ROUTE.polyline.at(-1)!)).toBeLessThan(0.01);
  });

  it('is the inverse of projection along the route', () => {
    const p = positionAtChainage(geometry, 777);

    expect(projectOntoRoute(geometry, p)!.chainage).toBeCloseTo(777, 3);
  });

  it('clamps chainage outside the route', () => {
    expect(positionAtChainage(geometry, -50)).toEqual(positionAtChainage(geometry, 0));
  });
});
