import {
  mcnemarExact,
  median,
  percentage,
  pointsChange,
  ratio,
  relativeChange,
  wilcoxonSignedRank,
  type Change,
  type McNemarResult,
  type WilcoxonResult,
} from './statistics.js';

/**
 * The impact indicators of the proposal (Tabla 16), computed from the logs and the field
 * instruments as they were recorded: nothing is inferred or filled in. Each indicator reports its
 * value with the number of valid, missing and (where the instrument says so) incomplete records,
 * the phases it compares, the change between them, the paired test of the analysis plan (§11.5)
 * when it applies, and whether the pilot's target is met.
 */

export const INDICATOR_IDS = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'] as const;
export type IndicatorId = (typeof INDICATOR_IDS)[number];

/** `ratio`: events per valid point-trip; `score`: the 0–4 annoyance scale. */
export type IndicatorUnit = 'minutes' | 'ratio' | 'percent' | 'seconds' | 'score';

export type IndicatorTarget =
  | { readonly kind: 'at_most'; readonly value: number }
  | { readonly kind: 'at_least'; readonly value: number }
  /** The relative change must be −`percent` % or lower. */
  | { readonly kind: 'reduction'; readonly percent: number }
  /** The proportion must grow by at least `points` percentage points. */
  | { readonly kind: 'increase_points'; readonly points: number }
  /** Exploratory: no target. */
  | { readonly kind: 'none' };

/** `met` / `not_met` against the target; `no_data` when it cannot be evaluated. */
export type IndicatorStatus = 'met' | 'not_met' | 'no_data' | 'exploratory';

export interface IndicatorDefinition {
  readonly id: IndicatorId;
  /** The indicator's name in the proposal (Tabla 16). */
  readonly name: string;
  readonly unit: IndicatorUnit;
  readonly target: IndicatorTarget;
  /** The phases compared, when the indicator compares two. */
  readonly phases: { readonly before: 'baseline' | 'pre'; readonly after: 'post' } | null;
}

export const INDICATOR_DEFINITIONS: Readonly<Record<IndicatorId, IndicatorDefinition>> = {
  I1: {
    id: 'I1',
    name: 'Precisión del ETA',
    unit: 'minutes',
    target: { kind: 'at_most', value: 5 },
    phases: null,
  },
  I2: {
    id: 'I2',
    name: 'Exposición',
    unit: 'minutes',
    target: { kind: 'reduction', percent: 30 },
    phases: { before: 'baseline', after: 'post' },
  },
  I3: {
    id: 'I3',
    name: 'Dispersión',
    unit: 'ratio',
    target: { kind: 'reduction', percent: 30 },
    phases: { before: 'baseline', after: 'post' },
  },
  I4: {
    id: 'I4',
    name: 'Disposición oportuna',
    unit: 'percent',
    target: { kind: 'increase_points', points: 30 },
    phases: { before: 'pre', after: 'post' },
  },
  I5: {
    id: 'I5',
    name: 'Adopción',
    unit: 'percent',
    target: { kind: 'at_least', value: 70 },
    phases: null,
  },
  I6: {
    id: 'I6',
    name: 'Satisfacción',
    unit: 'percent',
    target: { kind: 'at_least', value: 80 },
    phases: null,
  },
  I7: {
    id: 'I7',
    name: 'Disponibilidad',
    unit: 'percent',
    target: { kind: 'at_least', value: 95 },
    phases: null,
  },
  I8: {
    id: 'I8',
    name: 'Duración del aviso musical',
    unit: 'seconds',
    target: { kind: 'reduction', percent: 30 },
    phases: { before: 'baseline', after: 'post' },
  },
  I9: {
    id: 'I9',
    name: 'Molestia sonora percibida',
    unit: 'score',
    target: { kind: 'none' },
    phases: { before: 'pre', after: 'post' },
  },
};

/** One measurement and its counts. */
export interface Measure {
  readonly value: number | null;
  readonly nValid: number;
  readonly nMissing: number;
  readonly nIncomplete: number;
}

