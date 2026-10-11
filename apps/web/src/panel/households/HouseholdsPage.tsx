import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import type { HouseholdChanges, HouseholdListItem, NewHousehold } from '../api/types';
import { errorMessage } from '../components/errors';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { localToday } from '../format';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import { EditHouseholdForm, EnrollForm } from './HouseholdForms';
import { HouseholdsTable } from './HouseholdsTable';

const PAGE_SIZE = 50;
const FILTERS = ['punto', 'estado'] as const;

const HOUSEHOLD_ERRORS = {
  unknown_point: 'Ese punto no pertenece a la ruta o ya no está activo. Elige otro.',
  unknown_route: 'La ruta ya no está activa.',
  not_found: 'No se encontró el hogar. Es posible que lo hayan eliminado.',
} as const;

type Editing =
  | { readonly mode: 'enroll' }
  | { readonly mode: 'edit'; readonly household: HouseholdListItem }
  | null;

/**
 * `/panel/hogares`: the enrolled households of the route with their use of the alerts; enroll a
 * household (the API gives its code), move it to another point or take it out, and print
 * stickers for the selected ones.
 */
export function HouseholdsPage() {
  const deps = usePanelDeps();
  const { api } = deps;
  const user = useUser();
  const navigate = useNavigate();
  const { routeCode } = useSelectedRoute();
  const { values, page, setFilter, setPage } = useFilters(FILTERS);
  const { punto, estado } = values;
  const load = useCallback(
    () =>
      routeCode === null
        ? Promise.resolve(undefined)
        : api.listHouseholds({
            route: routeCode,
            point: punto === '' ? undefined : punto,
            active: estado === 'activos' ? true : estado === 'bajas' ? false : undefined,
            page,
            pageSize: PAGE_SIZE,
          }),
    [api, routeCode, punto, estado, page],
  );
  const households = useAsync(load);
  const loadRoute = useCallback(
    () => (routeCode === null ? Promise.resolve(null) : api.getRoute(routeCode)),
    [api, routeCode],
  );
  const route = useAsync(loadRoute);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = canAny(user, ['households:write']);
  const points = route.data?.points ?? [];
  const describe = (error: unknown) => errorMessage(error, HOUSEHOLD_ERRORS);

  const toggle = (code: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const toggleAll = (codes: readonly string[], select: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const code of codes) {
        if (select) next.add(code);
        else next.delete(code);
      }
      return next;
    });

  const enroll = async (household: NewHousehold) => {
    const created = await api.createHousehold(household);
    setEditing(null);
    setMessage(`Se inscribió el hogar ${created.code} en el punto ${created.pointCode}.`);
    setSelected((previous) => new Set(previous).add(created.code));
    households.reload();
  };
  const save = async (household: HouseholdListItem, changes: HouseholdChanges) => {
    await api.updateHousehold(household.code, changes);
    setEditing(null);
    setMessage(`Se guardaron los cambios de ${household.code}.`);
    households.reload();
  };
  const printStickers = () =>
    void navigate(`/panel/hogares/stickers?codigos=${[...selected].sort().join(',')}`);

  return (
    <>
      <PageHeader
        title="Hogares"
        kicker="Hogares voluntarios inscritos, sin direcciones ni nombres"
        actions={
          <>
            <Button
              variant="secondary"
              className="button--compact"
              disabled={selected.size === 0}
              onClick={printStickers}
            >
              Imprimir stickers ({selected.size})
            </Button>
            {canWrite && (
              <Button className="button--compact" onClick={() => setEditing({ mode: 'enroll' })}>
                Inscribir hogar
              </Button>
            )}
          </>
        }
      />
      {message !== null && (
        <Notice tone="info">
          <p>{message}</p>
        </Notice>
      )}
      {editing !== null && routeCode !== null && (
        <section className="panel-section" aria-labelledby="household-form-title">
          <h2 id="household-form-title" className="panel-section__title">
            {editing.mode === 'enroll' ? 'Inscribir hogar' : `Editar ${editing.household.code}`}
          </h2>
          {editing.mode === 'enroll' ? (
            <EnrollForm
              routeCode={routeCode}
              points={points}
              today={localToday(deps.now())}
              onEnroll={enroll}
              onCancel={() => setEditing(null)}
              describeError={describe}
            />
          ) : (
            <EditHouseholdForm
              key={editing.household.code}
              household={editing.household}
              points={points}
              onSave={(changes) => save(editing.household, changes)}
              onCancel={() => setEditing(null)}
              describeError={describe}
            />
          )}
        </section>
      )}
      <form
        className="filters"
        role="search"
        aria-label="Filtrar hogares"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="households-point"
          label="Punto"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={punto}
              onChange={(e) => setFilter('punto', e.target.value)}
            >
              <option value="">Todos</option>
              {points.map((point) => (
                <option key={point.code} value={point.code}>
                  {point.code}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="households-state"
          label="Estado"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={estado}
              onChange={(e) => setFilter('estado', e.target.value)}
            >
              <option value="">Todos</option>
              <option value="activos">Activos</option>
              <option value="bajas">Dados de baja</option>
            </select>
          )}
        />
      </form>
      {households.data === undefined ? (
        <LoadState
          status={households.status}
          error={households.error}
          onRetry={households.reload}
          what="los hogares"
        />
      ) : (
        <>
          <HouseholdsTable
            households={households.data.items}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            canEdit={canWrite}
            onEdit={(household) => setEditing({ mode: 'edit', household })}
          />
          <Pagination
            page={households.data.page}
            pageSize={households.data.pageSize}
            total={households.data.total}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}
