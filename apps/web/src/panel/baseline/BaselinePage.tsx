import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';

import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { Num } from '../../shared/ui/Num';
import type { BaselineLog } from '../api/types';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { formatCalendarDate } from '../format';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';

const FILTERS = ['desde', 'hasta'] as const;

/** `/panel/linea-base`: the route logs written by hand before the alerts started (Instrument 1). */
export function BaselinePage() {
  const { api } = usePanelDeps();
  const user = useUser();
  const { routeCode } = useSelectedRoute();
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true;
  const { values, page, setFilter, setPage } = useFilters(FILTERS);
  const { desde, hasta } = values;
  const load = useCallback(
    () =>
      routeCode === null
        ? Promise.resolve(undefined)
        : api.listBaselineLogs({ route: routeCode, from: desde, to: hasta, page, pageSize: 20 }),
    [api, routeCode, desde, hasta, page],
  );
  const logs = useAsync(load);

  return (
    <>
      <PageHeader
        title="Línea base"
        kicker="Instrumento 1 · recorridos registrados a mano antes de los avisos"
        actions={
          canAny(user, ['field:write_own', 'field:write_all']) && (
            <Link className="button button--primary button--compact" to="/panel/linea-base/nuevo">
              Nuevo recorrido
            </Link>
          )
        }
      />
      {saved && (
        <Notice tone="info">
          <p>Se guardó el recorrido.</p>
        </Notice>
      )}
      <form
        className="filters"
        role="search"
        aria-label="Filtrar recorridos"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="baseline-from"
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
          id="baseline-to"
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
      </form>
      {logs.data === undefined ? (
        <LoadState
          status={logs.status}
          error={logs.error}
          onRetry={logs.reload}
          what="los recorridos"
        />
      ) : (
        <>
          <LogsTable logs={logs.data.items} />
          <Pagination
            page={logs.data.page}
            pageSize={logs.data.pageSize}
            total={logs.data.total}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}

function LogsTable({ logs }: { readonly logs: readonly BaselineLog[] }) {
  if (logs.length === 0)
    return <p className="table-empty">No hay recorridos de línea base con estos filtros.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Recorridos de línea base</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Vehículo</th>
            <th scope="col">Inicio previsto</th>
            <th scope="col">Inicio real</th>
            <th scope="col" className="is-numeric">
              Puntos con hora
            </th>
            <th scope="col">
              <span className="visually-hidden">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <th scope="row" className="num">
                {formatCalendarDate(log.serviceDate)}
              </th>
              <td>{log.vehicleLabel ?? '—'}</td>
              <td className="num">{log.plannedStart ?? '—'}</td>
              <td className="num">{log.actualStart ?? '—'}</td>
              <td className="is-numeric">
                <Num>{log.passes.length}</Num>
              </td>
              <td className="cell-actions">
                <Link to={`/panel/linea-base/${log.id}`}>
                  Abrir{' '}
                  <span className="visually-hidden">
                    el recorrido del {formatCalendarDate(log.serviceDate)}
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
