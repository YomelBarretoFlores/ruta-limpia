import 'leaflet/dist/leaflet.css';

import { divIcon, latLngBounds, type LatLngTuple } from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip } from 'react-leaflet';

import type { RouteDetail } from '../api/types';

export interface RouteMapProps {
  readonly route: RouteDetail;
  readonly highlightedPointCode: string | null;
  readonly truck: { readonly lat: number; readonly lon: number; readonly stale: boolean } | null;
}

const ROUTE_COLOR = '#1a6b4f';
const POINT_COLOR = '#155a42';
const HIGHLIGHT_COLOR = '#c2410c';

const truckIcon = (stale: boolean) =>
  divIcon({
    className: `truck-marker${stale ? ' truck-marker--stale' : ''}`,
    html: '<span aria-hidden="true">🚛</span>',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
const TRUCK_ICON = truckIcon(false);
const STALE_TRUCK_ICON = truckIcon(true);

/**
 * The route line, its reference points (the household's point highlighted) and the truck, on
 * OpenStreetMap tiles. Everything shown here is also given as text in the arrival card.
 */
export function RouteMap({ route, highlightedPointCode, truck }: RouteMapProps) {
  const line: LatLngTuple[] = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const highlighted = route.points.find((p) => p.code === highlightedPointCode);
  return (
    <div className="route-map" role="region" aria-label={`Mapa del tramo ${route.code}`}>
      <MapContainer
        bounds={latLngBounds(line).pad(0.15)}
        scrollWheelZoom={false}
        className="route-map__canvas"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <Polyline positions={line} pathOptions={{ color: ROUTE_COLOR, weight: 6, opacity: 0.8 }} />
        {route.points
          .filter((p) => p !== highlighted)
          .map((p) => (
            <CircleMarker
              key={p.code}
              center={[p.lat, p.lon]}
              radius={7}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: POINT_COLOR, fillOpacity: 1 }}
            >
              <Tooltip>
                {p.code} · {p.name}
              </Tooltip>
            </CircleMarker>
          ))}
        {highlighted !== undefined && (
          <CircleMarker
            center={[highlighted.lat, highlighted.lon]}
            radius={12}
            pathOptions={{
              color: '#ffffff',
              weight: 3,
              fillColor: HIGHLIGHT_COLOR,
              fillOpacity: 1,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>
              Tu punto {highlighted.code}
            </Tooltip>
          </CircleMarker>
        )}
        {truck !== null && (
          <Marker
            position={[truck.lat, truck.lon]}
            icon={truck.stale ? STALE_TRUCK_ICON : TRUCK_ICON}
            title="Camión recolector"
            keyboard={false}
          />
        )}
      </MapContainer>
    </div>
  );
}
