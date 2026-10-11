import { describe, expect, it } from 'vitest';

import {
  mcnemarExact,
  median,
  percentage,
  pointsChange,
  ratio,
  relativeChange,
  wilcoxonSignedRank,
} from './statistics.js';

describe('median and proportions', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([7, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(3.5);
    expect(median([])).toBeNull();
  });

  it('answers null for an empty denominator', () => {
    expect(percentage(3, 4)).toBe(75);
    expect(percentage(0, 0)).toBeNull();
    expect(ratio(3, 12)).toBe(0.25);
    expect(ratio(1, 0)).toBeNull();
  });
});

describe('change between phases', () => {
  it('is relative to the baseline, negative for a reduction', () => {
    expect(relativeChange(40, 28)).toEqual({ kind: 'relative', percent: -30 });
    expect(relativeChange(10, 15)).toEqual({ kind: 'relative', percent: 50 });
  });

  it('is absolute when the baseline is zero, and null without both values', () => {
    expect(relativeChange(0, 0.25)).toEqual({ kind: 'absolute', difference: 0.25 });
    expect(relativeChange(null, 3)).toBeNull();
    expect(relativeChange(3, null)).toBeNull();
  });

  it('compares proportions in percentage points', () => {
    expect(pointsChange(20, 55)).toEqual({ kind: 'points', difference: 35 });
    expect(pointsChange(null, 55)).toBeNull();
  });
});

describe('McNemar exact test', () => {
  // Reference values: scipy.stats.binomtest(k, n, 0.5).pvalue (two-sided).
  it('matches the exact binomial p-value of the discordant pairs', () => {
    expect(mcnemarExact(2, 9).pValue).toBeCloseTo(0.0654296875, 10);
    expect(mcnemarExact(0, 3).pValue).toBeCloseTo(0.25, 10);
    expect(mcnemarExact(5, 5).pValue).toBe(1);
  });

  it('has no p-value without discordant pairs', () => {
    expect(mcnemarExact(0, 0)).toEqual({ yesToNo: 0, noToYes: 0, pValue: null });
  });

  it('stays finite for many pairs', () => {
    expect(mcnemarExact(700, 700).pValue).toBeCloseTo(1, 6);
  });
});

describe('Wilcoxon signed-rank test', () => {
  // Reference values: scipy.stats.wilcoxon (scipy 1.17).
  it('is exact without ties (method="exact")', () => {
    const result = wilcoxonSignedRank([1.5, -0.5, 2.0, 3.0, -1.0, 4.0, 2.5, 0.8]);

    expect(result).toMatchObject({
      n: 8,
      positiveRankSum: 32,
      negativeRankSum: 4,
      statistic: 4,
      method: 'exact',
    });
    expect(result.pValue).toBeCloseTo(0.0546875, 10);
    expect(wilcoxonSignedRank([-3, -1, -4, -2, -5]).pValue).toBeCloseTo(0.0625, 10);
  });

  it('drops zeros and uses the normal approximation with ties (method="approx", correction)', () => {
    const result = wilcoxonSignedRank([2, -1, 2, 0, 3, -2, 1, 4, 2, 0, 5, -1]);

    expect(result).toMatchObject({ n: 10, statistic: 9.5, method: 'normal' });
    expect(result.pValue).toBeCloseTo(0.07182815632096821, 5);
  });

  it('has no p-value when every difference is zero', () => {
    expect(wilcoxonSignedRank([0, 0])).toMatchObject({ n: 0, pValue: null });
  });
});
