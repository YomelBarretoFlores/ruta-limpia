import { latLngBounds, type LatLngTuple } from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

import { FIT_OPTIONS, type RouteShape } from './map-view';

/** The route's line and its reference points, as Leaflet `[lat, lon]` pairs. */
function routeLatLngs(route: RouteShape): LatLngTuple[] {
  return [
    ...route.geometry.coordinates.map(([lon, lat]): LatLngTuple => [lat, lon]),
    ...route.points.map((p): LatLngTuple => [p.lat, p.lon]),
  ];
}

/**
 * Fits the map to the whole route once it is laid out, and again when the route changes. The
 * container's size is re-read first: the map may be created before its lazy styles apply, and
 * fitting a zero-sized map leaves the route as a speck in the middle. `also` adds positions
 * (`[lon, lat]`) that must be in view too, such as a trip's GPS track that left the route.
 */
export function FitRouteBounds({
  route,
  also = null,
}: {
  readonly route: RouteShape;
  readonly also?: readonly (readonly [number, number])[] | null;
}) {
  const map = useMap();
  // Keyed by value: a new object for the same route (a refetch) keeps the reader's pan and zoom.
  const key = JSON.stringify([
    ...routeLatLngs(route),
    ...(also ?? []).map(([lon, lat]): LatLngTuple => [lat, lon]),
  ]);

  useEffect(() => {
    map.invalidateSize();
    map.fitBounds(latLngBounds(JSON.parse(key) as LatLngTuple[]), FIT_OPTIONS);
  }, [map, key]);

  return null;
}
