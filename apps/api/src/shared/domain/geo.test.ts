import { describe, expect, it } from 'vitest';

import { createLocalProjection, haversineMeters, projectOntoSegment } from './geo.js';

describe('haversineMeters', () => {
  it('returns zero for the same point', () => {
    const p = { lat: -9.52, lon: -77.53 };

    expect(haversineMeters(p, p)).toBe(0);
  });

  it('measures one degree of latitude as about 111.2 km', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });

    expect(d).toBeCloseTo(111_195, -1);
  });

  it('measures the RI-01 P01 to P02 spacing as about 88 m', () => {
    const d = haversineMeters(
      { lat: -9.523207, lon: -77.528621 },
      { lat: -9.522446, lon: -77.528825 },
    );

    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(90);
  });
});

describe('createLocalProjection', () => {
  const origin = { lat: -9.52, lon: -77.53 };
  const projection = createLocalProjection(origin);

  it('maps the origin to (0, 0)', () => {
    expect(projection.toPlanar(origin)).toEqual({ x: 0, y: 0 });
  });

  it('agrees with haversine within 0.1% at city scale', () => {
    const p = { lat: -9.512746, lon: -77.531997 };
    const { x, y } = projection.toPlanar(p);

    const planar = Math.hypot(x, y);

    expect(Math.abs(planar - haversineMeters(origin, p)) / planar).toBeLessThan(0.001);
  });

  it('round-trips planar coordinates back to latitude and longitude', () => {
    const p = { lat: -9.515597, lon: -77.530669 };
    const back = projection.toLatLon(projection.toPlanar(p));

    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });

  it('points x east and y north', () => {
    const east = projection.toPlanar({ lat: origin.lat, lon: origin.lon + 0.001 });
    const north = projection.toPlanar({ lat: origin.lat + 0.001, lon: origin.lon });

    expect(east.x).toBeGreaterThan(0);
    expect(north.y).toBeGreaterThan(0);
  });
});

describe('projectOntoSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('projects a point beside the segment onto its interior', () => {
    expect(projectOntoSegment({ x: 40, y: 30 }, a, b)).toEqual({
      t: 0.4,
      distance: 30,
      point: { x: 40, y: 0 },
    });
  });

  it('clamps to the start before the segment', () => {
    const result = projectOntoSegment({ x: -30, y: 40 }, a, b);

    expect(result.t).toBe(0);
    expect(result.distance).toBe(50);
  });

  it('clamps to the end after the segment', () => {
    const result = projectOntoSegment({ x: 130, y: 0 }, a, b);

    expect(result.t).toBe(1);
    expect(result.distance).toBe(30);
  });

  it('honours a narrower parameter range', () => {
    const result = projectOntoSegment({ x: 90, y: 0 }, a, b, { min: 0, max: 0.5 });

    expect(result.t).toBe(0.5);
    expect(result.distance).toBe(40);
  });

  it('treats a zero-length segment as a point', () => {
    const result = projectOntoSegment({ x: 3, y: 4 }, a, a);

    expect(result).toEqual({ t: 0, distance: 5, point: a });
  });
});
