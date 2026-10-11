import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
  });
});
