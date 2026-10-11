import type { StatusTone } from '../../shared/ui/Status';
import type {
  Indicator,
  IndicatorChange,
  IndicatorStatus,
  IndicatorTarget,
  IndicatorUnit,
} from '../api/types';

/** Numbers as the pilot reads them (es-PE: decimal point), with a true minus sign. */
function number(value: number, digits = 1, signed = false): string {
  const text = new Intl.NumberFormat('es-PE', {
    maximumFractionDigits: digits,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value);
  return text.replace('-', '−');
}

const UNIT_SUFFIX: Record<IndicatorUnit, string> = {
  minutes: ' min',
  ratio: '',
  percent: ' %',
  seconds: ' s',
  score: '',
};

/** Digits by unit: rates of events need two decimals, the rest one. */
const DIGITS: Record<IndicatorUnit, number> = {
  minutes: 1,
  ratio: 2,
  percent: 1,
  seconds: 0,
  score: 1,
};

/** A value with its unit (`4 min`, `42.9 %`, `0.33`), or a dash without one. */
export function formatValue(value: number | null, unit: IndicatorUnit): string {
  return value === null ? '—' : `${number(value, DIGITS[unit])}${UNIT_SUFFIX[unit]}`;
}

/** The target as Tabla 16 writes it. */
export function formatTarget(target: IndicatorTarget, unit: IndicatorUnit): string {
  switch (target.kind) {
    case 'at_most':
      return `≤ ${formatValue(target.value, unit)}`;
    case 'at_least':
      return `≥ ${formatValue(target.value, unit)}`;
    case 'reduction':
      return `−${target.percent} %`;
    case 'increase_points':
      return `+${target.points} p. p.`;
    case 'none':
      return 'Exploratoria';
  }
}

/** The change between phases: relative, absolute (zero baseline) or in percentage points. */
export function formatChange(change: IndicatorChange | null, unit: IndicatorUnit): string {
  if (change === null) return '—';
  if (change.kind === 'relative') {
    return change.percent === null ? '—' : `${number(change.percent, 1, true)} %`;
  }
  if (change.difference === null) return '—';
  if (change.kind === 'points') return `${number(change.difference, 1, true)} p. p.`;
  return `${number(change.difference, DIGITS[unit], true)}${UNIT_SUFFIX[unit]} (línea base 0)`;
}

/** "80 → 35 min" for the indicators that compare two phases; a dash for the others. */
export function formatPhases(indicator: Indicator): string {
  if (indicator.before === null || indicator.after === null) return '—';
  const unit = indicator.unit;
  const before =
    indicator.before.value === null ? '—' : number(indicator.before.value, DIGITS[unit]);
  return `${before} → ${formatValue(indicator.after.value, unit)}`;
}

export const STATUS_LABELS: Record<
  IndicatorStatus,
  { readonly label: string; readonly tone: StatusTone }
> = {
  met: { label: 'Cumple', tone: 'live' },
  not_met: { label: 'No cumple', tone: 'stale' },
  no_data: { label: 'Sin datos', tone: 'none' },
  exploratory: { label: 'Exploratoria', tone: 'none' },
};

/** What a record set aside counts as: "No la escuché" for I9, an incomplete record otherwise. */
export function incompleteLabel(indicator: Pick<Indicator, 'id' | 'nIncomplete'>): string | null {
  if (indicator.nIncomplete === 0) return null;
  if (indicator.id === 'I9') return `${indicator.nIncomplete} «No la escuché»`;
  return indicator.nIncomplete === 1 ? '1 incompleto' : `${indicator.nIncomplete} incompletos`;
}

/** A p-value as text (`p = 0.065`, `p < 0.001`), or a dash. */
export function formatPValue(value: number | null): string {
  if (value === null) return '—';
  return value < 0.001 ? 'p < 0.001' : `p = ${number(value, 3)}`;
}
