import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { appRoutes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
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
