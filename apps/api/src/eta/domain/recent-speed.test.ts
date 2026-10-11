import { describe, expect, it } from 'vitest';

import { DEFAULT_ETA_SETTINGS } from './eta-settings.js';
import { INITIAL_RECENT_SPEED, observeProgress, type RecentSpeed } from './recent-speed.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
const sample = (chainage: number, seconds: number) => ({
  chainage,
  at: new Date(T0 + seconds * 1000),
});

function observeAll(samples: ReturnType<typeof sample>[]): RecentSpeed {
  return samples.reduce((estimate, s) => observeProgress(estimate, s), INITIAL_RECENT_SPEED);
}

describe('observeProgress', () => {
  it('has no speed until two samples exist', () => {
    expect(observeAll([sample(0, 0)]).speedMps).toBeNull();
  });

  it('starts at the first effective speed (progress delta over time)', () => {
    expect(observeAll([sample(0, 0), sample(40, 20)]).speedMps).toBeCloseTo(2, 10);
  });

  it('smooths toward new speeds with a time-based weight', () => {
    const speed = observeAll([sample(0, 0), sample(40, 20), sample(120, 40)]).speedMps!;

    // From 2 m/s toward 4 m/s with alpha = 1 - exp(-20 / 90).
    const alpha = 1 - Math.exp(-20 / DEFAULT_ETA_SETTINGS.recentSpeedTimeConstantSec);
    expect(speed).toBeCloseTo(2 + alpha * 2, 10);
  });

  it('decays toward the minimum speed while the truck is stopped', () => {
    const stops = [sample(0, 0), sample(40, 20)];
    for (let s = 40; s <= 600; s += 20) stops.push(sample(40, s));

    expect(observeAll(stops).speedMps).toBeCloseTo(DEFAULT_ETA_SETTINGS.minSpeedMps, 1);
    expect(observeAll(stops).speedMps).toBeGreaterThanOrEqual(DEFAULT_ETA_SETTINGS.minSpeedMps);
  });

  it('averages stops at zero speed, so stop-and-go is not biased upward', () => {
    // 40 s at 1.5 m/s, then 40 s stopped, repeated: the effective speed is 0.75 m/s.
    let estimate = observeProgress(INITIAL_RECENT_SPEED, sample(0, 0));
    let chainage = 0;
    const readings: number[] = [];
    for (let s = 20; s <= 3600; s += 20) {
      if (s % 80 === 20 || s % 80 === 40) chainage += 30;
      estimate = observeProgress(estimate, sample(chainage, s));
      readings.push(estimate.speedMps!);
    }

    const lastCycle = readings.slice(-4);
    const mean = lastCycle.reduce((sum, v) => sum + v, 0) / lastCycle.length;
    expect(mean).toBeCloseTo(0.75, 1);
  });

  it('clamps implausibly high speeds', () => {
    expect(observeAll([sample(0, 0), sample(1000, 20)]).speedMps).toBe(
      DEFAULT_ETA_SETTINGS.maxSpeedMps,
    );
  });

  it('ignores samples that do not move forward in time', () => {
    const estimate = observeAll([sample(0, 0), sample(40, 20)]);

    expect(observeProgress(estimate, sample(80, 20))).toBe(estimate);
  });
});
