import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PanelApiError } from '../api/panel-api';
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
    expect(screen.getByRole('button', { name: 'Iniciar viaje' })).toBeInTheDocument();
  });

  it('starts a trip with the route vehicle, and ends one only with a note', async () => {
    const api = setup('supervisor', liveSnapshot({ trips: [] }));
    api.startTrip.mockResolvedValue({} as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar viaje' }));
    const form = screen.getByRole('region', { name: 'Iniciar viaje' });
    await within(form).findByRole('option', { name: 'Unidad A (compactadora)' });
    await userEvent.click(within(form).getByRole('button', { name: 'Iniciar viaje' }));
    expect(api.startTrip).toHaveBeenCalledWith('UNIDAD-A', 'RI-01');
    expect(await screen.findByText('Se inició el viaje.')).toBeInTheDocument();
  });

  it('requires a note to end a trip and explains a trip that already ended', async () => {
    const api = setup();
    api.endTrip.mockRejectedValue(new PanelApiError(409, 'trip_not_active'));
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar viaje' }));
    const form = screen.getByRole('region', { name: 'Finalizar viaje' });

    await userEvent.click(within(form).getByRole('button', { name: 'Finalizar viaje' }));
    expect(within(form).getByText('Escribe por qué se finaliza el viaje.')).toBeInTheDocument();
    expect(api.endTrip).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByRole('textbox'), 'Avería hidráulica');
    await userEvent.click(within(form).getByRole('button', { name: 'Finalizar viaje' }));
    expect(api.endTrip).toHaveBeenCalledWith('trip-1', 'Avería hidráulica');
    expect(await within(form).findByText('El viaje ya había terminado.')).toBeInTheDocument();
  });

  it('lets an observer register an incident but not drive trips', async () => {
    const api = setup('observer');
    api.createIncident.mockResolvedValue({} as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar incidencia' }));
    expect(screen.queryByRole('button', { name: 'Finalizar viaje' })).not.toBeInTheDocument();
    const form = screen.getByRole('region', { name: 'Registrar incidencia' });

    await userEvent.selectOptions(within(form).getByLabelText('Tipo'), 'gps_failure');
    await within(form).findByRole('option', { name: /^P08/ });
    await userEvent.selectOptions(within(form).getByLabelText('Punto (opcional)'), 'P08');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar incidencia' }));

    expect(api.createIncident).toHaveBeenCalledWith({
      kind: 'gps_failure',
      routeCode: 'RI-01',
      pointCode: 'P08',
      tripId: 'trip-1',
      occurredAt: '2026-10-20T17:30:00-05:00',
    });
  });
});
