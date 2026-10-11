import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import type { Vehicle } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';
import { trip } from '../../citizen/test/fixtures';
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

function setup(
  role: 'supervisor' | 'observer' = 'supervisor',
  snapshot = liveSnapshot(),
  vehicles: readonly Vehicle[] = [VEHICLE],
) {
  const api = fakePanelApi(panelUser(role));
  api.getLive.mockResolvedValue(snapshot);
  api.listVehicles.mockResolvedValue([...vehicles]);
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

  it('says the GPS signal is stale when the last position is old', async () => {
    const stale = liveSnapshot();
    setup('supervisor', { ...stale, trips: [{ ...stale.trips[0]!, signal: 'stale' }] });

    expect(await screen.findByText('Sin actualización')).toBeInTheDocument();
  });

  it('warns when more than one trip runs the route, showing the latest', async () => {
    const snapshot = liveSnapshot();
    const second = { ...snapshot.trips[0]!, ...trip({ tripId: 'trip-2' }), points: [] };
    setup('supervisor', { ...snapshot, trips: [...snapshot.trips, second] });

    expect(
      await screen.findByText(/Hay 2 viajes en curso en esta ruta; se muestra el más reciente\./),
    ).toBeInTheDocument();
  });

  it('says no trip runs the route and lists the route points', async () => {
    setup('supervisor', liveSnapshot({ trips: [] }));

    expect(
      await screen.findByRole('table', { name: 'Puntos de la ruta (sin viaje en curso)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin recorrido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar viaje' })).toBeInTheDocument();
  });

  it('ends a trip with a note and confirms it', async () => {
    const api = setup();
    api.endTrip.mockResolvedValue({} as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar viaje' }));
    const form = screen.getByRole('region', { name: 'Finalizar viaje' });

    await userEvent.type(within(form).getByRole('textbox'), 'Avería hidráulica');
    await userEvent.click(within(form).getByRole('button', { name: 'Finalizar viaje' }));

    expect(api.endTrip).toHaveBeenCalledWith('trip-1', 'Avería hidráulica');
    expect(
      await screen.findByText('Se finalizó el viaje. El motivo quedó registrado.'),
    ).toBeInTheDocument();
  });

  it('starts a trip with a free vehicle, never with one already on a trip', async () => {
    const busy: Vehicle = {
      ...VEHICLE,
      activeTrip: { id: 'trip-9', routeCode: 'RI-01', startedAt: '2026-10-20T22:00:00.000Z' },
    };
    const free: Vehicle = {
      ...VEHICLE,
      code: 'UNIDAD-B',
      label: 'Unidad B (baranda)',
      defaultRoute: null,
    };
    const api = setup('supervisor', liveSnapshot({ trips: [] }), [busy, free]);
    api.startTrip.mockResolvedValue({} as never);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar viaje' }));
    const form = screen.getByRole('region', { name: 'Iniciar viaje' });
    await within(form).findByRole('option', { name: 'Unidad B (baranda)' });

    expect(within(form).getByLabelText('Vehículo')).toHaveValue('UNIDAD-B');
    await userEvent.click(within(form).getByRole('button', { name: 'Iniciar viaje' }));
    expect(api.startTrip).toHaveBeenCalledWith('UNIDAD-B', 'RI-01');
  });

  it('cannot start a trip when every vehicle is already on one', async () => {
    const busy: Vehicle = {
      ...VEHICLE,
      activeTrip: { id: 'trip-9', routeCode: 'RI-01', startedAt: '2026-10-20T22:00:00.000Z' },
    };
    const api = setup('supervisor', liveSnapshot({ trips: [] }), [busy]);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar viaje' }));
    const form = screen.getByRole('region', { name: 'Iniciar viaje' });
    await within(form).findByRole('option', { name: /Unidad A/ });

    expect(within(form).getByRole('button', { name: 'Iniciar viaje' })).toBeDisabled();
    expect(within(form).getByText('Todos los vehículos están en viaje.')).toBeInTheDocument();
    expect(api.startTrip).not.toHaveBeenCalled();
  });

  it('explains a refused incident in words', async () => {
    const api = setup('observer');
    api.createIncident.mockRejectedValue(new PanelApiError(422, 'trip_route_mismatch'));
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar incidencia' }));
    const form = screen.getByRole('region', { name: 'Registrar incidencia' });

    await userEvent.selectOptions(within(form).getByLabelText('Tipo'), 'gps_failure');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar incidencia' }));

    expect(
      await within(form).findByText('Ese viaje recorre otra ruta. Elige un viaje de esta ruta.'),
    ).toBeInTheDocument();
  });

  it('starts a trip with the route vehicle', async () => {
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
