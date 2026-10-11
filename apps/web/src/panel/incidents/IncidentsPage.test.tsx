import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import type { Incident } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

const INCIDENT: Incident = {
  id: 'i-1',
  kind: 'missed_collection',
  routeCode: 'RI-01',
  tripId: null,
  pointCode: 'P08',
  description: 'No pasó el camión',
  occurredAt: '2026-10-20T12:30:00.000Z',
  reportedBy: 'Luis Ramos',
  reportedByUserId: 'u-2',
  resolvedAt: null,
  resolvedByUserId: null,
  resolutionNote: null,
  createdAt: '2026-10-20T12:31:00.000Z',
  updatedAt: '2026-10-20T12:31:00.000Z',
};

const RESOLVED: Incident = {
  ...INCIDENT,
  resolvedAt: '2026-10-20T14:00:00.000Z',
  resolvedByUserId: 'u-1',
  resolutionNote: 'Se recogió a las 9:00',
};

function setup(incident: Incident = INCIDENT, path = '/panel/incidencias') {
  const api = fakePanelApi(panelUser('supervisor'));
  api.listIncidents.mockResolvedValue({ items: [incident], page: 1, pageSize: 20, total: 1 });
  api.updateIncident.mockResolvedValue(incident);
  api.createIncident.mockResolvedValue(incident);
  renderPanel(path, fakePanelDeps(api));
  return api;
}

describe('IncidentsPage', () => {
  it('lists the route incidents and filters them by kind and state', async () => {
    const api = setup();

    const table = await screen.findByRole('table');
    expect(
      within(table).getByRole('rowheader', { name: 'Recolección omitida' }),
    ).toBeInTheDocument();
    expect(within(table).getByText('Abierta')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'open');
    expect(api.listIncidents).toHaveBeenLastCalledWith(
      expect.objectContaining({ route: 'RI-01', status: 'open', page: 1 }),
    );
  });

  it('resolves an incident only with a note', async () => {
    const api = setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resolver Recolección omitida' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resuelta' }));
    expect(screen.getByText('Escribe cómo se resolvió la incidencia.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Cómo se resolvió'), 'Se recogió a las 9:00');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resuelta' }));
    expect(api.updateIncident).toHaveBeenCalledWith('i-1', {
      resolved: true,
      resolutionNote: 'Se recogió a las 9:00',
    });
    expect(await screen.findByText('La incidencia quedó resuelta.')).toBeInTheDocument();
  });

  it('reopens a resolved incident once, however often the button is pressed', async () => {
    const api = setup(RESOLVED);
    let answer: (incident: Incident) => void = () => undefined;
    api.updateIncident.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const reopen = await screen.findByRole('button', { name: 'Reabrir Recolección omitida' });

    await userEvent.click(reopen);
    await userEvent.click(reopen);
    expect(reopen).toBeDisabled();
    answer(INCIDENT);

    expect(await screen.findByText('Se reabrió la incidencia.')).toBeInTheDocument();
    expect(api.updateIncident).toHaveBeenCalledOnce();
    expect(api.updateIncident).toHaveBeenCalledWith('i-1', { resolved: false });
  });

  it('shows a failed reopening as an error', async () => {
    const api = setup(RESOLVED);
    api.updateIncident.mockRejectedValue(new PanelApiError(404, 'incident_not_found'));

    await userEvent.click(
      await screen.findByRole('button', { name: 'Reabrir Recolección omitida' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se encontró el registro. Es posible que otra persona lo haya eliminado.',
    );
    expect(screen.queryByText('Se reabrió la incidencia.')).not.toBeInTheDocument();
  });

  it('ignores an unknown kind or state in a shared link', async () => {
    const api = setup(INCIDENT, '/panel/incidencias?tipo=borrar&estado=todo');

    await screen.findByRole('table');

    expect(api.listIncidents).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: undefined, status: undefined }),
    );
  });

  it('registers a new incident with its time in Lima', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar incidencia' }));
    const form = screen.getByRole('region', { name: 'Registrar incidencia' });

    await userEvent.selectOptions(within(form).getByLabelText('Tipo'), 'weather');
    await userEvent.type(within(form).getByLabelText('Descripción (opcional)'), 'Lluvia fuerte');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar incidencia' }));

    expect(api.createIncident).toHaveBeenCalledWith({
      kind: 'weather',
      routeCode: 'RI-01',
      occurredAt: '2026-10-20T17:30:00-05:00',
      description: 'Lluvia fuerte',
    });
  });

  it('corrects the kind and the description of an incident', async () => {
    const api = setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Corregir Recolección omitida' }),
    );
    const form = screen.getByRole('region', { name: 'Corregir la incidencia' });
    expect(within(form).getByLabelText('Punto (opcional)')).toBeDisabled();

    await userEvent.selectOptions(within(form).getByLabelText('Tipo'), 'route_change');
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar corrección' }));

    expect(api.updateIncident).toHaveBeenCalledWith('i-1', {
      kind: 'route_change',
      description: 'No pasó el camión',
    });
  });

  it('clears the description with an empty text (the API has no null description)', async () => {
    const api = setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Corregir Recolección omitida' }),
    );
    const form = screen.getByRole('region', { name: 'Corregir la incidencia' });

    await userEvent.clear(within(form).getByLabelText('Descripción (opcional)'));
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar corrección' }));

    expect(api.updateIncident).toHaveBeenCalledWith('i-1', {
      kind: 'missed_collection',
      description: '',
    });
  });
});
