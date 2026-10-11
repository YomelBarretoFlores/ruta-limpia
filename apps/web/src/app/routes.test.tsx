import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { CitizenDepsContext } from '../citizen/citizen-deps';
import { fakeApi, fakeDeps, type FakeApi } from '../citizen/test/fake-deps';
import { ROUTE } from '../citizen/test/fixtures';
import { PanelDepsContext } from '../panel/panel-deps';
import { fakePanelApi, fakePanelDeps } from '../panel/test/fake-panel-deps';
import { appRoutes } from './routes';

/** Every module outside the panel (tests and test helpers aside), as source text. */
const citizenSources: Record<string, string> = import.meta.glob(
  ['../**/*.{ts,tsx}', '!../panel/**', '!../**/*.test.{ts,tsx}', '!../**/test/**'],
  { query: '?raw', import: 'default', eager: true },
);

/**
 * The paths a module imports or re-exports statically: `import … from`, side-effect imports and
 * `export … from` (a dynamic `import()` is not one of them).
 */
function staticImports(source: string): string[] {
  const statement =
    /^\s*(?:import\s+(?:[\w*{}\s,]+?\s+from\s+)?|export\s+[\w*{}\s,]+?\s+from\s+)['"]([^'"]+)['"]/gm;
  return [...source.matchAll(statement)].map((match) => match[1] ?? '');
}

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

  it('finds every kind of static import and re-export, but not a dynamic import', () => {
    const source = [
      "import './side-effect.css';",
      "import { a, type B } from '../panel/a';",
      'import Default, {',
      '  c as d,',
      "} from '../panel/multi-line';",
      "import * as all from '../panel/namespace';",
      "import type { T } from '../panel/types';",
      "export { e } from '../panel/re-export';",
      "export * from '../panel/star';",
      "export type { F } from '../panel/type-re-export';",
      "const lazy = () => import('../panel/PanelApp');",
      "export const text = 'not an import';",
    ].join('\n');

    expect(staticImports(source)).toEqual([
      './side-effect.css',
      '../panel/a',
      '../panel/multi-line',
      '../panel/namespace',
      '../panel/types',
      '../panel/re-export',
      '../panel/star',
      '../panel/type-re-export',
    ]);
  });

  it('keeps the panel out of the citizen bundle: no citizen module imports it statically', () => {
    const offenders = Object.entries(citizenSources).filter(([, source]) =>
      staticImports(source).some((path) => /(^|\/)panel(\/|$)/.test(path)),
    );

    expect(Object.keys(citizenSources)).toEqual(
      expect.arrayContaining(['../main.tsx', './routes.tsx', './LazyPanel.tsx']),
    );
    expect(offenders.map(([file]) => file)).toEqual([]);
    expect(citizenSources['./LazyPanel.tsx']).toContain("import('../panel/PanelApp')");
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
