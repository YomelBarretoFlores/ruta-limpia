import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PanelApiError } from '../api/panel-api';
import type { Survey } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';

const SURVEY = {
  id: 's-1',
  householdCode: 'H-001',
  routeCode: 'RI-01',
  wave: 'post',
  surveyedOn: '2026-12-15',
  leadTime: '0_15',
  satisfaction: 5,
  importBatchId: 'batch-1',
} as Survey;

const csvFile = (text: string) => new File([text], 'encuestas.csv', { type: 'text/csv' });

describe('SurveysPage', () => {
  it('lists the route surveys with where they came from', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.listSurveys.mockResolvedValue({ items: [SURVEY], page: 1, pageSize: 20, total: 1 });
    renderPanel('/panel/encuestas', fakePanelDeps(api));

    const table = await screen.findByRole('table', { name: 'Encuestas a hogares' });
    expect(api.listSurveys).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'RI-01', page: 1 }),
    );
    const row = within(table).getByRole('row', { name: /H-001/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Post',
      '15/12/2026',
      '0–15 min',
      '5',
      'Archivo CSV',
      'Abrir la encuesta Post de H-001',
    ]);
    expect(screen.getByRole('link', { name: 'Descargar plantilla' })).toHaveAttribute(
      'href',
      '/api/panel/household-surveys/template.csv',
    );
  });

  it('imports a file and reports the surveys created and replaced', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    api.importSurveys.mockResolvedValue({ batchId: 'b', created: 2, updated: 1 });
    renderPanel('/panel/encuestas', fakePanelDeps(api));

    await userEvent.upload(
      await screen.findByLabelText('Archivo CSV'),
      csvFile('household_code,wave,surveyed_on\nH-001,pre,2026-10-15\n'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Importar archivo' }));

    expect(api.importSurveys).toHaveBeenCalledWith(
      'household_code,wave,surveyed_on\nH-001,pre,2026-10-15\n',
    );
    expect(
      await screen.findByText('Se importaron 3 encuestas: 2 nuevas y 1 reemplazadas.'),
    ).toBeInTheDocument();
    expect(api.listSurveys).toHaveBeenCalledTimes(2);
  });

  it('lists every problem of a refused file by line, and says nothing was imported', async () => {
    const api = fakePanelApi(panelUser('admin'));
    api.importSurveys.mockRejectedValue(
      new PanelApiError(422, 'invalid_rows', [], null, null, [
        { line: 3, column: 'household_code', problem: 'unknown_household' },
        { line: 5, column: null, problem: 'duplicate_of_line_2' },
      ]),
    );
    renderPanel('/panel/encuestas', fakePanelDeps(api));

    await userEvent.upload(await screen.findByLabelText('Archivo CSV'), csvFile('x'));
    await userEvent.click(screen.getByRole('button', { name: 'Importar archivo' }));

    expect(await screen.findByText('No se importó ninguna encuesta')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Problemas del archivo' });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      '3household_codeNo hay un hogar inscrito con este código.',
      '5Toda la filaRepite el hogar y la aplicación de la línea 2.',
    ]);
  });

  it('asks for a file before importing', async () => {
    const api = fakePanelApi(panelUser('supervisor'));
    renderPanel('/panel/encuestas', fakePanelDeps(api));

    await userEvent.click(await screen.findByRole('button', { name: 'Importar archivo' }));

    expect(screen.getByText('Elige el archivo a importar.')).toBeInTheDocument();
    expect(api.importSurveys).not.toHaveBeenCalled();
  });
});