export type PairedTest =
  | ({ readonly kind: 'mcnemar'; readonly pairs: number } & McNemarResult)
  | ({ readonly kind: 'wilcoxon'; readonly pairs: number } & WilcoxonResult);

/** An indicator per reference point (medians and rates are reported per route and point). */
export interface PointBreakdown {
  readonly pointCode: string;
  readonly before: Measure | null;
  readonly after: Measure;
  readonly change: Change | null;
}

export interface IndicatorResult extends IndicatorDefinition, Measure {
  readonly before: Measure | null;
  readonly after: Measure | null;
  readonly change: Change | null;
  readonly paired: PairedTest | null;
  readonly status: IndicatorStatus;
  readonly byPoint: readonly PointBreakdown[];
  /** Secondary figures (named in the indicator's documentation). */
  readonly details: Readonly<Record<string, number | null>>;
}

// ---------------------------------------------------------------------------------------------
// Inputs, as recorded

/** One Instrument 1 row of the system: a reference point of an ended trip. */
export interface EtaErrorRow {
  readonly pointCode: string;
  /** |communicated ETA − actual pass| in minutes; null without an alert sent or a pass. */
  readonly absErrorMinutes: number | null;
}

export type FieldPhase = 'baseline' | 'intervention' | 'post';

/** One Instrument 2 sheet. */
export interface ObservationRow {
  readonly pointCode: string;
  readonly phase: FieldPhase;
  readonly observesMusic: boolean;
  readonly exposureMinutes: number | null;
  /** Placement happened before the observation began: the exposure is a minimum. */
  readonly exposureIncomplete: boolean;
  readonly dispersion: 'none' | 'few' | 'many' | null;
  readonly brokenBags: number | null;
  readonly wasteRemainingAfterPass: boolean | null;
  readonly musicSeconds: number | null;
  /** "Mismo punto y ventana": false excludes the sheet from the window comparisons. */
  readonly comparableWindow: boolean | null;
}

export type LeadTime = '0_15' | '15_60' | '1_3h' | 'gt_3h' | 'after_pass';

/** One Instrument 3 survey (the answers the indicators use). */
export interface SurveyRow {
  readonly householdId: string;
  readonly wave: 'pre' | 'post';
  readonly leadTime: LeadTime | null;
  readonly satisfaction: number | null;
  readonly annoyance: number | null;
  readonly notHeard: boolean;
}

/** One week (America/Lima, Monday to Sunday, clipped to the requested range). */
export interface AdoptionWeek {
  /** `YYYY-MM-DD`. */
  readonly weekStart: string;
  /** Active households enrolled on or before the week's end. */
  readonly enrolled: number;
  /** Of them, households with a linked app view or a sent alert in the week. */
  readonly active: number;
  /** Of them, households with a linked app view or a confirmed alert reception in the week. */
  readonly activeConfirmed: number;
}

export interface IndicatorInputs {
  readonly etaErrors: readonly EtaErrorRow[];
  readonly observations: readonly ObservationRow[];
  readonly surveys: readonly SurveyRow[];
  readonly adoptionWeeks: readonly AdoptionWeek[];
  /** Households that met the adoption rule in at least one week of the range. */
  readonly activeHouseholdIds: readonly string[];
  /** Scheduled 60 s operating intervals, and those with a fresh valid position. */
  readonly availability: { readonly intervals: number; readonly available: number };
}

// ---------------------------------------------------------------------------------------------
// Computation

const EMPTY: Measure = { value: null, nValid: 0, nMissing: 0, nIncomplete: 0 };

function measure(
  values: readonly number[],
  nMissing: number,
  aggregate: (values: readonly number[]) => number | null,
  nIncomplete = 0,
): Measure {
  return { value: aggregate(values), nValid: values.length, nMissing, nIncomplete };
}

