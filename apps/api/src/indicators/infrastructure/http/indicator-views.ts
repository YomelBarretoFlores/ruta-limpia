import type { IndicatorReport } from '../../application/indicator-service.js';
import type { Change } from '../../domain/statistics.js';
import type { IndicatorResult, Measure, PairedTest } from '../../domain/impact-indicators.js';

/** Rounds for presentation: values to 2 decimals, p-values to 4; null stays null. */
export function rounded(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function measureView(measure: Measure | null) {
  return measure === null ? null : { ...measure, value: rounded(measure.value) };
}

function changeView(change: Change | null) {
  if (change === null) return null;
  return change.kind === 'relative'
    ? { kind: change.kind, percent: rounded(change.percent) }
    : { kind: change.kind, difference: rounded(change.difference) };
}

function pairedView(paired: PairedTest | null) {
  return paired === null ? null : { ...paired, pValue: rounded(paired.pValue, 4) };
}

/** One indicator, as the panel and the exports show it. */
export function indicatorView(indicator: IndicatorResult) {
  return {
    id: indicator.id,
    name: indicator.name,
    unit: indicator.unit,
    target: indicator.target,
    status: indicator.status,
    value: rounded(indicator.value),
    nValid: indicator.nValid,
    nMissing: indicator.nMissing,
    nIncomplete: indicator.nIncomplete,
    phases: indicator.phases,
    before: measureView(indicator.before),
    after: measureView(indicator.after),
    change: changeView(indicator.change),
    paired: pairedView(indicator.paired),
    byPoint: indicator.byPoint.map((point) => ({
      pointCode: point.pointCode,
      before: measureView(point.before),
      after: measureView(point.after),
      change: changeView(point.change),
    })),
    details: Object.fromEntries(
      Object.entries(indicator.details).map(([key, value]) => [key, rounded(value, 4)]),
    ),
  };
}

export type IndicatorView = ReturnType<typeof indicatorView>;

export function reportView(report: IndicatorReport) {
  return {
    routeCode: report.routeCode,
    from: report.from,
    to: report.to,
    generatedAt: report.generatedAt.toISOString(),
    indicators: report.indicators.map(indicatorView),
    adoptionWeeks: report.adoptionWeeks,
  };
}
