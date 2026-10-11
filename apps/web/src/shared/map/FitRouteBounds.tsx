import { latLngBounds, type LatLngTuple } from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

import { FIT_OPTIONS, type RouteShape } from './map-view';

/** The south, west, north and east edges of `[lon, lat]` and `{ lat, lon }` positions. */
function extentOf(
  lonLats: readonly (readonly [number, number])[],
  points: readonly { readonly lat: number; readonly lon: number }[],
): string {
  let [south, west, north, east] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (lat: number, lon: number) => {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  };
  for (const [lon, lat] of lonLats) add(lat, lon);
  for (const point of points) add(point.lat, point.lon);
  return [south, west, north, east].join(',');
}

/**
 * Fits the map to the whole route once it is laid out, and again when the extent to show changes.
 * The container's size is re-read first: the map may be created before its lazy styles apply, and
 * fitting a zero-sized map leaves the route as a speck in the middle. `also` adds positions
 * (`[lon, lat]`) that must be in view too, such as a trip's GPS track that left the route.
 *
 * The effect is keyed by the extent (four numbers, one pass over the positions), not by the
 * positions themselves: a refetch, or a longer track inside the same extent, keeps the reader's
 * pan and zoom, and a track of thousands of positions is never serialized.
 */
export function FitRouteBounds({
  route,
  also = null,
}: {
  readonly route: RouteShape;
  readonly also?: readonly (readonly [number, number])[] | null;
}) {
  const map = useMap();
  const extent = extentOf([...route.geometry.coordinates, ...(also ?? [])], route.points);

  useEffect(() => {
    const [south = 0, west = 0, north = 0, east = 0] = extent.split(',').map(Number);
    const corners: LatLngTuple[] = [
      [south, west],
      [north, east],
    ];
    map.invalidateSize();
    map.fitBounds(latLngBounds(corners), FIT_OPTIONS);
  }, [map, extent]);

  return null;
}
