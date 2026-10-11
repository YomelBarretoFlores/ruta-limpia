import { render } from '@testing-library/react';
import type { FitBoundsOptions, LatLngBounds } from 'leaflet';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FitRouteBounds } from './FitRouteBounds';
import { FIT_OPTIONS, type RouteShape } from './map-view';

const ROUTE: RouteShape = {
  geometry: {
    coordinates: [
      [-77.52855, -9.523468],
      [-77.5279, -9.5241],
      [-77.5271, -9.5249],
    ],
  },
  points: [
    { lat: -9.5232, lon: -77.5286 },
    { lat: -9.5241, lon: -77.5279 },
    { lat: -9.5249, lon: -77.5271 },
  ],
};

const map = {
  fitBounds: vi.fn<(bounds: LatLngBounds, options: FitBoundsOptions) => void>(),
  invalidateSize: vi.fn(),
};
vi.mock('react-leaflet', () => ({ useMap: () => map }));

beforeEach(() => {
  map.fitBounds.mockClear();
  map.invalidateSize.mockClear();
});

describe('FitRouteBounds', () => {
  it('fits the map to the whole route with padding when it mounts', () => {
    render(<FitRouteBounds route={ROUTE} />);

    expect(map.invalidateSize).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledOnce();
    const [bounds, options] = map.fitBounds.mock.calls[0]!;
    expect(bounds.getSouthWest()).toMatchObject({ lat: -9.5249, lng: -77.5286 });
    // The line and every reference point are inside (P01 lies just off the line's first vertex).
    expect(bounds.getNorthEast()).toMatchObject({ lat: -9.5232, lng: -77.5271 });
    expect(options).toEqual(FIT_OPTIONS);
    expect(FIT_OPTIONS.padding).toEqual([24, 24]);
  });

  it('fits again only when the route changes', () => {
    const { rerender } = render(<FitRouteBounds route={ROUTE} />);
    rerender(<FitRouteBounds route={{ ...ROUTE }} />);
    expect(map.fitBounds).toHaveBeenCalledOnce();

    rerender(<FitRouteBounds route={{ ...ROUTE, points: ROUTE.points.slice(1) }} />);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });
});
