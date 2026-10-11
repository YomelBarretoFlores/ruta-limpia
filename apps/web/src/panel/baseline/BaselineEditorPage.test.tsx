import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import type { BaselineLog } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

const LOG: BaselineLog = {
  id: 'log-1',
  routeCode: 'RI-01',
  serviceDate: '2026-10-20',
  vehicleLabel: 'Compactadora 2',
  plannedStart: '07:00',
  actualStart: '07:12',
  notes: null,
  passes: [
    { pointCode: 'P01', sequence: 1, passedAt: '07:15' },
    // P05 has left the route since the log was written.
    { pointCode: 'P05', sequence: 5, passedAt: '07:35' },
  ],
  createdByUserId: 'u-1',
  createdAt: '2026-10-20T20:00:00.000Z',
  updatedAt: '2026-10-20T20:00:00.000Z',
};

describe('BaselineEditorPage', () => {
  it('records the pass time of each point and sends only the points with a time, in route order', async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.createBaselineLog.mockResolvedValue({} as never);
    renderPanel('/panel/linea-base/nuevo', fakePanelDeps(api));

    const table = await screen.findByRole('table', { name: /Hora de paso por punto/ });
    await userEvent.type(screen.getByLabelText('Vehículo'), 'Compactadora 2');
    await userEvent.type(screen.getByLabelText('Inicio previsto'), '07:00');
    await userEvent.type(screen.getByLabelText('Inicio real'), '07:12');
    await userEvent.type(within(table).getByLabelText(/^P09/), '07:58');
    await userEvent.type(within(table).getByLabelText(/^P01/), '07:15');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }));

    expect(api.createBaselineLog).toHaveBeenCalledWith({
      routeCode: 'RI-01',
      serviceDate: '2026-10-20',
      vehicleLabel: 'Compactadora 2',
      plannedStart: '07:00',
      actualStart: '07:12',
      notes: null,
      passes: [
        { pointCode: 'P01', passedAt: '07:15' },
        { pointCode: 'P09', passedAt: '07:58' },
      ],
    });
    expect(await screen.findByText('Se guardó el recorrido.')).toBeInTheDocument();
  });

  it('marks the point the API refuses', async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.createBaselineLog.mockRejectedValue(
      new PanelApiError(422, 'unknown_point', [], null, 'P08'),
    );
    renderPanel('/panel/linea-base/nuevo', fakePanelDeps(api));

    const table = await screen.findByRole('table', { name: /Hora de paso por punto/ });
    await userEvent.type(within(table).getByLabelText(/^P08/), '07:40');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }));

    expect(await within(table).findByLabelText(/^P08/)).toHaveAccessibleDescription(
      'Este punto ya no está activo en la ruta: deja su hora vacía.',
    );
  });

  it('shows and keeps the pass of a point that left the route instead of dropping it', async () => {
    const api = fakePanelApi(panelUser('admin'));
    api.getBaselineLog.mockResolvedValue(LOG);
    api.updateBaselineLog.mockResolvedValue(LOG);
    renderPanel('/panel/linea-base/log-1', fakePanelDeps(api));

    const table = await screen.findByRole('table', { name: /Hora de paso por punto/ });
    const retired = within(table).getByLabelText(/^P05/);
    expect(retired).toHaveValue('07:35');
    expect(within(table).getByText(/ya no está en la ruta/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }));

    expect(api.updateBaselineLog).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({
        passes: [
          { pointCode: 'P01', passedAt: '07:15' },
          { pointCode: 'P05', passedAt: '07:35' },
        ],
      }),
    );
  });

  it('says so, and offers a retry, when the route cannot be loaded', async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.getRoute.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPanel('/panel/linea-base/nuevo', fakePanelDeps(api));

    expect(
      await screen.findByText('No se pudieron cargar los puntos de la ruta'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));

    expect(
      await screen.findByRole('table', { name: /Hora de paso por punto/ }),
    ).toBeInTheDocument();
  });
});
