import './citizen.css';

import { useLocation } from 'react-router';

import { Notice } from '../shared/ui/Notice';
import { useCitizenDeps } from './citizen-deps';
import { ArrivalCard } from './components/ArrivalCard';
import { RouteMap } from './components/RouteMap';
import { useCitizenRoute } from './hooks/useCitizenRoute';
import { useLiveRoute } from './hooks/useLiveRoute';
import { useViewReporting } from './hooks/useViewReporting';
import { selectArrival, selectTruckPosition } from './live/live-state';

/**
 * Citizen area (`/`): the truck on the map and its arrival at the household's reference point.
 * Container: it resolves the route and point, keeps the live state and reports app views; the
 * cards only render what they are given.
 */
export function CitizenHomePage() {
  const deps = useCitizenDeps();
  const { search } = useLocation();
  const citizenRoute = useCitizenRoute(deps, search);
  const ready = citizenRoute.status === 'ready' ? citizenRoute : null;
  const routeCode = ready?.route.code ?? null;
  const pointCode = ready?.pointCode ?? null;
  const live = useLiveRoute(deps, routeCode);
  useViewReporting(deps, routeCode, pointCode);

  const point = ready?.route.points.find((p) => p.code === pointCode) ?? null;
  return (
    <div className="citizen">
      <header className="citizen__header">
        <h1 className="citizen__title">Ruta Limpia</h1>
        <p className="citizen__tagline">Recolección de residuos en tu barrio</p>
      </header>
      <main className="citizen__main">
        {citizenRoute.status === 'loading' && <p>Cargando la ruta…</p>}
        {citizenRoute.status === 'unavailable' && (
          <Notice tone="error">
            No se pudo cargar la ruta. Revisa tu conexión a internet e intenta otra vez.
          </Notice>
        )}
        {ready !== null && (
          <ArrivalCard
            route={{ district: ready.route.district, code: ready.route.code }}
            point={point === null ? null : { code: point.code, name: point.name }}
            arrival={selectArrival(live.snapshot, pointCode)}
            schedule={ready.route.schedule}
            connection={live.connection}
            map={
              <RouteMap
                route={ready.route}
                highlightedPointCode={pointCode}
                truck={selectTruckPosition(live.snapshot, pointCode)}
              />
            }
          />
        )}
      </main>
    </div>
  );
}
