import { lazy, Suspense, useCallback } from 'react';
import { Link, useParams } from 'react-router';

import { ErrorBoundary } from '../../shared/ui/ErrorBoundary';
import { Notice } from '../../shared/ui/Notice';
import { Num } from '../../shared/ui/Num';
import { Status } from '../../shared/ui/Status';
import { formatLocalTime } from '../../shared/time';
import type { TripDetail } from '../api/types';
import { errorMessage } from '../components/errors';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { formatDateTime, formatDuration, formatLocalDate, timeOrDash } from '../format';
import { INCIDENT_KIND_LABELS, TRIP_STATUS } from '../labels';
import { usePanelDeps } from '../panel-deps';

const PanelRouteMap = lazy(() => import('../map/PanelRouteMap'));

const PRECISION: Record<string, string> = {
  interpolated: 'Interpolado',
  upper_bound: 'Cota superior',
};

/**
 * `/panel/viajes/:id`: one trip. Its summary (duration, GPS fixes, route departures, longest GPS
 * gap), the pass and alert of each point, its incidents, and its GPS track over the route.
 */
export function TripDetailPage() {
  const { api } = usePanelDeps();
  const { id = '' } = useParams();
  const load = useCallback(() => api.getTrip(id), [api, id]);
  const detail = useAsync(load);
  const routeCode = detail.data?.trip.routeCode ?? null;
  const loadRoute = useCallback(
    () => (routeCode === null ? Promise.resolve(null) : api.getRoute(routeCode)),
    [api, routeCode],
  );
  const route = useAsync(loadRoute);

  if (detail.data === undefined) {
    return (
      <>
        <p className="back-link">
          <Link to="/panel/viajes">Volver a los viajes</Link>
        </p>
        {detail.status === 'error' ? (
          <Notice tone="danger" title="No se pudo abrir el viaje">
            <p>
              {errorMessage(detail.error, {
                trip_not_found: 'No existe un viaje con esa dirección.',
              })}
            </p>
          </Notice>
        ) : (
          <p className="panel-loading">Cargando el viaje…</p>
        )}
      </>
    );
  }
  const { trip } = detail.data;
  return (
    <>
      <p className="back-link">
        <Link to="/panel/viajes">Volver a los viajes</Link>
      </p>
      <PageHeader
        kicker={`${trip.routeCode} · ${trip.routeName}`}
        title={`Viaje del ${formatLocalDate(trip.startedAt) ?? '—'} · ${trip.vehicleLabel}`}
      />
      <TripSummary detail={detail.data} />
      <TripPointsTable points={detail.data.points} />
      <TripIncidents incidents={detail.data.incidents} />
      <section className="panel-section" aria-labelledby="trip-map-title">
        <h2 id="trip-map-title" className="panel-section__title">
          Recorrido del GPS
        </h2>
        <p className="panel-section__note">
          La línea verde es la ruta planificada; la línea punteada negra, las posiciones válidas del
          viaje.
        </p>
        {route.data != null && (
          <ErrorBoundary
            fallback={<p className="panel-map-placeholder">No se pudo mostrar el mapa.</p>}
          >
            <Suspense fallback={<p className="panel-map-placeholder">Cargando el mapa…</p>}>
              <PanelRouteMap
                route={route.data}
                track={detail.data.track?.coordinates ?? null}
                label={`Mapa del recorrido del viaje del ${formatDateTime(trip.startedAt)}`}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </section>
    </>
  );
}

function TripSummary({ detail }: { readonly detail: TripDetail }) {
  const { trip, summary } = detail;
  return (
    <>
      <dl className="summary-row">
        <div className="summary-row__item">
          <dt>Estado</dt>
          <dd>
            <Status tone={TRIP_STATUS[trip.status].tone} label={TRIP_STATUS[trip.status].label} />
          </dd>
        </div>
        <div className="summary-row__item">
          <dt>Horario</dt>
          <dd className="num">
            {timeOrDash(trip.startedAt)} a{' '}
            {trip.endedAt === null ? 'en curso' : timeOrDash(trip.endedAt)}
          </dd>
        </div>
        <div className="summary-row__item">
          <dt>Duración</dt>
          <dd className="num">{formatDuration(summary.durationSec)}</dd>
        </div>
        <div className="summary-row__item">
          <dt>Posiciones GPS</dt>
          <dd className="num">{summary.fixCount}</dd>
        </div>
        <div className="summary-row__item">
          <dt>Salidas de ruta</dt>
          <dd className="num">{summary.offRouteCount}</dd>
        </div>
        <div className="summary-row__item">
          <dt>Mayor corte de GPS</dt>
          <dd className="num">{formatDuration(summary.maxGpsGapSec)}</dd>
        </div>
      </dl>
      {trip.endNote !== null && (
        <Notice tone="warn" title="Finalizado a mano" announce={false}>
          <p>{trip.endNote}</p>
        </Notice>
      )}
    </>
  );
}

function TripPointsTable({ points }: { readonly points: TripDetail['points'] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption>Paso y aviso por punto</caption>
        <thead>
          <tr>
            <th scope="col">Punto</th>
            <th scope="col">Paso</th>
            <th scope="col">Precisión</th>
            <th scope="col">Aviso</th>
            <th scope="col">ETA comunicado</th>
            <th scope="col">Ventana objetivo</th>
            <th scope="col" className="is-numeric">
              Entregas <span className="cell-note">(recibidos / enviados)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.pointId}>
              <th scope="row">
                <span className="num">{point.pointCode}</span>
                <span className="cell-note"> · {point.pointName}</span>
              </th>
              <td className="num">{timeOrDash(point.passedAt)}</td>
              <td>
                {point.precision === null ? '—' : (PRECISION[point.precision] ?? point.precision)}
              </td>
              <td className="num">
                {point.alert === null ? 'Sin aviso' : timeOrDash(point.alert.emittedAt)}
              </td>
              <td className="num">{timeOrDash(point.alert?.communicatedPredictedPassAt)}</td>
              <td>
                {point.alert?.insideTargetWindow == null
                  ? '—'
                  : point.alert.insideTargetWindow
                    ? 'Sí'
                    : 'No'}
              </td>
              <td className="is-numeric">
                {point.alert === null ? (
                  '—'
                ) : (
                  <Num>
                    {point.alert.receiptsReceived} / {point.alert.recipients}
                  </Num>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TripIncidents({ incidents }: { readonly incidents: TripDetail['incidents'] }) {
  return (
    <section className="panel-section" aria-labelledby="trip-incidents-title">
      <h2 id="trip-incidents-title" className="panel-section__title">
        Incidencias del viaje
      </h2>
      {incidents.length === 0 ? (
        <p className="panel-section__note">No se registraron incidencias en este viaje.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Incidencias del viaje</caption>
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Tipo</th>
                <th scope="col">Punto</th>
                <th scope="col">Descripción</th>
                <th scope="col">Resuelta</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td className="num">{formatLocalTime(incident.occurredAt) ?? '—'}</td>
                  <th scope="row">{INCIDENT_KIND_LABELS[incident.kind]}</th>
                  <td className="num">{incident.pointCode ?? 'Toda la ruta'}</td>
                  <td>{incident.description ?? '—'}</td>
                  <td className="num">
                    {incident.resolvedAt === null ? 'No' : formatDateTime(incident.resolvedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
