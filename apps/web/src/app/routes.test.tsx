import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { CitizenDepsContext } from '../citizen/citizen-deps';
import { fakeApi, fakeDeps, type FakeApi } from '../citizen/test/fake-deps';
import { ROUTE } from '../citizen/test/fixtures';
import { PanelDepsContext } from '../panel/panel-deps';
import { fakePanelApi, fakePanelDeps } from '../panel/test/fake-panel-deps';
import mainSource from '../main.tsx?raw';
import lazyPanelSource from './LazyPanel.tsx?raw';
import routesSource from './routes.tsx?raw';
import { appRoutes } from './routes';

function renderAt(path: string, api: FakeApi = loadingApi()) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <CitizenDepsContext.Provider value={fakeDeps({ api })}>
      <PanelDepsContext.Provider value={fakePanelDeps(fakePanelApi(null))}>
        <RouterProvider router={router} />
      </PanelDepsContext.Provider>
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

  it('loads the municipal panel at /panel, starting with the sign-in page', async () => {
    renderAt('/panel');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ingresar al panel' }),
    ).toBeInTheDocument();
  });

  it('keeps the panel out of the citizen bundle: it is only imported dynamically', () => {
    const staticImports = (source: string) =>
      [...source.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((match) => match[1] ?? '');
    const importsPanel = (source: string) =>
      staticImports(source).some((path) => path.includes('/panel/'));

    expect(importsPanel(mainSource)).toBe(false);
    expect(importsPanel(routesSource)).toBe(false);
    expect(importsPanel(lazyPanelSource)).toBe(false);
    expect(lazyPanelSource).toContain("import('../panel/PanelApp')");
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
