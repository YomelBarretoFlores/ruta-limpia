import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { CitizenDepsContext } from '../citizen/citizen-deps';
import { fakeApi, fakeDeps, type FakeApi } from '../citizen/test/fake-deps';
import { ROUTE } from '../citizen/test/fixtures';
import { appRoutes } from './routes';

function renderAt(path: string, api: FakeApi = loadingApi()) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <CitizenDepsContext.Provider value={fakeDeps({ api })}>
      <RouterProvider router={router} />
    </CitizenDepsContext.Provider>,
  );
}

/** The citizen page stays on its loading state: these tests only check the routing. */
function loadingApi() {
  const api = fakeApi();
  api.listRoutes.mockReturnValue(new Promise(() => undefined));
  return api;
}

describe('app routes', () => {
  it('renders the citizen home at /', () => {
    renderAt('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Ruta Limpia' })).toBeInTheDocument();
  });

  it('renders the municipal panel at /panel', () => {
    renderAt('/panel');

    expect(screen.getByRole('heading', { level: 1, name: 'Panel municipal' })).toBeInTheDocument();
  });

  it('shows a calm Spanish page when the citizen page fails to render', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const api = fakeApi();
      // An unexpected answer: a route without its points.
      api.getRoute.mockResolvedValue({ ...ROUTE, points: undefined } as unknown as typeof ROUTE);

      renderAt('/?r=RI-01&p=P08', api);

      expect(await screen.findByText('No pudimos mostrar la página')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Volver a cargar' })).toBeInTheDocument();
    } finally {
      quiet.mockRestore();
    }
  });
});
