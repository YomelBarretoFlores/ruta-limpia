import { describe, expect, it } from 'vitest';

import type { Indicator } from '../api/types';
import {
  formatChange,
  formatPhases,
  formatPValue,
  formatTarget,
  formatValue,
  incompleteLabel,
} from './indicator-format';

describe('indicator formats', () => {
  it('writes values with their unit and a dash without one', () => {
    expect(formatValue(4, 'minutes')).toBe('4 min');
    expect(formatValue(42.857, 'percent')).toBe('42.9 %');
    expect(formatValue(0.3333, 'ratio')).toBe('0.33');
    expect(formatValue(250, 'seconds')).toBe('250 s');
    expect(formatValue(null, 'minutes')).toBe('—');
  });

  it('writes the targets as Tabla 16 does', () => {
    expect(formatTarget({ kind: 'at_most', value: 5 }, 'minutes')).toBe('≤ 5 min');
    expect(formatTarget({ kind: 'at_least', value: 70 }, 'percent')).toBe('≥ 70 %');
    expect(formatTarget({ kind: 'reduction', percent: 30 }, 'minutes')).toBe('−30 %');
    expect(formatTarget({ kind: 'increase_points', points: 30 }, 'percent')).toBe('+30 p. p.');
    expect(formatTarget({ kind: 'none' }, 'score')).toBe('Exploratoria');
  });

  it('writes relative, absolute and point changes with their sign', () => {
    expect(formatChange({ kind: 'relative', percent: -56.25 }, 'minutes')).toBe('−56.3 %');
    expect(formatChange({ kind: 'absolute', difference: 0.33 }, 'ratio')).toBe(
      '+0.33 (línea base 0)',
    );
    expect(formatChange({ kind: 'points', difference: 33.33 }, 'percent')).toBe('+33.3 p. p.');
    expect(formatChange(null, 'percent')).toBe('—');
  });

  it('writes the phases compared, the set-aside records and p-values', () => {
    const measure = { nValid: 1, nMissing: 0, nIncomplete: 0 };
    const i2 = {
      unit: 'minutes',
      before: { ...measure, value: 80 },
      after: { ...measure, value: 35 },
    } as Indicator;
    expect(formatPhases(i2)).toBe('80 → 35 min');
    expect(formatPhases({ ...i2, before: null })).toBe('—');
    expect(incompleteLabel({ id: 'I2', nIncomplete: 1 })).toBe('1 incompleto');
    expect(incompleteLabel({ id: 'I9', nIncomplete: 2 })).toBe('2 «No la escuché»');
    expect(incompleteLabel({ id: 'I1', nIncomplete: 0 })).toBeNull();
    expect(formatPValue(0.0654)).toBe('p = 0.065');
    expect(formatPValue(0.0001)).toBe('p < 0.001');
  });
});
