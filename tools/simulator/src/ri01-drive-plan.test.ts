import { describe, expect, it } from 'vitest';

import { KNOTS_PER_MPS, planRi01Drive, RI01_LENGTH_METERS, RI01_STOPS } from './ri01-drive-plan.js';

const START = new Date('2026-10-20T12:05:00Z');

describe('planRi01Drive', () => {
  const plan = planRi01Drive({ startAt: START });

  it('reports every 20 s by default, from the route start to its end', () => {
    expect(plan.fixes[0]).toMatchObject({ offsetSec: 0, chainage: 0 });
    expect(plan.fixes[0]?.at).toEqual(START);
    const gaps = plan.fixes.slice(1).map((fix, i) => fix.offsetSec - plan.fixes[i]!.offsetSec);
    expect(gaps.slice(0, -1).every((gap) => gap === 20)).toBe(true);
    expect(gaps.at(-1)).toBeLessThanOrEqual(20);
    expect(plan.fixes.at(-1)?.chainage).toBeCloseTo(RI01_LENGTH_METERS, 6);
    expect(plan.fixes.at(-1)?.offsetSec).toBe(plan.durationSec);
  });

  it('stops at each of the 15 points for the dwell time, reporting speed 0 there', () => {
    expect(RI01_STOPS.map((stop) => stop.code)).toEqual(
      Array.from({ length: 15 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`),
    );
    const cruise = 3.5;
    const moving = RI01_LENGTH_METERS / cruise;
    expect(plan.durationSec).toBe(Math.ceil(moving + 15 * 40));

    const p05 = RI01_STOPS[4]!;
    const atP05 = plan.fixes.filter((fix) => Math.abs(fix.chainage - p05.chainage) < 1e-6);
    expect(atP05.length).toBeGreaterThanOrEqual(1);
    expect(atP05.every((fix) => fix.speedKnots === 0)).toBe(true);
  });

  it('reports the moving speed in knots, and progress that never goes back', () => {
    const movingFix = plan.fixes.find((fix) => fix.speedKnots > 0);
    expect(movingFix?.speedKnots).toBeCloseTo(3.5 * KNOTS_PER_MPS, 6);
    for (let i = 1; i < plan.fixes.length; i++) {
      expect(plan.fixes[i]!.chainage).toBeGreaterThanOrEqual(plan.fixes[i - 1]!.chainage);
    }
  });

  it('heads north-north-west along Av. Centenario', () => {
    const bearing = plan.fixes[1]!.bearing;
    expect(bearing).toBeGreaterThan(330);
    expect(bearing).toBeLessThan(360);
  });

  it('leaves out the fixes of a signal gap', () => {
    const gapped = planRi01Drive({ startAt: START, gap: { atSec: 200, durationSec: 90 } });
    const offsets = gapped.fixes.map((fix) => fix.offsetSec);

    expect(offsets.filter((s) => s >= 200 && s < 290)).toEqual([]);
    expect(offsets).toContain(180);
    expect(offsets).toContain(300);
    expect(gapped.skipped).toBe(5);
  });

  it('always keeps the fix at the route end, even inside a gap, so the trip can complete', () => {
    const gapped = planRi01Drive({
      startAt: START,
      gap: { atSec: plan.durationSec - 60, durationSec: 600 },
    });

    expect(gapped.fixes.at(-1)).toMatchObject({ offsetSec: plan.durationSec });
    expect(gapped.fixes.at(-2)!.offsetSec).toBeLessThan(plan.durationSec - 60);
  });

  it('refuses a gap that is not a finite, non-negative number of seconds', () => {
    for (const gap of [
      { atSec: Number.NaN, durationSec: 90 },
      { atSec: 200, durationSec: Number.NaN },
      { atSec: -1, durationSec: 90 },
      { atSec: 200, durationSec: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => planRi01Drive({ startAt: START, gap })).toThrow(/gap/);
    }
  });

  it('adds repeatable GPS noise within the radius, and reports it as the accuracy', () => {
    const noisy = planRi01Drive({ startAt: START, noiseMeters: 8, seed: 7 });
    const again = planRi01Drive({ startAt: START, noiseMeters: 8, seed: 7 });

    expect(noisy.fixes).toEqual(again.fixes);
    expect(noisy.fixes[3]!.lat).not.toBe(plan.fixes[3]!.lat);
    expect(noisy.fixes.every((fix) => fix.accuracy === 13)).toBe(true);
    const metersPerDegree = 111_320;
    for (const [i, fix] of noisy.fixes.entries()) {
      const clean = plan.fixes[i]!;
      const dLat = (fix.lat - clean.lat) * metersPerDegree;
      const dLon = (fix.lon - clean.lon) * metersPerDegree * Math.cos((clean.lat * Math.PI) / 180);
      expect(Math.hypot(dLat, dLon)).toBeLessThanOrEqual(8.01);
    }
  });

  it('accepts only report intervals of 15 to 30 s, like the pilot trackers', () => {
    expect(() => planRi01Drive({ startAt: START, intervalSec: 10 })).toThrow(/15 and 30/);
    expect(planRi01Drive({ startAt: START, intervalSec: 30 }).fixes[1]?.offsetSec).toBe(30);
  });
});
