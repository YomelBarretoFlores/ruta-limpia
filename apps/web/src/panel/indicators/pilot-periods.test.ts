import { describe, expect, it } from 'vitest';

import { chosenPeriod, isCalendarDate, PHASE_3 } from './pilot-periods';

describe('chosenPeriod', () => {
  it('takes valid dates and defaults to Fase 3', () => {
    expect(chosenPeriod({ desde: '', hasta: '' })).toMatchObject({
      from: PHASE_3.from,
      to: PHASE_3.to,
      problem: null,
      message: null,
    });
    expect(chosenPeriod({ desde: '2026-10-19', hasta: '2026-12-20' })).toMatchObject({
      from: '2026-10-19',
      to: '2026-12-20',
      problem: null,
    });
  });

  it('falls back for a malformed or impossible date instead of sending it', () => {
    expect(chosenPeriod({ desde: '2026-11-16', hasta: '2026-12-31x' })).toMatchObject({
      to: PHASE_3.to,
      problem: null,
    });
    expect(chosenPeriod({ desde: '2026-02-30', hasta: '2026-12-01' }).from).toBe(PHASE_3.from);
    expect(['2026-1-05', '20261105', 'mañana', '2026-13-01'].map(isCalendarDate)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('flags a reversed period and one longer than the API accepts', () => {
    expect(chosenPeriod({ desde: '2026-12-13', hasta: '2026-11-16' })).toMatchObject({
      problem: 'reversed',
      message: 'La fecha «Desde» es posterior a «Hasta». Corrige el periodo.',
    });
    expect(chosenPeriod({ desde: '2026-09-01', hasta: '2026-12-29' }).problem).toBeNull();
    expect(chosenPeriod({ desde: '2026-09-01', hasta: '2026-12-30' })).toMatchObject({
      problem: 'too_long',
      message: 'El periodo puede abarcar como máximo 120 días. Acórtalo.',
    });
  });
});
