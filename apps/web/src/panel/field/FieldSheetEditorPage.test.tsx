import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import type { Observation } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

function setup(role: 'observer' | 'supervisor' = 'observer', path = '/panel/fichas/nueva') {
  const api = fakePanelApi(panelUser(role));
  renderPanel(path, fakePanelDeps(api));
  return api;
}

/** The route's points arrive after the form: wait for them before choosing one. */
async function pointSelect() {
  await screen.findByRole('option', { name: /^P09/ });
  return screen.getByLabelText('Punto');
}

async function fillRequired() {
  await userEvent.selectOptions(await pointSelect(), 'P08');
  await userEvent.selectOptions(screen.getByLabelText('Fase'), 'baseline');
  await userEvent.type(screen.getByLabelText('Observadores'), 'L.R., M.Q.');
}

const SAVED: Observation = {
  id: 'o-1',
  routeId: 'r-1',
  routeCode: 'RI-01',
  pointCode: 'P08',
  tripId: null,
  observedOn: '2026-10-20',
  phase: 'baseline',
  observers: 'L.R.',
  notes: null,
  firstPlacementTime: '06:40',
  truckPassTime: '07:55',
  exposureMinutes: 75,
  exposureComputed: true,
  bagsAtPass: 12,
  brokenBags: 3,
  dispersion: 'few',
  dispersionCauses: ['animals'],
  dispersionCauseOther: null,
  wasteRemainingAfterPass: false,
  photoBefore: { taken: true, code: 'F-P08-001' },
  photoAfter: { taken: false, code: null },
  music: null,
  createdByUserId: 'someone-else',
  createdAt: '2026-10-20T13:00:00.000Z',
  updatedAt: '2026-10-20T13:00:00.000Z',
};

describe('FieldSheetEditorPage', () => {
  it('computes the exposure from the two times, and asks for it only when one is missing', async () => {
    setup();
    await userEvent.type(await screen.findByLabelText('Hora de primera colocación'), '06:40');
    expect(screen.getByLabelText('Exposición (minutos)')).not.toHaveAttribute('readonly');

    await userEvent.type(screen.getByLabelText('Hora de paso del camión'), '07:55');
    const exposure = screen.getByLabelText('Exposición (minutos)');
    expect(exposure).toHaveValue('75');
    expect(exposure).toHaveAttribute('readonly');
  });

  it('shows the music section only at points that observe it', async () => {
    setup();
    await userEvent.selectOptions(await pointSelect(), 'P09');
    expect(screen.queryByText('7. Aviso con música')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Punto'), 'P08');
    expect(screen.getByText('7. Aviso con música')).toBeInTheDocument();
  });

  it('checks the required fields, sends the sheet and shows the API problems next to their fields', async () => {
    const api = setup();
    api.createObservation.mockRejectedValue(
      new PanelApiError(422, 'invalid_observation', [
        'broken_bags_exceed_bags',
        'other_cause_text_required',
      ]),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar ficha' }));
    expect(screen.getByText('Elige el punto observado.')).toBeInTheDocument();
    expect(api.createObservation).not.toHaveBeenCalled();

    await fillRequired();
    await userEvent.type(screen.getByLabelText('Bolsas al paso del camión'), '3');
    await userEvent.type(screen.getByLabelText('Bolsas rotas'), '5');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Otra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));

    expect(api.createObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        routeCode: 'RI-01',
        pointCode: 'P08',
        phase: 'baseline',
        observers: 'L.R., M.Q.',
        bagsAtPass: 3,
        brokenBags: 5,
        dispersionCauses: ['other'],
      }),
    );
    const broken = screen.getByLabelText('Bolsas rotas');
    expect(broken).toHaveAttribute('aria-invalid', 'true');
    expect(broken).toHaveAccessibleDescription(
      'Las bolsas rotas no pueden ser más que las bolsas al paso.',
    );
    expect(screen.getByLabelText('Otra causa')).toHaveAccessibleDescription(
      /Describe la otra causa\./,
    );
  });

  it("opens another observer's sheet read-only and explains why", async () => {
    const api = fakePanelApi(panelUser('observer'));
    api.getObservation.mockResolvedValue(SAVED);
    renderPanel('/panel/fichas/o-1', fakePanelDeps(api));

    expect(
      await screen.findByText('Esta ficha la registró otra persona: solo ella puede cambiarla.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar ficha' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bolsas rotas')).toBeDisabled();
  });

  it('lets a supervisor correct any sheet, sending the whole sheet back', async () => {
    const api = setup('supervisor', '/panel/fichas/o-1');
    api.getObservation.mockResolvedValue(SAVED);
    api.updateObservation.mockResolvedValue(SAVED);

    const bags = await screen.findByLabelText('Bolsas al paso del camión');
    await userEvent.clear(bags);
    await userEvent.type(bags, '14');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));

    expect(api.updateObservation).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({
        bagsAtPass: 14,
        exposureMinutes: null,
        photoBefore: { taken: true, code: 'F-P08-001' },
      }),
    );
    expect(await screen.findByText('Se guardó la ficha.')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Fichas de campo',
    );
  });
});
