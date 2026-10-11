import { useCallback } from 'react';
import { Link } from 'react-router';

import { Field } from '../../shared/ui/Field';
import { Num } from '../../shared/ui/Num';
import { Status } from '../../shared/ui/Status';
import type { Trip, TripStatus } from '../api/types';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { formatDateTime, formatDuration } from '../format';
import { TRIP_STATUS } from '../labels';
import { usePanelDeps } from '../panel-deps';
import { useSelectedRoute } from '../shell/selected-route';

const PAGE_SIZE = 20;
const FILTERS = ['ruta', 'desde', 'hasta', 'estado'] as const;

/** `/panel/viajes`: every trip, newest first, filtered by route, service date and state. */
export function TripsPage() {
  const { api } = usePanelDeps();
  const { routes, routeCode } = useSelectedRoute();
  const { values, page, setFilter, setPage } = useFilters(FILTERS);
  const route = values.ruta === '' ? (routeCode ?? '') : values.ruta;
  const { desde, hasta, estado } = values;
  const load = useCallback(
    () =>
      api.listTrips({
        route: route === 'todas' ? undefined : route,
        from: desde,
        to: hasta,
        status: estado === '' ? undefined : (estado as TripStatus),
        page,
        pageSize: PAGE_SIZE,
      }),
    [api, route, desde, hasta, estado, page],
  );
  const trips = useAsync(load);

  return (
    <>
      <PageHeader title="Viajes" kicker="Recorridos registrados por el GPS o iniciados a mano" />
      <form
        className="filters"
        role="search"
        aria-label="Filtrar viajes"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="trips-route"
          label="Ruta"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={route}
              onChange={(e) => setFilter('ruta', e.target.value)}
            >
              <option value="todas">Todas</option>
              {routes.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="trips-from"
          label="Desde"
          control={(control) => (
            <input
              {...control}
              className="input"
              type="date"
              value={desde}
              onChange={(e) => setFilter('desde', e.target.value)}
            />
          )}
        />
        <Field
          id="trips-to"
          label="Hasta"
          control={(control) => (
            <input
              {...control}
              className="input"
              type="date"
              value={hasta}
              onChange={(e) => setFilter('hasta', e.target.value)}
            />
          )}
        />
        <Field
          id="trips-status"
          label="Estado"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={estado}
              onChange={(e) => setFilter('estado', e.target.value)}
            >
              <option value="">Todos</option>
              {(Object.keys(TRIP_STATUS) as TripStatus[]).map((status) => (
                <option key={status} value={status}>
                  {TRIP_STATUS[status].label}
                </option>
              ))}
            </select>
          )}
        />
      </form>
      {trips.data === undefined ? (
        <LoadState
          status={trips.status}
          error={trips.error}
          onRetry={trips.reload}
          what="los viajes"
        />
      ) : (
        <>
          <TripsTable trips={trips.data.items} />
          <Pagination
            page={trips.data.page}
            pageSize={trips.data.pageSize}
            total={trips.data.total}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}

function tripDuration(trip: Trip): string {
  if (trip.endedAt === null) return 'En curso';
  return formatDuration((Date.parse(trip.endedAt) - Date.parse(trip.startedAt)) / 1000);
}

function TripsTable({ trips }: { readonly trips: readonly Trip[] }) {
  if (trips.length === 0) {
    return <p className="table-empty">No hay viajes con estos filtros.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Viajes</caption>
        <thead>
          <tr>
            <th scope="col">Inicio</th>
            <th scope="col">Ruta</th>
            <th scope="col">Vehículo</th>
            <th scope="col">Estado</th>
            <th scope="col" className="is-numeric">
              Duración
            </th>
            <th scope="col" className="is-numeric">
              Puntos pasados
            </th>
            <th scope="col" className="is-numeric">
              Avisos
            </th>
            <th scope="col">
              <span className="visually-hidden">Detalle</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => (
            <tr key={trip.id}>
              <th scope="row" className="num">
                {formatDateTime(trip.startedAt)}
                {trip.startMode === 'manual' && <span className="cell-note"> · manual</span>}
              </th>
              <td className="num">{trip.routeCode}</td>
              <td>{trip.vehicleLabel}</td>
              <td>
                <Status
                  tone={TRIP_STATUS[trip.status].tone}
                  label={TRIP_STATUS[trip.status].label}
                />
              </td>
              <td className="is-numeric">{tripDuration(trip)}</td>
              <td className="is-numeric">
                <Num>
                  {trip.passedPoints} / {trip.totalPoints}
                </Num>
              </td>
              <td className="is-numeric">
                <Num>{trip.alertsCount}</Num>
              </td>
              <td className="cell-actions">
                <Link to={`/panel/viajes/${trip.id}`}>
                  Ver detalle{' '}
                  <span className="visually-hidden">
                    del viaje del {formatDateTime(trip.startedAt)}
                  </span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