export function statusOf(
  target: IndicatorTarget,
  value: number | null,
  change: Change | null,
): IndicatorStatus {
  switch (target.kind) {
    case 'none':
      return 'exploratory';
    case 'at_most':
      return value === null ? 'no_data' : value <= target.value ? 'met' : 'not_met';
    case 'at_least':
      return value === null ? 'no_data' : value >= target.value ? 'met' : 'not_met';
    case 'reduction':
      // A zero baseline has no relative change: the absolute change is reported, unevaluated.
      if (change?.kind !== 'relative') return 'no_data';
      return change.percent <= -target.percent ? 'met' : 'not_met';
    case 'increase_points':
      if (change?.kind !== 'points') return 'no_data';
      return change.difference >= target.points ? 'met' : 'not_met';
  }
}

function result(
  id: IndicatorId,
  parts: {
    readonly overall?: Measure;
    readonly before?: Measure;
    readonly after?: Measure;
    readonly change?: Change | null;
    readonly paired?: PairedTest | null;
    readonly byPoint?: readonly PointBreakdown[];
    readonly details?: Readonly<Record<string, number | null>>;
  },
): IndicatorResult {
  const definition = INDICATOR_DEFINITIONS[id];
  const before = parts.before ?? null;
  const after = parts.after ?? null;
  // Without an overall measure the headline is the post phase, value and counts alike: its
  // counts never include baseline records that did not enter the value.
  const headline = parts.overall ?? after ?? EMPTY;
  const change = parts.change ?? null;
  return {
    ...definition,
    ...headline,
    before,
    after,
    change,
    paired: parts.paired ?? null,
    status: statusOf(definition.target, headline.value, change),
    byPoint: parts.byPoint ?? [],
    details: parts.details ?? {},
  };
}

/** Groups rows by point code, in the order of first appearance. */
function byPointCode<T extends { readonly pointCode: string }>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.pointCode, [...(groups.get(row.pointCode) ?? []), row]);
  return groups;
}

/** A field indicator over the baseline and post sheets: overall, per point, and paired by point. */
function fieldComparison(
  id: IndicatorId,
  rows: readonly ObservationRow[],
  measureOf: (rows: readonly ObservationRow[]) => Measure,
  paired: 'wilcoxon' | null,
  details: Readonly<Record<string, number | null>> = {},
): IndicatorResult {
  const phase = (rows: readonly ObservationRow[], p: FieldPhase) =>
    rows.filter((r) => r.phase === p);
  const before = measureOf(phase(rows, 'baseline'));
  const after = measureOf(phase(rows, 'post'));
  const byPoint = [...byPointCode(rows)].map(([pointCode, pointRows]) => {
    const pointBefore = measureOf(phase(pointRows, 'baseline'));
    const pointAfter = measureOf(phase(pointRows, 'post'));
    return {
      pointCode,
      before: pointBefore,
      after: pointAfter,
      change: relativeChange(pointBefore.value, pointAfter.value),
    };
  });
  const differences = byPoint.flatMap(({ before: b, after: a }) =>
    b?.value != null && a.value !== null ? [a.value - b.value] : [],
  );
  return result(id, {
    before,
    after,
    change: relativeChange(before.value, after.value),
    paired:
      paired === null
        ? null
        : { kind: 'wilcoxon', pairs: differences.length, ...wilcoxonSignedRank(differences) },
    byPoint,
    details,
  });
}

/** I1: median |communicated ETA − pass| of the alerts sent; point-trips without one are missing. */
function etaPrecision(rows: readonly EtaErrorRow[]): IndicatorResult {
  const measureOf = (group: readonly EtaErrorRow[]) => {
    const errors = group.flatMap((r) => (r.absErrorMinutes === null ? [] : [r.absErrorMinutes]));
    return measure(errors, group.length - errors.length, median);
  };
  return result('I1', {
    overall: measureOf(rows),
    byPoint: [...byPointCode(rows)].map(([pointCode, group]) => ({
      pointCode,
      before: null,
      after: measureOf(group),
      change: null,
    })),
  });
}

