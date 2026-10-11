import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi, type Mock } from 'vitest';

import { appRoutes } from '../../app/routes';
import type { PanelApi } from '../api/panel-api';
import type { PanelUser } from '../api/types';
import { PanelDepsContext, type PanelDeps } from '../panel-deps';
import { PANEL_ROUTE, panelUser } from './fixtures';

export type FakePanelApi = { [K in keyof PanelApi]: Mock<PanelApi[K]> };

const METHODS: readonly (keyof PanelApi)[] = [
  'login',
  'logout',
  'me',
  'listRoutes',
  'getRoute',
  'liveStreamUrl',
  'getLive',
  'listVehicles',
  'listTrips',
  'getTrip',
  'startTrip',
  'endTrip',
  'listIncidents',
  'createIncident',
  'updateIncident',
  'listHouseholds',
  'createHousehold',
  'updateHousehold',
  'getSticker',
  'listObservations',
  'getObservation',
  'createObservation',
  'updateObservation',
  'deleteObservation',
  'listBaselineLogs',
  'getBaselineLog',
  'createBaselineLog',
  'updateBaselineLog',
  'deleteBaselineLog',
  'getIndicators',
  'exportUrl',
  'listSurveys',
  'getSurvey',
  'createSurvey',
  'updateSurvey',
  'deleteSurvey',
  'importSurveys',
  'surveyTemplateUrl',
  'listUsers',
  'createUser',
  'updateUser',
];

const emptyPage = { items: [], page: 1, pageSize: 20, total: 0 };

/**
 * A fake panel API: signed in as `user` (null: signed out), serving RI-01 and empty lists. Every
 * other call stays pending until a test gives it an answer.
 */
export function fakePanelApi(user: PanelUser | null = panelUser()): FakePanelApi {
  const api = Object.fromEntries(
    METHODS.map((name) => [name, vi.fn(() => new Promise(() => undefined))]),
  ) as unknown as FakePanelApi;
  api.me.mockImplementation(() =>
    user === null ? Promise.reject(new Error('signed out')) : Promise.resolve(user),
  );
  api.logout.mockResolvedValue(undefined);
  api.listRoutes.mockResolvedValue([PANEL_ROUTE]);
  api.getRoute.mockResolvedValue(PANEL_ROUTE);
  api.liveStreamUrl.mockImplementation((code) => `/api/live/routes/${code}/stream`);
  api.exportUrl.mockImplementation((file) => `/api/panel/exports/${file}`);
  api.surveyTemplateUrl.mockReturnValue('/api/panel/household-surveys/template.csv');
  for (const list of [
    'listTrips',
    'listIncidents',
    'listHouseholds',
    'listObservations',
    'listBaselineLogs',
    'listSurveys',
  ] as const) {
    api[list].mockResolvedValue(emptyPage);
  }
  api.listUsers.mockResolvedValue(user === null ? [] : [user]);
  api.listVehicles.mockResolvedValue([]);
  return api;
}

export function fakePanelDeps(api: FakePanelApi = fakePanelApi()) {
  const expiredListeners = new Set<() => void>();
  const deps = {
    api,
    createEventSource: null,
    now: () => Date.parse('2026-10-20T22:30:00.000Z'),
    onSessionExpired: (listener: () => void) => {
      expiredListeners.add(listener);
      return () => expiredListeners.delete(listener);
    },
    print: vi.fn(),
  } satisfies PanelDeps;
  return { ...deps, expireSession: () => expiredListeners.forEach((listener) => listener()) };
}

/** Renders the whole app (panel lazily loaded) at `path` with fake panel dependencies. */
export function renderPanel(path: string, deps: PanelDeps = fakePanelDeps()) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <PanelDepsContext.Provider value={deps}>
      <RouterProvider router={router} />
    </PanelDepsContext.Provider>,
  );
  return router;
}
