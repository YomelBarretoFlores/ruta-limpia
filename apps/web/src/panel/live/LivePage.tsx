import { lazy, Suspense, useCallback, useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { ErrorBoundary } from '../../shared/ui/ErrorBoundary';
import { Notice } from '../../shared/ui/Notice';
import { Status } from '../../shared/ui/Status';
import { formatLocalTime } from '../../shared/time';
import type { NewIncident } from '../api/types';
import { errorMessage } from '../components/errors';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { useNow } from '../components/use-now';
import { INCIDENT_ERRORS } from '../incidents/incident-errors';
import { IncidentForm } from '../incidents/IncidentForm';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import { FieldRecordBlock } from './FieldRecordBlock';
import { liveRows, shownTrip } from './live-rows';
import { LiveSummary } from './LiveSummary';
import type { PanelConnection } from './panel-live-connection';
import { PassTable } from './PassTable';
import { EndTripForm, StartTripForm } from './TripForms';
import { useLivePanel } from './useLivePanel';

const PanelRouteMap = lazy(() => import('../map/PanelRouteMap'));

const TRIP_ERRORS = {
  trip_already_active: 'Ese vehículo ya tiene un viaje en curso.',
  trip_not_active: 'El viaje ya había terminado.',
  vehicle_not_found: 'No se encontró el vehículo. Vuelve a cargar la página.',
  route_not_found: 'La ruta ya no está activa.',
} as const;

const CONNECTION: Record<PanelConnection, string> = {
  connecting: 'Conectando…',
  live: 'Panel conectado',
  reconnecting: 'Reconectando…',
  polling: 'Se actualiza cada 20 s',
};

type Action = 'start' | 'end' | 'incident' | null;

/**
 * `/panel/en-vivo`: the route being collected now. The summary (vehicle, GPS signal, last
 * position), the pass table with the alert of each point, the latest field measurements and the
 * map; supervisors start and end trips by hand and anyone may register an incident.
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
  const canDriveTrips = canAny(user, ['trips:write']);
  const loadVehicles = useCallback(
    () => (canDriveTrips ? api.listVehicles() : Promise.resolve([])),
    [api, canDriveTrips],
  );
  const vehicles = useAsync(loadVehicles);
  const [action, setAction] = useState<Action>(null);
  const [message, setMessage] = useState<string | null>(null);

  const snapshot = live.data ?? undefined;
  const trip = shownTrip(snapshot);
  const routeDetail = route.data ?? undefined;
  const summary = routes.find((r) => r.code === routeCode);
  const rows = liveRows(snapshot, routeDetail);

  const done = (text: string) => {
    setAction(null);
    setMessage(text);
    live.reload();
    vehicles.reload();
  };

  const startTrip = async (vehicleCode: string) => {
    if (routeCode === null) return;
    await api.startTrip(vehicleCode, routeCode);
    done('Se inició el viaje.');
  };
  const endTrip = async (note: string) => {
    if (trip === null) return;
    await api.endTrip(trip.tripId, note);
    done('Se finalizó el viaje. El motivo quedó registrado.');
  };
  const createIncident = async (incident: NewIncident) => {
    await api.createIncident(incident);
    done('Se registró la incidencia.');
  };

  if (routeCode === null) {
    return <p className="panel-loading">Cargando la ruta…</p>;
  }

  const updated = formatLocalTime(snapshot?.generatedAt);
  return (
    <>
      <PageHeader
        kicker="En vivo"
        title={`Zona urbana de ${summary?.district ?? 'Independencia'} · ${routeCode} · seguimiento`}
        actions={
          <>
            {canDriveTrips && trip === null && (
              <Button
                variant="secondary"
                className="button--compact"
                onClick={() => setAction('start')}
              >
                Iniciar viaje
              </Button>
            )}
            {canDriveTrips && trip !== null && (
              <Button
                variant="secondary"
                className="button--compact"
                onClick={() => setAction('end')}
              >
                Finalizar viaje
              </Button>
            )}
            {canAny(user, ['incidents:create']) && (
              <Button
                variant="secondary"
                className="button--compact"
                onClick={() => setAction('incident')}
              >
                Registrar incidencia
              </Button>
            )}
          </>
        }
      />
      <p className="live-meta">
        <Status
          tone={live.connection === 'live' ? 'live' : 'stale'}
          label={CONNECTION[live.connection]}
        />
        {updated !== null && <span className="cell-muted"> · Datos de las {updated}</span>}
      </p>
      {message !== null && (
        <Notice tone="info">
          <p>{message}</p>
        </Notice>
      )}
      {action !== null && (
        <section className="panel-section" aria-labelledby="live-action-title">
          <h2 id="live-action-title" className="panel-section__title">
            {action === 'start'
              ? 'Iniciar viaje'
              : action === 'end'
                ? 'Finalizar viaje'
                : 'Registrar incidencia'}
          </h2>
          {action === 'start' && (
            <StartTripForm
              routeCode={routeCode}
              vehicles={vehicles.data}
              onStart={startTrip}
              onCancel={() => setAction(null)}
              describeError={(error) => errorMessage(error, TRIP_ERRORS)}
            />
          )}
          {action === 'end' && trip !== null && (
            <EndTripForm
              vehicleLabel={trip.vehicle.label}
              onEnd={endTrip}
              onCancel={() => setAction(null)}
              describeError={(error) => errorMessage(error, TRIP_ERRORS)}
            />
          )}
          {action === 'incident' && (
            <IncidentForm
              routeCode={routeCode}
              points={routeDetail?.points ?? []}
              trips={
                trip === null
                  ? []
                  : [{ id: trip.tripId, label: `Viaje en curso · ${trip.vehicle.label}` }]
              }
              initial={trip === null ? undefined : { tripId: trip.tripId }}
              now={now}
              submitLabel="Registrar incidencia"
              onSubmit={createIncident}
              onCancel={() => setAction(null)}
              describeError={(error) => errorMessage(error, INCIDENT_ERRORS)}
            />
          )}
        </section>
      )}
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
