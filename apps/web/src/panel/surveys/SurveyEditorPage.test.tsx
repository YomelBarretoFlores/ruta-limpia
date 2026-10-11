import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

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
});