/** I2: median exposure; incomplete (minimum) exposures are counted apart, not in the median. */
function exposureOf(rows: readonly ObservationRow[]): Measure {
  const incomplete = rows.filter((r) => r.exposureIncomplete).length;
  const values = rows.flatMap((r) =>
    r.exposureIncomplete || r.exposureMinutes === null ? [] : [r.exposureMinutes],
  );
  return measure(values, rows.length - values.length - incomplete, median, incomplete);
}

/** Sheets of a comparable observation window ("mismo punto y ventana" not answered "No"). */
const comparable = (r: ObservationRow) => r.comparableWindow !== false;

/** I3: dispersion events (few or many) per valid point-trip of a comparable window. */
function dispersionOf(rows: readonly ObservationRow[]): Measure {
  const valid = rows.filter((r) => r.dispersion !== null && comparable(r));
  const events = valid.filter((r) => r.dispersion === 'few' || r.dispersion === 'many').length;
  return {
    value: ratio(events, valid.length),
    nValid: valid.length,
    nMissing: rows.length - valid.length,
    nIncomplete: 0,
  };
}

/** The share (0–1) of `rows` whose `answer` is true, among those with an answer (not null). */
function shareOf<T>(rows: readonly T[], answer: (row: T) => boolean | null): number | null {
  const answered = rows.map(answer).filter((a): a is boolean => a !== null);
  return ratio(answered.filter(Boolean).length, answered.length);
}

/** I8: median seconds of music per comparable window, at the points that observe it. */
function musicOf(rows: readonly ObservationRow[]): Measure {
  const atMusicPoints = rows.filter((r) => r.observesMusic);
  const values = atMusicPoints.flatMap((r) =>
    r.musicSeconds !== null && comparable(r) ? [r.musicSeconds] : [],
  );
  return measure(values, atMusicPoints.length - values.length, median);
}

/** The surveys of one wave, one per household. */
function wave(surveys: readonly SurveyRow[], w: 'pre' | 'post') {
  return surveys.filter((s) => s.wave === w);
}

/** Pairs a household's pre and post answers when both are present. */
function pairs<T>(surveys: readonly SurveyRow[], answer: (s: SurveyRow) => T | null): [T, T][] {
  const post = new Map(wave(surveys, 'post').map((s) => [s.householdId, answer(s)]));
  return wave(surveys, 'pre').flatMap((s) => {
    const before = answer(s);
    const after = post.get(s.householdId) ?? null;
    return before === null || after === null ? [] : [[before, after] as [T, T]];
  });
}

/** I4: % of households putting waste out at most 15 min before the pass ("Después" is late). */
function timelyDisposal(surveys: readonly SurveyRow[]): IndicatorResult {
  const timely = (s: SurveyRow) => (s.leadTime === null ? null : s.leadTime === '0_15');
  const measureOf = (group: readonly SurveyRow[]): Measure => {
    const answered = group.filter((s) => s.leadTime !== null);
    return {
      value: percentage(answered.filter((s) => timely(s)).length, answered.length),
      nValid: answered.length,
      nMissing: group.length - answered.length,
      nIncomplete: 0,
    };
  };
  const before = measureOf(wave(surveys, 'pre'));
  const after = measureOf(wave(surveys, 'post'));
  const paired = pairs(surveys, timely);
  const yesToNo = paired.filter(([b, a]) => b && !a).length;
  const noToYes = paired.filter(([b, a]) => !b && a).length;
  return result('I4', {
    before,
    after,
    change: pointsChange(before.value, after.value),
    paired: { kind: 'mcnemar', pairs: paired.length, ...mcnemarExact(yesToNo, noToYes) },
  });
}

