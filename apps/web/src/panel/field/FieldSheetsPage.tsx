import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';

import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { Num } from '../../shared/ui/Num';
import { OBSERVATION_PHASES, type Observation, type ObservationPhase } from '../api/types';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { formatCalendarDate } from '../format';
import { PHASE_LABELS } from '../labels';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';

const PAGE_SIZE = 20;
const FILTERS = ['punto', 'fase', 'desde', 'hasta'] as const;
const DISPERSION = { none: 'No', few: 'Pocos', many: 'Muchos' } as const;

/**
 * `/panel/fichas`: the Instrument 2 sheets of the route. Observers see only their own (the API
 * filters them); supervisors see every sheet.
 */
export function FieldSheetsPage() {
  const { api } = usePanelDeps();
  const user = useUser();
  const { routeCode } = useSelectedRoute();
  const route = useAsync(
    useCallback(
      () => (routeCode === null ? Promise.resolve(null) : api.getRoute(routeCode)),
      [api, routeCode],
    ),
  );
  const { values, page, setFilter, setPage } = useFilters(FILTERS);
  const { punto, fase, desde, hasta } = values;
  const load = useCallback(
    () =>
      routeCode === null
        ? Promise.resolve(undefined)
        : api.listObservations({
            route: routeCode,
            point: punto === '' ? undefined : punto,
            phase: fase === '' ? undefined : (fase as ObservationPhase),
            from: desde,
            to: hasta,
            page,
            pageSize: PAGE_SIZE,
          }),
    [api, routeCode, punto, fase, desde, hasta, page],
  );
  const sheets = useAsync(load);
  const ownOnly = !canAny(user, ['field:read_all']);
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true;

  return (
    <>
      <PageHeader
        title="Fichas de campo"
        kicker={ownOnly ? 'Instrumento 2 · tus fichas' : 'Instrumento 2 · observación por punto'}
        actions={
          canAny(user, ['field:write_own', 'field:write_all']) && (
            <Link className="button button--primary button--compact" to="/panel/fichas/nueva">
              Nueva ficha
            </Link>
          )
        }
      />
      {saved && (
        <Notice tone="info">
          <p>Se guardó la ficha.</p>
        </Notice>
      )}
      <form
        className="filters"
        role="search"
        aria-label="Filtrar fichas"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="sheets-point"
          label="Punto"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={punto}
              onChange={(e) => setFilter('punto', e.target.value)}
            >
              <option value="">Todos</option>
              {(route.data?.points ?? []).map((point) => (
                <option key={point.code} value={point.code}>
                  {point.code}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="sheets-phase"
          label="Fase"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={fase}
              onChange={(e) => setFilter('fase', e.target.value)}
            >
              <option value="">Todas</option>
              {OBSERVATION_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {PHASE_LABELS[phase]}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="sheets-from"
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
          id="sheets-to"
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
      {sheets.data === undefined ? (
        <LoadState
          status={sheets.status}
          error={sheets.error}
          onRetry={sheets.reload}
          what="las fichas"
        />
      ) : (
        <>
          <SheetsTable sheets={sheets.data.items} />
          <Pagination
            page={sheets.data.page}
            pageSize={sheets.data.pageSize}
            total={sheets.data.total}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}

function SheetsTable({ sheets }: { readonly sheets: readonly Observation[] }) {
  if (sheets.length === 0) {
    return <p className="table-empty">No hay fichas con estos filtros.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Fichas de campo</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Punto</th>
            <th scope="col">Fase</th>
            <th scope="col">Observadores</th>
            <th scope="col" className="is-numeric">
              Exposición
            </th>
            <th scope="col" className="is-numeric">
              Bolsas rotas / al paso
            </th>
            <th scope="col">Residuos dispersos</th>
            <th scope="col">
              <span className="visually-hidden">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sheets.map((sheet) => (
            <tr key={sheet.id}>
              <td className="num">{formatCalendarDate(sheet.observedOn)}</td>
              <th scope="row" className="num">
                {sheet.pointCode}
              </th>
              <td>{PHASE_LABELS[sheet.phase]}</td>
              <td>{sheet.observers}</td>
              <td className="is-numeric">
                {sheet.exposureMinutes === null ? '—' : <Num>{sheet.exposureMinutes} min</Num>}
              </td>
              <td className="is-numeric">
                {sheet.bagsAtPass === null ? (
                  '—'
                ) : (
                  <Num>
                    {sheet.brokenBags ?? 0} / {sheet.bagsAtPass}
                  </Num>
                )}
              </td>
              <td>{sheet.dispersion === null ? '—' : DISPERSION[sheet.dispersion]}</td>
              <td className="cell-actions">
                <Link to={`/panel/fichas/${sheet.id}`}>
                  Abrir{' '}
                  <span className="visually-hidden">
                    la ficha de {sheet.pointCode} del {formatCalendarDate(sheet.observedOn)}
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
