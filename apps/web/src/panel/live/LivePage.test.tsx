import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Vehicle } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';
import { liveSnapshot } from '../test/live-fixtures';

// Leaflet needs a real layout engine; the table and the summary carry the same facts.
vi.mock('../map/PanelRouteMap', () => ({ default: () => <div data-testid="map" /> }));

const VEHICLE: Vehicle = {
  code: 'UNIDAD-A',
  label: 'Unidad A (compactadora)',
  active: true,
  defaultRoute: { code: 'RI-01', name: 'Av. Centenario – Independencia' },
  signal: 'none',
  lastFix: null,
  activeTrip: null,
};

function setup(role: 'supervisor' | 'observer' = 'supervisor', snapshot = liveSnapshot()) {
  const api = fakePanelApi(panelUser(role));
  api.getLive.mockResolvedValue(snapshot);
  api.listVehicles.mockResolvedValue([VEHICLE]);
  renderPanel('/panel/en-vivo', fakePanelDeps(api));
  return api;
}

describe('LivePage', () => {
  it('shows the summary and the pass table with the alert state of each point', async () => {
    setup();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Zona urbana de Independencia · RI-01 · seguimiento',
      }),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Paso por los puntos de referencia' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent)).toEqual([
      'Enviado',
      'En preparación',
      'En espera',
    ]);
    expect(within(rows[0]!).getByText('9 / 12')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('17:20')).toBeInTheDocument();
    expect(screen.getByText('Unidad A (compactadora)')).toBeInTheDocument();
    expect(
      screen.getByText('Sin mediciones cargadas: la evaluación se completará con la línea base.'),
    ).toBeInTheDocument();
  });

  it('says the GPS signal is stale and lists the route points when no truck runs it', async () => {
    setup('supervisor', liveSnapshot({ trips: [] }));

    expect(
      await screen.findByRole('table', { name: 'Puntos de la ruta (sin viaje en curso)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin recorrido')).toBeInTheDocument();
  });
});
