import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import type { Survey } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

const STORED = {
  id: 's-1',
  householdCode: 'H-001',
  routeCode: 'RI-01',
  wave: 'post',
  surveyedOn: '2026-12-15',
  knowsSchedule: true,
  leadTime: '0_15',
  missedPickups: null,
  litterSeen: null,
  separates: null,
  alertsHelped: 4,
  easyToUse: null,
  etaReliable: null,
  streetCleaner: null,
  keepSystem: null,
  satisfaction: 5,
  annoyance: null,
  notHeard: false,
  interrupted: null,
  channels: [],
  channelOther: null,
  access: null,
  altChannel: null,
  importBatchId: null,
  createdAt: '2026-12-15T15:00:00.000Z',
  updatedAt: '2026-12-15T15:00:00.000Z',
} as Survey;

afterEach(() => {
  vi.restoreAllMocks();
});

function editing(user = panelUser('supervisor')) {
  const api = fakePanelApi(user);
  api.getSurvey.mockResolvedValue(STORED);
  api.listSurveys.mockResolvedValue({ items: [STORED], page: 1, pageSize: 20, total: 1 });
  renderPanel('/panel/encuestas/s-1', fakePanelDeps(api));
  return api;
}

describe('SurveyEditorPage', () => {
  it('asks questions 6 to 11 only for the post wave and sends the coded answers', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.createSurvey.mockResolvedValue({} as never);
    renderPanel('/panel/encuestas/nueva', fakePanelDeps(api));

    await userEvent.type(await screen.findByLabelText('Código del hogar'), 'h-007');
    await userEvent.click(screen.getByRole('radio', { name: 'Pre' }));
    expect(screen.queryByText(/Preguntas 6 a 11/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Post' }));
    expect(screen.getByText('Preguntas 6 a 11 (solo post)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Después del paso' }));
    await userEvent.click(screen.getByRole('radio', { name: '4 Satisfecho' }));
    const q12 = screen.getByRole('group', { name: /^12\./ });
    await userEvent.click(within(q12).getByRole('radio', { name: 'No la escuché' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Otro' }));
    await userEvent.type(screen.getByLabelText('Otro medio'), 'Radio local');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar encuesta' }));

    expect(api.createSurvey).toHaveBeenCalledWith(
      expect.objectContaining({
        householdCode: 'H-007',
        wave: 'post',
        surveyedOn: '2026-10-20',
        leadTime: 'after_pass',
        satisfaction: 4,
        alertsHelped: null,
        annoyance: null,
        notHeard: true,
        channels: ['other'],
        channelOther: 'Radio local',
      }),
    );
    expect(await screen.findByText('Se guardó la encuesta.')).toBeInTheDocument();
  });

  it('asks for the household and the wave, and explains a second survey of a wave', async () => {
    const api = fakePanelApi(panelUser('admin'));
    api.createSurvey.mockRejectedValue(new PanelApiError(409, 'duplicate_survey'));
    renderPanel('/panel/encuestas/nueva', fakePanelDeps(api));

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar encuesta' }));
    expect(screen.getByText('Elige si es la aplicación pre o post.')).toBeInTheDocument();
    expect(api.createSurvey).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Código del hogar'), 'H-001');
    await userEvent.click(screen.getByRole('radio', { name: 'Pre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar encuesta' }));
    expect(
      await screen.findByText(/Ese hogar ya tiene una encuesta de esta aplicación/),
    ).toBeInTheDocument();
  });

  it('opens a stored survey, keeps its household and wave, and saves the edit', async () => {
    const api = editing();
    api.updateSurvey.mockResolvedValue(STORED);

    expect(
      await screen.findByRole('heading', { name: 'Encuesta de H-001 · Post' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Código del hogar')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Pre' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: '3 Neutral' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar encuesta' }));

    expect(api.updateSurvey).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ householdCode: 'H-001', wave: 'post', satisfaction: 3 }),
    );
    expect(api.createSurvey).not.toHaveBeenCalled();
    expect(await screen.findByText('Se guardó la encuesta.')).toBeInTheDocument();
  });

  it('deletes a survey only after the confirmation', async () => {
    const api = editing();
    api.deleteSurvey.mockResolvedValue(undefined);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar encuesta' }));
    expect(api.deleteSurvey).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar encuesta' }));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.deleteSurvey).toHaveBeenCalledWith('s-1');
    expect(await screen.findByRole('heading', { name: 'Encuestas' })).toBeInTheDocument();
  });

  it('says so when the survey cannot be opened', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.getSurvey.mockRejectedValue(new PanelApiError(404, 'not_found'));
    renderPanel('/panel/encuestas/s-404', fakePanelDeps(api));

    expect(await screen.findByText('No se pudo abrir la encuesta')).toBeInTheDocument();
    expect(screen.getByText(/No se encontró la encuesta/)).toBeInTheDocument();
  });

  it('shows the inconsistencies the API finds next to their questions', async () => {
    const api = editing();
    api.updateSurvey.mockRejectedValue(
      new PanelApiError(422, 'invalid_survey', ['annoyance_and_not_heard']),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar encuesta' }));

    expect(
      await screen.findByText('La encuesta tiene respuestas que no cuadran'),
    ).toBeInTheDocument();
    const q12 = screen.getByRole('group', { name: /^12\./ });
    expect(
      within(q12).getByText('Elige un puntaje o «No la escuché», no ambos.'),
    ).toBeInTheDocument();
  });

  it('falls back to a general message for a problem the panel does not know', async () => {
    const api = editing();
    api.updateSurvey.mockRejectedValue(
      new PanelApiError(422, 'invalid_survey', ['a_future_problem' as never]),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar encuesta' }));

    expect(
      await screen.findByText(
        /La encuesta no se pudo guardar por una respuesta que el panel no reconoce/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Revisa las preguntas marcadas.')).not.toBeInTheDocument();
  });

  it('shows a stored survey read-only to a user who may read but not write surveys', async () => {
    const reader = panelUser('observer', { permissions: ['live:read', 'surveys:read'] });
    editing(reader);

    expect(await screen.findByText('Solo lectura')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toBeDisabled();
    expect(screen.getByRole('radio', { name: '5 Muy satisfecho' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar encuesta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar encuesta' })).not.toBeInTheDocument();
  });
});
