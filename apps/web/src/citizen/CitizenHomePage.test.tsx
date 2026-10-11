import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../shared/http';
import { CitizenDepsContext, type CitizenDeps } from './citizen-deps';
import { CitizenHomePage } from './CitizenHomePage';
import { fakeApi, fakeDeps, fakeStorage } from './test/fake-deps';
import { snapshot, trip } from './test/fixtures';

// Leaflet needs a real layout engine; the map has its own text equivalents in the card.
vi.mock('./components/RouteMap', () => ({
  RouteMap: ({ highlightedPointCode }: { highlightedPointCode: string | null }) => (
    <div data-testid="map">{highlightedPointCode}</div>
  ),
}));

function renderAt(path: string, deps: CitizenDeps) {
  const router = createMemoryRouter([{ path: '/', element: <CitizenHomePage /> }], {
    initialEntries: [path],
  });
  render(
    <CitizenDepsContext.Provider value={deps}>
      <RouterProvider router={router} />
    </CitizenDepsContext.Provider>,
  );
}

describe('CitizenHomePage', () => {
  it('preselects the point of the QR link and shows its arrival window', async () => {
    const deps = fakeDeps();

    renderAt('/?r=ri-01&p=p08&h=H-001', deps);

    expect(await screen.findByText('Llegada estimada:', { exact: false })).toHaveTextContent(
      '8 a 12 minutos',
    );
    expect(screen.getByTestId('map')).toHaveTextContent('P08');
    expect(screen.getByText('Se actualiza cada 30 s')).toBeInTheDocument();
    expect(deps.api.getRoute).toHaveBeenCalledWith('RI-01');
    expect(JSON.parse(deps.storage.data.get('ruta-limpia:preferences')!)).toEqual({
      routeCode: 'RI-01',
      pointCode: 'P08',
      householdCode: 'H-001',
    });
    expect(deps.api.recordView).toHaveBeenCalledWith({ pointCode: 'P08', routeCode: 'RI-01' });
  });

  it('uses the saved point and the first route without a link, and links views to the subscription', async () => {
    const storage = fakeStorage({
      'ruta-limpia:preferences': JSON.stringify({ routeCode: null, pointCode: 'P09' }),
    });
    const deps = fakeDeps({
      storage,
      viewCredentials: () => Promise.resolve({ subscriptionId: 's-1', managementToken: 't-1' }),
    });

    renderAt('/', deps);

    expect(await screen.findByText('P09', { selector: 'strong' })).toBeInTheDocument();
    expect(deps.api.listRoutes).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(deps.api.recordView).toHaveBeenCalledWith({
        pointCode: 'P09',
        routeCode: 'RI-01',
        subscriptionId: 's-1',
        managementToken: 't-1',
      }),
    );
  });

  it('drops a point that is not on the route', async () => {
    const deps = fakeDeps();

    renderAt('/?r=RI-01&p=P77', deps);

    expect(await screen.findByText(/Escanea el código QR/)).toBeInTheDocument();
    expect(deps.api.recordView).not.toHaveBeenCalled();
  });

  it('falls back to the catalog when the linked route no longer exists', async () => {
    const api = fakeApi(snapshot([trip({ signal: 'stale' })]));
    api.getRoute.mockRejectedValueOnce(new ApiError(404, 'route_not_found'));

    renderAt('/?r=XX-99&p=P08', fakeDeps({ api }));

    expect(await screen.findByText(/Sin actualización/)).toBeInTheDocument();
    expect(api.listRoutes).toHaveBeenCalled();
  });

  it('explains when the route cannot be loaded', async () => {
    const api = fakeApi();
    api.listRoutes.mockRejectedValue(new TypeError('Failed to fetch'));

    renderAt('/', fakeDeps({ api }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la ruta');
  });
});
