import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createPanelApi } from '../api/panel-api';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

function setup() {
  const api = fakePanelApi(panelUser('supervisor'));
  const real = createPanelApi({ fetch: () => Promise.reject(new Error('no fetch')) });
  api.exportUrl.mockImplementation((file, query) => real.exportUrl(file, query));
  renderPanel('/panel/exportaciones', fakePanelDeps(api));
  return api;
}

describe('ExportsPage', () => {
  it('links each CSV file for the route and Fase 3, with what it holds', async () => {
    setup();

    const link = await screen.findByRole('link', { name: 'Descargar instrumento1.csv' });
    expect(link).toHaveAttribute(
      'href',
      '/api/panel/exports/instrumento1.csv?route=RI-01&from=2026-11-16&to=2026-12-13',
    );
    expect(link).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Descargar instrumento3.csv' })).toHaveAttribute(
      'href',
      '/api/panel/exports/instrumento3.csv?route=RI-01',
    );
    expect(screen.getAllByRole('link', { name: /^Descargar / })).toHaveLength(5);
    expect(screen.getByText(/Una fila por hogar inscrito y semana/)).toBeInTheDocument();
  });

  it('follows the chosen period', async () => {
    setup();
    await screen.findByRole('link', { name: 'Descargar uso.csv' });

    await userEvent.click(screen.getByRole('button', { name: 'Todo el piloto' }));

    expect(screen.getByRole('link', { name: 'Descargar uso.csv' })).toHaveAttribute(
      'href',
      '/api/panel/exports/uso.csv?route=RI-01&from=2026-10-19&to=2026-12-20',
    );
  });

  it('hides the links and explains a reversed period', async () => {
    setup();
    await screen.findByRole('link', { name: 'Descargar uso.csv' });

    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-01' } });

    expect(await screen.findByText(/posterior a «Hasta»/)).toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: /^Descargar / })).toHaveLength(0);
  });
});