/** I5: household-weeks with use / enrolled household-weeks over the range. */
function adoption(weeks: readonly AdoptionWeek[]): IndicatorResult {
  const sum = (pick: (w: AdoptionWeek) => number) => weeks.reduce((s, w) => s + pick(w), 0);
  const enrolled = sum((w) => w.enrolled);
  return result('I5', {
    overall: {
      value: percentage(
        sum((w) => w.active),
        enrolled,
      ),
      nValid: enrolled,
      nMissing: 0,
      nIncomplete: 0,
    },
    details: {
      confirmedValue: percentage(
        sum((w) => w.activeConfirmed),
        enrolled,
      ),
      weeks: weeks.length,
    },
  });
}

/** I6: % of active households answering 4 or 5 on Q11, among those with a valid answer. */
function satisfaction(
  surveys: readonly SurveyRow[],
  activeHouseholdIds: readonly string[],
): IndicatorResult {
  const active = new Set(activeHouseholdIds);
  const answers = wave(surveys, 'post').flatMap((s) =>
    active.has(s.householdId) && s.satisfaction !== null ? [s.satisfaction] : [],
  );
  return result('I6', {
    overall: {
      value: percentage(answers.filter((a) => a >= 4).length, answers.length),
      nValid: answers.length,
      nMissing: active.size - answers.length,
      nIncomplete: 0,
    },
    details: { activeHouseholds: active.size },
  });
}

/** I7: % of scheduled 60 s intervals whose last valid position was at most 60 s old. */
function availability(totals: IndicatorInputs['availability']): IndicatorResult {
  return result('I7', {
    overall: {
      value: percentage(totals.available, totals.intervals),
      nValid: totals.intervals,
      nMissing: 0,
      nIncomplete: 0,
    },
  });
}

/** I9: median annoyance (0–4); "No la escuché" is counted apart, never as 0. */
function annoyance(surveys: readonly SurveyRow[]): IndicatorResult {
  const measureOf = (group: readonly SurveyRow[]): Measure => {
    const values = group.flatMap((s) => (s.annoyance === null ? [] : [s.annoyance]));
    const notHeard = group.filter((s) => s.annoyance === null && s.notHeard).length;
    return measure(values, group.length - values.length - notHeard, median, notHeard);
  };
  const before = measureOf(wave(surveys, 'pre'));
  const after = measureOf(wave(surveys, 'post'));
  const differences = pairs(surveys, (s) => s.annoyance).map(([b, a]) => a - b);
  return result('I9', {
    before,
    after,
    change: relativeChange(before.value, after.value),
    paired: { kind: 'wilcoxon', pairs: differences.length, ...wilcoxonSignedRank(differences) },
  });
}

/** Every indicator of Tabla 16, in order. */
export function computeIndicators(inputs: IndicatorInputs): IndicatorResult[] {
  const sheets = inputs.observations;
  const phaseRows = (p: FieldPhase) => sheets.filter((r) => r.phase === p);
  const secondary = (answer: (r: ObservationRow) => boolean | null) => ({
    baseline: shareOf(phaseRows('baseline'), answer),
    post: shareOf(phaseRows('post'), answer),
  });
  const broken = secondary((r) => (r.brokenBags === null ? null : r.brokenBags > 0));
  const remaining = secondary((r) => r.wasteRemainingAfterPass);
  return [
    etaPrecision(inputs.etaErrors),
    fieldComparison('I2', sheets, exposureOf, 'wilcoxon'),
    fieldComparison('I3', sheets, dispersionOf, null, {
      brokenBagsShareBaseline: broken.baseline,
      brokenBagsSharePost: broken.post,
      wasteRemainingShareBaseline: remaining.baseline,
      wasteRemainingSharePost: remaining.post,
    }),
    timelyDisposal(inputs.surveys),
    adoption(inputs.adoptionWeeks),
    satisfaction(inputs.surveys, inputs.activeHouseholdIds),
    availability(inputs.availability),
    fieldComparison(
      'I8',
      sheets.filter((r) => r.observesMusic),
      musicOf,
      'wilcoxon',
    ),
    annoyance(inputs.surveys),
  ];
}
