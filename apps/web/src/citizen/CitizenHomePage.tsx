import './citizen.css';

import { useLocation } from 'react-router';

import { Notice } from '../shared/ui/Notice';
import { useCitizenDeps } from './citizen-deps';
import { AlertSubscriptionCard } from './components/AlertSubscriptionCard';
import { ArrivalCard } from './components/ArrivalCard';
import { RouteMap } from './components/RouteMap';
import { useAlertSubscription } from './hooks/useAlertSubscription';
import { useCitizenRoute } from './hooks/useCitizenRoute';
import { useLiveRoute } from './hooks/useLiveRoute';
import { useViewReporting } from './hooks/useViewReporting';
import { selectArrival, selectTruckPosition } from './live/live-state';

/** Brings the alert sign-up into view and moves the keyboard focus to its title. */
function showAlertSettings() {
  document.getElementById('avisos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('avisos-title')?.focus({ preventScroll: true });
}

/**
 * Citizen area (`/`): the truck on the map, its arrival at the household's reference point, and
 * the alert sign-up. Container: it resolves the route and point, keeps the live state and the
 * subscription, and reports app views; the cards only render what they are given.
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
  const alerts = useAlertSubscription(
    deps.push,
    ready === null
      ? null
      : { routeCode: ready.route.code, pointCode, householdCode: ready.householdCode },
  );

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
          <Notice tone="danger">
            No se pudo cargar la ruta. Revisa tu conexión a internet e intenta otra vez.
          </Notice>
        )}
        {ready !== null && (
          <>
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
              onConfigureAlerts={showAlertSettings}
            />
            <AlertSubscriptionCard
              zone={`${ready.route.district} · ${ready.route.code}`}
              points={ready.route.points}
              selectedPointCode={pointCode}
              onSelectPoint={ready.selectPoint}
              householdCode={ready.householdCode}
              support={deps.push.support()}
              phase={alerts.phase}
              subscribedPointCode={alerts.subscription?.pointCode ?? null}
              consent={alerts.consent}
              onConsentChange={alerts.setConsent}
              message={alerts.message}
              onActivate={alerts.activate}
              onCancel={alerts.cancel}
            />
          </>
        )}
      </main>
    </div>
  );
}
