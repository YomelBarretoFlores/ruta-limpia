import 'leaflet/dist/leaflet.css';
import '../../shared/map/route-map.css';

import { canvas, divIcon, latLngBounds, type LatLngTuple } from 'leaflet';
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

import { FitRouteBounds } from '../../shared/map/FitRouteBounds';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_SNAP, type RouteShape } from '../../shared/map/map-view';
import { MAP_COLORS, TRUCK_ICON_SIZE, truckIconSvg } from '../../shared/map/truck-icon';
import { formatLocalTime } from '../../shared/time';
import {
  decimateTrack,
  plannedRouteStyle,
  TRACK_LINE,
  TRACK_VERTEX,
  TRACK_VERTEX_RADIUS,
} from './map-styles';

export interface PanelMapTruck {
  readonly lat: number;
  readonly lon: number;
  /** The signal is not live: drawn hollow with "Última posición HH:MM". */
  readonly stale: boolean;
  readonly fixTime: string;
  readonly course: number | null;
}

export interface PanelRouteMapProps {
  readonly route: {
    readonly code: string;
    readonly geometry: RouteShape['geometry'];
    readonly points: readonly {
      readonly code: string;
      readonly name: string;
      readonly lat: number;
      readonly lon: number;
    }[];
  };
  readonly truck?: PanelMapTruck | null;
  /**
   * A recorded trip's track (`[lon, lat]`): a solid ink line through every position, with dots at
   * up to 200 evenly spaced ones (drawn on one canvas), over a lighter planned route; the map fits
   * the route and the track together.
   */
  readonly track?: readonly (readonly [number, number])[] | null;
  readonly label: string;
}

const POINT = { color: MAP_COLORS.ink, weight: 1.5, fillColor: MAP_COLORS.surface, fillOpacity: 1 };

/**
 * The route on muted tiles for the panel: the planned line, its reference points (labelled on
 * hover), the truck (hollow when its signal is not live) and, for a past trip, its GPS track
 * (the planned line then steps back, so the track reads as the trip).
 */
export default function PanelRouteMap({
  route,
  truck = null,
  track = null,
  label,
}: PanelRouteMapProps) {
  const line: LatLngTuple[] = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const trackLine = useMemo(
    () => (track ?? []).map(([lon, lat]): LatLngTuple => [lat, lon]),
    [track],
  );
  const hasTrack = trackLine.length > 1;
  const vertices = useMemo(() => decimateTrack(trackLine), [trackLine]);
  // One canvas for every dot, instead of an SVG element per dot.
  const vertexStyle = useMemo(() => ({ ...TRACK_VERTEX, renderer: canvas() }), []);
  const planned = plannedRouteStyle(hasTrack);
  const stale = truck?.stale ?? false;
  const course = truck?.course ?? null;
  const icon = useMemo(
    () =>
      divIcon({
        className: 'truck-marker',
        html: truckIconSvg({ stale, course }),
        iconSize: [TRUCK_ICON_SIZE, TRUCK_ICON_SIZE],
        iconAnchor: [TRUCK_ICON_SIZE / 2, TRUCK_ICON_SIZE / 2],
      }),
    [stale, course],
  );
  const lastSeen = formatLocalTime(truck?.fixTime);

  return (
    <div className="route-map panel-map" role="region" aria-label={label}>
      <MapContainer
        bounds={latLngBounds(line)}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        zoomSnap={ZOOM_SNAP}
        zoomDelta={0.5}
        scrollWheelZoom={false}
        attributionControl={false}
        className="panel-map__canvas"
      >
        <AttributionControl prefix={false} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={MAX_ZOOM}
        />
        <FitRouteBounds route={route} also={hasTrack ? track : null} />
        <Polyline positions={line} pathOptions={planned.casing} interactive={false} />
        <Polyline positions={line} pathOptions={planned.line} interactive={false} />
        {hasTrack && (
          <>
            <Polyline positions={trackLine} pathOptions={TRACK_LINE} interactive={false} />
            {vertices.map((position, index) => (
              <CircleMarker
                key={index}
                center={position}
                radius={TRACK_VERTEX_RADIUS}
                pathOptions={vertexStyle}
                interactive={false}
              />
            ))}
          </>
        )}
        {route.points.map((point) => (
          <CircleMarker
            key={point.code}
            center={[point.lat, point.lon]}
            radius={4}
            pathOptions={POINT}
          >
            <Tooltip direction="top" offset={[0, -5]}>
              {point.code} · {point.name}
            </Tooltip>
          </CircleMarker>
        ))}
        {truck !== null && (
          <Marker
            position={[truck.lat, truck.lon]}
            icon={icon}
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
