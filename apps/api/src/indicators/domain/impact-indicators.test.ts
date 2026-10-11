import { describe, expect, it } from 'vitest';

import {
  computeIndicators,
  statusOf,
  type IndicatorId,
  type IndicatorInputs,
  type IndicatorResult,
  type ObservationRow,
  type SurveyRow,
} from './impact-indicators.js';

const NONE: IndicatorInputs = {
  etaErrors: [],
  observations: [],
  surveys: [],
  adoptionWeeks: [],
  activeHouseholdIds: [],
  availability: { intervals: 0, available: 0 },
};

function sheet(overrides: Partial<ObservationRow>): ObservationRow {
  return {
    pointCode: 'P01',
    phase: 'baseline',
    observesMusic: false,
    exposureMinutes: null,
    exposureIncomplete: false,
    dispersion: null,
    brokenBags: null,
    wasteRemainingAfterPass: null,
    musicSeconds: null,
    comparableWindow: null,
    ...overrides,
  };
}

function survey(householdId: string, wave: 'pre' | 'post', overrides: Partial<SurveyRow>) {
  return {
    householdId,
    wave,
    leadTime: null,
    satisfaction: null,
    annoyance: null,
    notHeard: false,
    ...overrides,
  } satisfies SurveyRow;
}

function indicator(inputs: Partial<IndicatorInputs>, id: IndicatorId): IndicatorResult {
  const found = computeIndicators({ ...NONE, ...inputs }).find((i) => i.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
}

describe('impact indicators', () => {
  it('lists the nine indicators of Tabla 16 with their targets, without data', () => {
    const all = computeIndicators(NONE);

    expect(all.map((i) => [i.id, i.status])).toEqual([
      ['I1', 'no_data'],
      ['I2', 'no_data'],
      ['I3', 'no_data'],
      ['I4', 'no_data'],
      ['I5', 'no_data'],
      ['I6', 'no_data'],
      ['I7', 'no_data'],
      ['I8', 'no_data'],
      ['I9', 'exploratory'],
    ]);
    expect(all[0]).toMatchObject({
      name: 'Precisión del ETA',
      target: { kind: 'at_most', value: 5 },
    });
  });

  it('I1: the median error of the alerts sent; point-trips without an alert are missing', () => {
    const i1 = indicator(
      {
        etaErrors: [
          { pointCode: 'P01', absErrorMinutes: 2 },
          { pointCode: 'P01', absErrorMinutes: 7 },
          { pointCode: 'P02', absErrorMinutes: 4 },
          { pointCode: 'P02', absErrorMinutes: null },
        ],
      },
      'I1',
    );

    expect(i1).toMatchObject({ value: 4, nValid: 3, nMissing: 1, status: 'met' });
    expect(i1.byPoint).toEqual([
      {
        pointCode: 'P01',
        before: null,
        after: { value: 4.5, nValid: 2, nMissing: 0, nIncomplete: 0 },
        change: null,
      },
      {
        pointCode: 'P02',
        before: null,
        after: { value: 4, nValid: 1, nMissing: 1, nIncomplete: 0 },
        change: null,
      },
    ]);
  });

  it('I2: baseline and post medians, incomplete exposures apart, paired by point', () => {
    const i2 = indicator(
      {
        observations: [
          sheet({ pointCode: 'P01', exposureMinutes: 60 }),
          sheet({ pointCode: 'P01', exposureMinutes: 80 }),
          sheet({ pointCode: 'P02', exposureMinutes: 100 }),
          sheet({ pointCode: 'P02', exposureMinutes: 30, exposureIncomplete: true }),
          sheet({ pointCode: 'P02' }),
          sheet({ pointCode: 'P01', phase: 'intervention', exposureMinutes: 5 }),
          sheet({ pointCode: 'P01', phase: 'post', exposureMinutes: 40 }),
          sheet({ pointCode: 'P02', phase: 'post', exposureMinutes: 50 }),
        ],
      },
      'I2',
    );

    expect(i2.before).toEqual({ value: 80, nValid: 3, nMissing: 1, nIncomplete: 1 });
    expect(i2.after).toEqual({ value: 45, nValid: 2, nMissing: 0, nIncomplete: 0 });
    expect(i2).toMatchObject({ value: 45, nValid: 5, nMissing: 1, nIncomplete: 1, status: 'met' });
    expect(i2.change).toEqual({ kind: 'relative', percent: -43.75 });
    // P01: 70 → 40, P02: 100 → 50.
    expect(i2.paired).toMatchObject({ kind: 'wilcoxon', pairs: 2, n: 2, negativeRankSum: 3 });
    expect(i2.byPoint.map((p) => [p.pointCode, p.change])).toEqual([
      ['P01', { kind: 'relative', percent: (100 * (40 - 70)) / 70 }],
      ['P02', { kind: 'relative', percent: -50 }],
    ]);
  });

  it('I3: events per valid point-trip; a non-comparable window and a zero baseline', () => {
    const i3 = indicator(
      {
        observations: [
          sheet({ dispersion: 'none', brokenBags: 0, wasteRemainingAfterPass: false }),
          sheet({ dispersion: 'none', brokenBags: 2 }),
          sheet({}),
          sheet({ phase: 'post', dispersion: 'few', wasteRemainingAfterPass: true }),
          sheet({ phase: 'post', dispersion: 'none' }),
          sheet({ phase: 'post', dispersion: 'many', comparableWindow: false }),
          sheet({ phase: 'post', dispersion: 'none', comparableWindow: true }),
          sheet({ phase: 'post', dispersion: 'many' }),
        ],
      },
      'I3',
    );

    expect(i3.before).toEqual({ value: 0, nValid: 2, nMissing: 1, nIncomplete: 0 });
    expect(i3.after).toEqual({ value: 0.5, nValid: 4, nMissing: 1, nIncomplete: 0 });
    // The baseline is zero: the absolute change is reported and the target is not evaluated.
    expect(i3.change).toEqual({ kind: 'absolute', difference: 0.5 });
    expect(i3.status).toBe('no_data');
    expect(i3.details).toEqual({
      brokenBagsShareBaseline: 0.5,
      brokenBagsSharePost: null,
      wasteRemainingShareBaseline: 0,
      wasteRemainingSharePost: 1,
    });
  });

  it('I4: % timely (0–15 min) per wave, "after the pass" as late, McNemar on the pairs', () => {
    const i4 = indicator(
      {
        surveys: [
          survey('h1', 'pre', { leadTime: 'gt_3h' }),
          survey('h1', 'post', { leadTime: '0_15' }),
          survey('h2', 'pre', { leadTime: 'after_pass' }),
          survey('h2', 'post', { leadTime: '0_15' }),
          survey('h3', 'pre', { leadTime: '0_15' }),
          survey('h3', 'post', { leadTime: '15_60' }),
          survey('h4', 'pre', { leadTime: '1_3h' }),
          survey('h4', 'post', {}),
        ],
      },
      'I4',
    );

    expect(i4.before).toEqual({ value: 25, nValid: 4, nMissing: 0, nIncomplete: 0 });
    expect(i4.after).toMatchObject({ value: (100 * 2) / 3, nValid: 3, nMissing: 1 });
    expect(i4.change).toEqual({ kind: 'points', difference: (100 * 2) / 3 - 25 });
    expect(i4.status).toBe('met');
    expect(i4.paired).toMatchObject({ kind: 'mcnemar', pairs: 3, yesToNo: 1, noToYes: 2 });
    expect(i4.paired?.pValue).toBeCloseTo(1, 10);
  });

  it('I5 and I6: pooled weekly adoption; satisfaction among active households only', () => {
    const inputs = {
      adoptionWeeks: [
        { weekStart: '2026-11-16', enrolled: 10, active: 8, activeConfirmed: 6 },
        { weekStart: '2026-11-23', enrolled: 10, active: 6, activeConfirmed: 5 },
      ],
      activeHouseholdIds: ['h1', 'h2', 'h3'],
      surveys: [
        survey('h1', 'post', { satisfaction: 5 }),
        survey('h2', 'post', { satisfaction: 3 }),
        survey('h3', 'pre', {}),
        survey('h9', 'post', { satisfaction: 1 }),
      ],
    };

    expect(indicator(inputs, 'I5')).toMatchObject({
      value: 70,
      nValid: 20,
      status: 'met',
      details: { confirmedValue: 55, weeks: 2 },
    });
    expect(indicator(inputs, 'I6')).toMatchObject({
      value: 50,
      nValid: 2,
      nMissing: 1,
      status: 'not_met',
      details: { activeHouseholds: 3 },
    });
  });

  it('I7: the share of available intervals', () => {
    expect(indicator({ availability: { intervals: 200, available: 191 } }, 'I7')).toMatchObject({
      value: 95.5,
      nValid: 200,
      status: 'met',
    });
  });

  it('I8: music seconds at the music points, comparable windows only', () => {
    const i8 = indicator(
      {
        observations: [
          sheet({ pointCode: 'P04', observesMusic: true, musicSeconds: 300 }),
          sheet({ pointCode: 'P04', observesMusic: true, musicSeconds: 200 }),
          sheet({ pointCode: 'P07', musicSeconds: null }),
          sheet({ pointCode: 'P04', phase: 'post', observesMusic: true, musicSeconds: 150 }),
          sheet({
            pointCode: 'P04',
            phase: 'post',
            observesMusic: true,
            musicSeconds: 10,
            comparableWindow: false,
          }),
        ],
      },
      'I8',
    );

    expect(i8.before).toMatchObject({ value: 250, nValid: 2, nMissing: 0 });
    expect(i8.after).toMatchObject({ value: 150, nValid: 1, nMissing: 1 });
    expect(i8.change).toEqual({ kind: 'relative', percent: -40 });
    expect(i8.byPoint.map((p) => p.pointCode)).toEqual(['P04']);
    expect(i8.status).toBe('met');
  });

  it('I9: the median annoyance, "No la escuché" counted apart and never as zero', () => {
    const i9 = indicator(
      {
        surveys: [
          survey('h1', 'pre', { annoyance: 3 }),
          survey('h1', 'post', { annoyance: 1 }),
          survey('h2', 'pre', { annoyance: 2 }),
          survey('h2', 'post', { notHeard: true }),
          survey('h3', 'pre', {}),
        ],
      },
      'I9',
    );

    expect(i9.before).toEqual({ value: 2.5, nValid: 2, nMissing: 1, nIncomplete: 0 });
    expect(i9.after).toEqual({ value: 1, nValid: 1, nMissing: 0, nIncomplete: 1 });
    expect(i9.paired).toMatchObject({ kind: 'wilcoxon', pairs: 1 });
    expect(i9.status).toBe('exploratory');
  });
});

describe('target status', () => {
  it('evaluates each kind of target', () => {
    expect(statusOf({ kind: 'at_most', value: 5 }, 5, null)).toBe('met');
    expect(statusOf({ kind: 'at_most', value: 5 }, 5.1, null)).toBe('not_met');
    expect(statusOf({ kind: 'at_least', value: 70 }, null, null)).toBe('no_data');
    const reduction = { kind: 'reduction', percent: 30 } as const;
    expect(statusOf(reduction, 7, { kind: 'relative', percent: -30 })).toBe('met');
    expect(statusOf(reduction, 7, { kind: 'relative', percent: -29.9 })).toBe('not_met');
    expect(statusOf(reduction, 7, { kind: 'absolute', difference: 2 })).toBe('no_data');
    const increase = { kind: 'increase_points', points: 30 } as const;
    expect(statusOf(increase, 60, { kind: 'points', difference: 30 })).toBe('met');
    expect(statusOf(increase, 60, { kind: 'points', difference: 10 })).toBe('not_met');
  });
});
