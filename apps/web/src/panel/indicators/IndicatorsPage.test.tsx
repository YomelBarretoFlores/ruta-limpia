import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Indicator, IndicatorReport } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

const MEASURE = { nValid: 0, nMissing: 0, nIncomplete: 0 };

function indicator(overrides: Partial<Indicator> & Pick<Indicator, 'id' | 'name'>): Indicator {
  return {
    unit: 'minutes',
    target: { kind: 'none' },
    status: 'no_data',
    value: null,
    ...MEASURE,
    phases: null,
    before: null,
    after: null,
    change: null,
    paired: null,
    details: {},
    ...overrides,
  };
}

const REPORT: IndicatorReport = {
  routeCode: 'RI-01',
  from: '2026-11-16',
  to: '2026-12-13',
  generatedAt: '2026-12-14T15:00:00.000Z',
  indicators: [
    indicator({
      id: 'I1',
      name: 'Precisión del ETA',
      target: { kind: 'at_most', value: 5 },
      status: 'met',
      value: 4,
      nValid: 3,
      nMissing: 12,
    }),
    indicator({
      id: 'I2',
      name: 'Exposición',
      target: { kind: 'reduction', percent: 30 },
      status: 'met',
      value: 35,
      nValid: 7,
      nMissing: 1,
      nIncomplete: 1,
      phases: { before: 'baseline', after: 'post' },
      before: { ...MEASURE, value: 80 },
      after: { ...MEASURE, value: 35 },
      change: { kind: 'relative', percent: -56.25 },
      paired: { kind: 'wilcoxon', pairs: 2, pValue: 0.5 },
    }),
    indicator({
      id: 'I3',
      name: 'Dispersión',
      unit: 'ratio',
      target: { kind: 'reduction', percent: 30 },
      value: 0.33,
      phases: { before: 'baseline', after: 'post' },
      before: { ...MEASURE, value: 0 },
      after: { ...MEASURE, value: 0.33 },
      change: { kind: 'absolute', difference: 0.33 },
    }),
    indicator({
      id: 'I5',
      name: 'Adopción',
      unit: 'percent',
      target: { kind: 'at_least', value: 70 },
      status: 'not_met',
      value: 42.86,
      nValid: 7,
    }),
  ],
  adoptionWeeks: [{ weekStart: '2026-11-16', enrolled: 3, active: 2, activeConfirmed: 2 }],
};

describe('IndicatorsPage', () => {
  it('shows Tabla 16 for Fase 3 by default, with the state in words', async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.getIndicators.mockResolvedValue(REPORT);
    renderPanel('/panel/indicadores', fakePanelDeps(api));

    const table = await screen.findByRole('table', { name: 'Indicadores de impacto (Tabla 16)' });
    expect(api.getIndicators).toHaveBeenCalledWith({
      route: 'RI-01',
      from: '2026-11-16',
      to: '2026-12-13',
    });
    const i1 = within(table).getByRole('row', { name: /I1 · Precisión del ETA/ });
    expect(
      within(i1)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['4 min', '≤ 5 min', '3', '12', '—', '—', 'Cumple']);
    const i2 = within(table).getByRole('row', { name: /I2 · Exposición/ });
    expect(
      within(i2)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['35 min', '−30 %', '7', '11 incompleto', '80 → 35 min', '−56.3 %', 'Cumple']);
    const i3 = within(table).getByRole('row', { name: /I3 · Dispersión/ });
    expect(within(i3).getByText('+0.33 (línea base 0)')).toBeInTheDocument();
    expect(within(i3).getByText('Sin datos')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /I5/ })).toHaveTextContent('No cumple');
    expect(screen.getByRole('table', { name: 'Comparaciones pareadas' })).toHaveTextContent(
      'Wilcoxon',
    );
    expect(screen.getByRole('table', { name: 'Adopción por semana' })).toHaveTextContent(
      '16/11/2026',
    );
  });

  it('switches to the whole pilot and refuses a reversed period without asking', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.getIndicators.mockResolvedValue(REPORT);
    renderPanel('/panel/indicadores', fakePanelDeps(api));
    await screen.findByRole('table', { name: 'Indicadores de impacto (Tabla 16)' });

    await userEvent.click(screen.getByRole('button', { name: 'Todo el piloto' }));
    expect(api.getIndicators).toHaveBeenLastCalledWith({
      route: 'RI-01',
      from: '2026-10-19',
      to: '2026-12-20',
    });
    expect(screen.getByRole('button', { name: 'Todo el piloto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    api.getIndicators.mockClear();
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText(/posterior a «Hasta»/)).toBeInTheDocument();
    expect(api.getIndicators).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: '2026-10-01' }),
    );
  });

  it('falls back to Fase 3 for a malformed date in the address, and refuses an over-long period', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.getIndicators.mockResolvedValue(REPORT);
    renderPanel('/panel/indicadores?desde=2026-11-16&hasta=2026-12-31x', fakePanelDeps(api));

    await screen.findByRole('table', { name: 'Indicadores de impacto (Tabla 16)' });
    expect(api.getIndicators).toHaveBeenCalledWith({
      route: 'RI-01',
      from: '2026-11-16',
      to: '2026-12-13',
    });

    api.getIndicators.mockClear();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-05' } });
    expect(await screen.findByText(/como máximo 120 días/)).toBeInTheDocument();
    expect(api.getIndicators).not.toHaveBeenCalled();
  });
});
