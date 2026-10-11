import './citizen.css';

import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router';

import { Button } from '../shared/ui/Button';
import { ErrorBoundary } from '../shared/ui/ErrorBoundary';
import { Notice } from '../shared/ui/Notice';
import { useCitizenDeps } from './citizen-deps';
import { AlertsSection } from './components/AlertsSection';
import { ArrivalSection } from './components/ArrivalSection';
import { HowToSection } from './components/HowToSection';
import { useAlertSubscription } from './hooks/useAlertSubscription';
import { useCitizenRoute } from './hooks/useCitizenRoute';
import { useLiveRoute } from './hooks/useLiveRoute';
import { useViewReporting } from './hooks/useViewReporting';
import { selectArrival, selectTruckPosition } from './live/live-state';

// Leaflet is most of the bundle: the arrival window shows first, the map follows.
const RouteMap = lazy(() =>
  import('./components/RouteMap').then((module) => ({ default: module.RouteMap })),
);

/** Brings the alert sign-up into view and moves the keyboard focus to its title. */
function showAlertSettings() {
  document.getElementById('avisos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('avisos-title')?.focus({ preventScroll: true });
}

/**
 * Citizen area (`/`): the arrival of the truck at the household's reference point, the truck on
 * the map, and the alert sign-up. Container: it resolves the route and point, keeps the live
 * state and the subscription, and reports app views; the sections only render what they get.
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
      <header className="citizen-header">
        <div className="citizen-header__inner">
          <h1 className="citizen-header__wordmark">Ruta Limpia</h1>
          <p className="citizen-header__district">
            {ready === null ? 'Recolección de residuos' : `Distrito de ${ready.route.district}`}
          </p>
        </div>
      </header>
      <main className="citizen-main">
        {citizenRoute.status === 'loading' && <p>Cargando la ruta…</p>}
        {citizenRoute.status === 'unavailable' && (
          <div>
            <Notice tone="danger" title="No se pudo cargar la ruta">
              <p>Revisa tu conexión a internet. Lo intentaremos de nuevo automáticamente.</p>
            </Notice>
            <Button variant="secondary" onClick={citizenRoute.retry}>
              Intentar otra vez
            </Button>
          </div>
        )}
        {citizenRoute.status === 'no_route' && (
          <Notice tone="info" title="No hay una ruta activa">
            <p>Por ahora no hay recorridos publicados. Consulta el horario en la municipalidad.</p>
          </Notice>
        )}
        {ready !== null && (
          <>
            <ArrivalSection
              route={{ district: ready.route.district, code: ready.route.code }}
              point={point === null ? null : { code: point.code, name: point.name }}
              arrival={selectArrival(live.snapshot, pointCode)}
              schedule={ready.route.schedule}
              connection={live.connection}
              map={
                <ErrorBoundary
                  fallback={
                    <p className="route-map route-map--placeholder">
                      No se pudo mostrar el mapa. La llegada estimada sigue arriba.
                    </p>
                  }
                >
                  <Suspense
                    fallback={<p className="route-map route-map--placeholder">Cargando el mapa…</p>}
                  >
                    <RouteMap
                      route={ready.route}
                      highlightedPointCode={pointCode}
                      truck={selectTruckPosition(live.snapshot, pointCode)}
                    />
                  </Suspense>
                </ErrorBoundary>
              }
              onConfigureAlerts={showAlertSettings}
            />
            <AlertsSection
              zone={`${ready.route.district} · ${ready.route.code}`}
              points={ready.route.points}
              selectedPointCode={pointCode}
              onSelectPoint={ready.selectPoint}
              householdCode={ready.householdCode}
              support={deps.push.support()}
              phase={alerts.phase}
              routeCode={ready.route.code}
              subscribedPointCode={alerts.subscription?.pointCode ?? null}
              subscribedRouteCode={alerts.subscription?.routeCode ?? null}
              consent={alerts.consent}
              onConsentChange={alerts.setConsent}
              message={alerts.message}
              onActivate={alerts.activate}
              onCancel={alerts.cancel}
            />
            <HowToSection />
          </>
        )}
      </main>
      <footer className="citizen-footer">
        <p>
          Ruta Limpia no guarda la dirección de tu hogar: los avisos usan solo tu punto de
          referencia y, si lo tienes, el código de hogar.
        </p>
        <p>Proyecto RSU UNASAM 2026</p>
      </footer>
    </div>
  );
}
