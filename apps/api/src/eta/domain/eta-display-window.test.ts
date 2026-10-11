import { describe, expect, it } from 'vitest';

import { etaDisplayWindow } from './eta-display-window.js';

describe('etaDisplayWindow', () => {
  it.each([
    [600, 8, 12],
    [300, 4, 6],
    [120, 1, 3],
    [1800, 24, 36],
    [45, 0, 2],
    [0, 0, 1],
  ])('shows %i s remaining as %i to %i minutes', (seconds, minMinutes, maxMinutes) => {
    expect(etaDisplayWindow(seconds)).toEqual({ minMinutes, maxMinutes });
  });

  it('widens the window as the truck gets farther', () => {
    const widths = [60, 300, 900, 1800, 3600].map((s) => {
      const window = etaDisplayWindow(s);
      return window.maxMinutes - window.minMinutes;
    });

    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(widths.at(-1)).toBeGreaterThan(widths[0]!);
  });

  it('keeps at least one minute on each side of a near prediction', () => {
    const window = etaDisplayWindow(150);

    expect(window.minMinutes).toBeLessThanOrEqual(1);
    expect(window.maxMinutes).toBeGreaterThanOrEqual(4);
  });

  it('treats a negative remaining time as zero', () => {
    expect(etaDisplayWindow(-30)).toEqual({ minMinutes: 0, maxMinutes: 1 });
  });

  it('accepts custom uncertainty settings', () => {
    expect(etaDisplayWindow(600, { minUncertaintySec: 30, relativeUncertainty: 0.1 })).toEqual({
      minMinutes: 9,
      maxMinutes: 11,
    });
  });
});
