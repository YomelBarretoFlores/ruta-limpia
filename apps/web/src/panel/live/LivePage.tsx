import { lazy, Suspense, useCallback } from 'react';

import { ErrorBoundary } from '../../shared/ui/ErrorBoundary';
import { Notice } from '../../shared/ui/Notice';
import { Status } from '../../shared/ui/Status';
import { formatLocalTime } from '../../shared/time';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { useNow } from '../components/use-now';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import { FieldRecordBlock } from './FieldRecordBlock';
import { liveRows, shownTrip } from './live-rows';
import { LiveSummary } from './LiveSummary';
import type { PanelConnection } from './panel-live-connection';
import { PassTable } from './PassTable';
import { useLivePanel } from './useLivePanel';

const PanelRouteMap = lazy(() => import('../map/PanelRouteMap'));

const CONNECTION: Record<PanelConnection, string> = {
  connecting: 'Conectando…',
  live: 'Actualización en vivo',
  reconnecting: 'Reconectando…',
  polling: 'Se actualiza cada 20 s',
};

/**
 * `/panel/en-vivo`: the route being collected now. The summary (vehicle, GPS signal, last
 * position), the pass table with the alert of each point, the latest field measurements and the
 * map, kept current by the public stream and a periodic refetch.
 */
export function LivePage() {
  const deps = usePanelDeps();
  const { api } = deps;
  const user = useUser();
  const { routeCode, routes } = useSelectedRoute();
  const now = useNow(deps.now);
  const live = useLivePanel(routeCode);
  const loadRoute = useCallback(
    () => (routeCode === null ? Promise.resolve(null) : api.getRoute(routeCode)),
    [api, routeCode],
  );
  const route = useAsync(loadRoute);
  const readsField = canAny(user, ['field:read_own', 'field:read_all']);
  const loadField = useCallback(
    () =>
      routeCode === null || !readsField
        ? Promise.resolve(null)
        : api.listObservations({ route: routeCode, pageSize: 5 }).then((page) => page.items),
    [api, routeCode, readsField],
  );
  const field = useAsync(loadField);
  const snapshot = live.data ?? undefined;
  const trip = shownTrip(snapshot);
  const routeDetail = route.data ?? undefined;
  const summary = routes.find((r) => r.code === routeCode);
  const rows = liveRows(snapshot, routeDetail);

  if (routeCode === null) {
    return <p className="panel-loading">Cargando la ruta…</p>;
  }

  const updated = formatLocalTime(snapshot?.generatedAt);
  return (
    <>
      <PageHeader
        kicker="En vivo"
        title={`Zona urbana de ${summary?.district ?? 'Independencia'} · ${routeCode} · seguimiento`}
      />
      <p className="live-meta">
        <Status
          tone={live.connection === 'live' ? 'live' : 'stale'}
          label={CONNECTION[live.connection]}
        />
        {updated !== null && <span className="cell-muted"> · Datos de las {updated}</span>}
      </p>
      {snapshot === undefined ? (
        <LoadState
          status={live.status}
          error={live.error}
          onRetry={live.reload}
          what="el seguimiento"
        />
      ) : (
        <div className="live-layout">
          <div className="live-layout__main">
            {live.status === 'error' && (
              <Notice tone="warn" title="Sin actualización">
                <p>
                  No se pudo actualizar el seguimiento. Se muestran los últimos datos recibidos.
                </p>
              </Notice>
            )}
            <LiveSummary trip={trip} now={now} />
            {snapshot.trips.length > 1 && (
              <p className="panel-section__note">
                Hay {snapshot.trips.length} viajes en curso en esta ruta; se muestra el más
                reciente.
              </p>
            )}
            <PassTable
              rows={rows}
              caption={
                trip === null
                  ? 'Puntos de la ruta (sin viaje en curso)'
                  : 'Paso por los puntos de referencia'
              }
            />
            {readsField && <FieldRecordBlock observations={field.data ?? null} />}
          </div>
          <div className="live-layout__map">
            {routeDetail !== undefined && (
              <ErrorBoundary
                fallback={<p className="panel-map-placeholder">No se pudo mostrar el mapa.</p>}
              >
                <Suspense fallback={<p className="panel-map-placeholder">Cargando el mapa…</p>}>
                  <PanelRouteMap
                    route={routeDetail}
                    label={`Mapa de la ruta ${routeCode}`}
                    truck={
                      trip?.lastPosition == null
                        ? null
                        : {
                            lat: trip.lastPosition.lat,
                            lon: trip.lastPosition.lon,
                            stale: trip.signal !== 'live',
                            fixTime: trip.lastPosition.fixTime,
                            course: trip.lastPosition.course ?? null,
                          }
                    }
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
        </div>
      )}
    </>
  );
}
