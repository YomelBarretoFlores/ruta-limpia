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
 * fitting a zero-sized map leaves the route as a speck in the middle.
 */
export function FitRouteBounds({ route }: { readonly route: RouteShape }) {
  const map = useMap();
  // Keyed by value: a new object for the same route (a refetch) keeps the reader's pan and zoom.
  const key = JSON.stringify(routeLatLngs(route));

  useEffect(() => {
    map.invalidateSize();
    map.fitBounds(latLngBounds(JSON.parse(key) as LatLngTuple[]), FIT_OPTIONS);
  }, [map, key]);

  return null;
}
