import type { CsvValue } from '../../../shared/domain/csv.js';
import { usedInWeek, usedInWeekConfirmed } from '../../domain/adoption.js';
import type { IndicatorTarget, Measure } from '../../domain/impact-indicators.js';
import type { Change } from '../../domain/statistics.js';
import type { CsvTable } from '../../application/export-ports.js';
import type { IndicatorReport } from '../../application/indicator-service.js';
import { rounded } from './indicator-views.js';

export const INDICATOR_COLUMNS = [
  'route_code',
  'period_from',
  'period_to',
  'indicator',
  'name',
  'scope',
  'phase',
  'value',
  'unit',
  'n_valid',
  'n_missing',
  'n_incomplete',
  'target',
  'change_kind',
  'change',
  'paired_test',
  'pairs',
  'statistic',
  'p_value',
  'status',
] as const;

export const USAGE_COLUMNS = [
  'route_code',
  'week_start',
  'household_code',
  'viewed',
  'alert_sent',
  'alert_confirmed',
  'active',
  'active_confirmed',
] as const;

/**
 * A target as text: `<= 5`, `>= 70`, `<= -30%` (relative change), `>= +30 pp`, or empty for an
 * exploratory one. Every label starts with a comparison, so no spreadsheet reads it as a formula.
 */
export function targetLabel(target: IndicatorTarget): string {
  switch (target.kind) {
    case 'at_most':
      return `<= ${target.value}`;
    case 'at_least':
      return `>= ${target.value}`;
    case 'reduction':
      return `<= -${target.percent}%`;
    case 'increase_points':
      return `>= +${target.points} pp`;
    case 'none':
      return '';
  }
}

function changeCells(change: Change | null): [CsvValue, CsvValue] {
  if (change === null) return [null, null];
  return [change.kind, rounded(change.kind === 'relative' ? change.percent : change.difference)];
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/**
 * `indicadores.csv`, in long form: per indicator, one `all` row for the route (value, counts,
 * target, change, paired test, state), one row per compared phase, the per-point rows, and one
 * row per secondary figure (`phase` holds its name).
 */
export function indicatorTable(report: IndicatorReport): CsvTable {
  const rows: CsvValue[][] = [];
  const base = [report.routeCode, report.from, report.to] as const;
  for (const indicator of report.indicators) {
    const head = [...base, indicator.id, indicator.name] as const;
    const measureRow = (scope: string, phase: string, measure: Measure, change: Change | null) => [
      ...head,
      scope,
      phase,
      rounded(measure.value),
      indicator.unit,
      measure.nValid,
      measure.nMissing,
      measure.nIncomplete,
      null,
      ...changeCells(change),
      null,
      null,
      null,
      null,
      null,
    ];
    const paired = indicator.paired;
    rows.push([
      ...head,
      'route',
      'all',
      rounded(indicator.value),
      indicator.unit,
      indicator.nValid,
      indicator.nMissing,
      indicator.nIncomplete,
      targetLabel(indicator.target),
      ...changeCells(indicator.change),
      paired?.kind ?? null,
      paired?.pairs ?? null,
      paired?.kind === 'wilcoxon' ? paired.statistic : null,
      rounded(paired?.pValue ?? null, 4),
      indicator.status,
    ]);
    const phases = indicator.phases;
    if (phases !== null && indicator.before !== null && indicator.after !== null) {
      rows.push(measureRow('route', phases.before, indicator.before, null));
      rows.push(measureRow('route', phases.after, indicator.after, null));
    }
    for (const point of indicator.byPoint) {
      if (phases === null || point.before === null) {
        rows.push(measureRow(point.pointCode, 'all', point.after, null));
      } else {
        rows.push(measureRow(point.pointCode, phases.before, point.before, null));
        rows.push(measureRow(point.pointCode, phases.after, point.after, point.change));
      }
    }
    for (const [name, value] of Object.entries(indicator.details)) {
      rows.push([...head, 'route', name, rounded(value), ...Array<null>(12).fill(null)]);
    }
  }
  return { header: INDICATOR_COLUMNS, rows };
}

/** `uso.csv`: each enrolled household in each week, and whether it used the system. */
export function usageTable(report: IndicatorReport): CsvTable {
  return {
    header: USAGE_COLUMNS,
    rows: report.householdWeeks.map((week) => [
      report.routeCode,
      week.weekStart,
      week.householdCode,
      yesNo(week.viewed),
      yesNo(week.alertSent),
      yesNo(week.alertConfirmed),
      yesNo(usedInWeek(week)),
      yesNo(usedInWeekConfirmed(week)),
    ]),
  };
}
