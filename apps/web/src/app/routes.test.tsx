import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { CitizenDepsContext } from '../citizen/citizen-deps';
import { fakeApi, fakeDeps } from '../citizen/test/fake-deps';
import { appRoutes } from './routes';

function renderAt(path: string) {
  const api = fakeApi();
  // The citizen page stays on its loading state: this test only checks the routing.
  api.listRoutes.mockReturnValue(new Promise(() => undefined));
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <CitizenDepsContext.Provider value={fakeDeps({ api })}>
      <RouterProvider router={router} />
    </CitizenDepsContext.Provider>,
  );
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
});
