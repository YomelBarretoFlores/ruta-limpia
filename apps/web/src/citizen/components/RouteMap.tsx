import 'leaflet/dist/leaflet.css';
import '../../shared/map/route-map.css';

import { divIcon, latLngBounds, type LatLngTuple } from 'leaflet';
import { useMemo } from 'react';
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
} from 'react-leaflet';

import { formatLocalTime } from '../../shared/time';
import type { RouteDetail } from '../api/types';
import type { TruckPosition } from '../live/live-state';
import { FitRouteBounds } from '../../shared/map/FitRouteBounds';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_SNAP } from '../../shared/map/map-view';
import { MAP_COLORS, TRUCK_ICON_SIZE, truckIconSvg } from '../../shared/map/truck-icon';

export interface RouteMapProps {
  readonly route: RouteDetail;
  readonly highlightedPointCode: string | null;
  readonly truck: TruckPosition | null;
}

/** Route line: a 6 px accent stroke over a 9 px white casing, so it reads on any tile. */
const CASING = { color: MAP_COLORS.surface, weight: 9, opacity: 1, lineCap: 'round' } as const;
const LINE = { color: MAP_COLORS.accent, weight: 6, opacity: 1, lineCap: 'round' } as const;
/**
 * Reference points: 8 px white circles with a 1.5 px ink stroke, small enough that the route line
 * stays visible between them (the points of RI-01 are about 90 m apart).
 */
const POINT = { color: MAP_COLORS.ink, weight: 1.5, fillColor: MAP_COLORS.surface, fillOpacity: 1 };

/** The household's point: a 14 px accent circle with a white stroke. */
const HOUSEHOLD_POINT = {
  color: MAP_COLORS.surface,
  weight: 2,
  fillColor: MAP_COLORS.accent,
  fillOpacity: 1,
};

/**
 * The route on muted OpenStreetMap tiles: the line, its reference points (the household's point
 * labelled) and the truck. Everything shown here is also given as text in the arrival section.
 */
export function RouteMap({ route, highlightedPointCode, truck }: RouteMapProps) {
  const line: LatLngTuple[] = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const highlighted = route.points.find((p) => p.code === highlightedPointCode);
  const stale = truck?.stale ?? false;
  const course = truck?.course ?? null;
  const lastSeen = formatLocalTime(truck?.fixTime);
  const truckIcon = useMemo(
    () =>
      divIcon({
        className: 'truck-marker',
        html: truckIconSvg({ stale, course }),
        iconSize: [TRUCK_ICON_SIZE, TRUCK_ICON_SIZE],
        iconAnchor: [TRUCK_ICON_SIZE / 2, TRUCK_ICON_SIZE / 2],
      }),
    [stale, course],
  );

  return (
    <div className="route-map" role="region" aria-label={`Mapa del tramo ${route.code}`}>
      <MapContainer
        bounds={latLngBounds(line)}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomSnap={ZOOM_SNAP}
        zoomDelta={0.5}
        scrollWheelZoom={false}
        attributionControl={false}
        className="route-map__canvas"
      >
        {/* The OpenStreetMap credit only, without Leaflet's flag prefix. */}
        <AttributionControl prefix={false} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={MAX_ZOOM}
        />
        <FitRouteBounds route={route} />
        <Polyline positions={line} pathOptions={CASING} interactive={false} />
        <Polyline positions={line} pathOptions={LINE} interactive={false} />
        {route.points
          .filter((p) => p !== highlighted)
          .map((p) => (
            <CircleMarker key={p.code} center={[p.lat, p.lon]} radius={4} pathOptions={POINT}>
              <Tooltip direction="top" offset={[0, -5]}>
                {p.code} · {p.name}
              </Tooltip>
            </CircleMarker>
          ))}
        {highlighted !== undefined && (
          <CircleMarker
            center={[highlighted.lat, highlighted.lon]}
            radius={7}
            pathOptions={HOUSEHOLD_POINT}
          >
            <Tooltip permanent direction="top" offset={[0, -8]} className="map-label">
              Tu punto · {highlighted.code}
            </Tooltip>
          </CircleMarker>
        )}
        {truck !== null && (
          <Marker
            position={[truck.lat, truck.lon]}
            icon={truckIcon}
            title="Camión recolector"
            keyboard={false}
            zIndexOffset={1000}
          >
            {truck.stale && (
              <Tooltip permanent direction="bottom" offset={[0, 10]} className="map-label">
                {lastSeen === null ? 'Última posición' : `Última posición ${lastSeen}`}
              </Tooltip>
            )}
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
