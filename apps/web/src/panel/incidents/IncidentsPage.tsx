import { useCallback, useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { INCIDENT_KINDS, type Incident, type IncidentKind, type NewIncident } from '../api/types';
import { errorMessage } from '../components/errors';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { useNow } from '../components/use-now';
import { formatDateTime, toLocalDateTimeInput } from '../format';
import { INCIDENT_KIND_LABELS } from '../labels';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import { INCIDENT_ERRORS } from './incident-errors';
import { IncidentForm } from './IncidentForm';
import { IncidentsTable } from './IncidentsTable';
import { ResolveForm } from './ResolveForm';

const PAGE_SIZE = 20;
const FILTERS = ['tipo', 'estado', 'desde', 'hasta'] as const;

type Editing =
  | { readonly mode: 'new' }
  | { readonly mode: 'edit'; readonly incident: Incident }
  | { readonly mode: 'resolve'; readonly incident: Incident }
  | null;

/** `/panel/incidencias`: the route's incidents, new ones, corrections, resolution and reopening. */
export function IncidentsPage() {
  const deps = usePanelDeps();
  const { api } = deps;
  const user = useUser();
  const now = useNow(deps.now);
  const { routeCode } = useSelectedRoute();
  const { values, page, setFilter, setPage } = useFilters(FILTERS);
  const { tipo, estado, desde, hasta } = values;
  const load = useCallback(
    () =>
      routeCode === null
        ? Promise.resolve(undefined)
        : api.listIncidents({
            route: routeCode,
            kind: tipo === '' ? undefined : (tipo as IncidentKind),
            status: estado === 'open' || estado === 'resolved' ? estado : undefined,
            from: desde,
            to: hasta,
            page,
            pageSize: PAGE_SIZE,
          }),
    [api, routeCode, tipo, estado, desde, hasta, page],
  );
  const incidents = useAsync(load);
  const loadContext = useCallback(
    () =>
      routeCode === null
        ? Promise.resolve(null)
        : Promise.all([
            api.getRoute(routeCode),
            canAny(user, ['trips:read'])
              ? api.listTrips({ route: routeCode, pageSize: 20 }).then((p) => p.items)
              : Promise.resolve([]),
          ]),
    [api, routeCode, user],
  );
  const context = useAsync(loadContext);
  const [editing, setEditing] = useState<Editing>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canUpdate = canAny(user, ['incidents:update']);
  const describe = (error: unknown) => errorMessage(error, INCIDENT_ERRORS);

  const finish = (text: string) => {
    setEditing(null);
    setMessage(text);
    incidents.reload();
  };
  const create = async (incident: NewIncident) => {
    await api.createIncident(incident);
    finish('Se registró la incidencia.');
  };
  const correct = async (incident: Incident, form: NewIncident) => {
    await api.updateIncident(incident.id, { kind: form.kind, description: form.description ?? '' });
    finish('Se guardó la corrección.');
  };
  const resolve = async (incident: Incident, note: string) => {
    await api.updateIncident(incident.id, { resolved: true, resolutionNote: note });
    finish('La incidencia quedó resuelta.');
  };
  const reopen = async (incident: Incident) => {
    try {
      await api.updateIncident(incident.id, { resolved: false });
      finish('Se reabrió la incidencia.');
    } catch (error) {
      setMessage(describe(error));
    }
  };

  const [route, trips] = context.data ?? [undefined, []];
  return (
    <>
      <PageHeader
        title="Incidencias"
        kicker={routeCode === null ? undefined : `Ruta ${routeCode}`}
        actions={
          canAny(user, ['incidents:create']) && (
            <Button
              variant="secondary"
              className="button--compact"
              onClick={() => setEditing({ mode: 'new' })}
            >
              Registrar incidencia
            </Button>
          )
        }
      />
      {message !== null && (
        <Notice tone="info">
          <p>{message}</p>
        </Notice>
      )}
      {editing !== null && routeCode !== null && (
        <section className="panel-section" aria-labelledby="incident-form-title">
          <h2 id="incident-form-title" className="panel-section__title">
            {editing.mode === 'new'
              ? 'Registrar incidencia'
              : editing.mode === 'edit'
                ? 'Corregir la incidencia'
                : 'Resolver la incidencia'}
          </h2>
          {editing.mode === 'resolve' ? (
            <ResolveForm
              onResolve={(note) => resolve(editing.incident, note)}
              onCancel={() => setEditing(null)}
              describeError={describe}
            />
          ) : (
            <IncidentForm
              key={editing.mode === 'edit' ? editing.incident.id : 'new'}
              routeCode={routeCode}
              points={route?.points ?? []}
              trips={trips.map((trip) => ({
                id: trip.id,
                label: `${formatDateTime(trip.startedAt)} · ${trip.vehicleLabel}`,
              }))}
              editing={editing.mode === 'edit'}
              initial={
                editing.mode === 'edit'
                  ? {
                      kind: editing.incident.kind,
                      pointCode: editing.incident.pointCode ?? '',
                      tripId: editing.incident.tripId ?? '',
                      occurredAt: toLocalDateTimeInput(Date.parse(editing.incident.occurredAt)),
                      description: editing.incident.description ?? '',
                    }
                  : undefined
              }
              now={now}
              submitLabel={editing.mode === 'edit' ? 'Guardar corrección' : 'Registrar incidencia'}
              onSubmit={(form) =>
                editing.mode === 'edit' ? correct(editing.incident, form) : create(form)
              }
              onCancel={() => setEditing(null)}
              describeError={describe}
            />
          )}
        </section>
      )}
      <form
        className="filters"
        role="search"
        aria-label="Filtrar incidencias"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="incidents-kind"
          label="Tipo"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={tipo}
              onChange={(e) => setFilter('tipo', e.target.value)}
            >
              <option value="">Todos</option>
              {INCIDENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {INCIDENT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="incidents-status"
          label="Estado"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={estado}
              onChange={(e) => setFilter('estado', e.target.value)}
            >
              <option value="">Todas</option>
              <option value="open">Abiertas</option>
              <option value="resolved">Resueltas</option>
            </select>
          )}
        />
        <Field
          id="incidents-from"
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
          id="incidents-to"
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
      {incidents.data === undefined ? (
        <LoadState
          status={incidents.status}
          error={incidents.error}
          onRetry={incidents.reload}
          what="las incidencias"
        />
      ) : (
        <>
          <IncidentsTable
            incidents={incidents.data.items}
            canUpdate={canUpdate}
            onEdit={(incident) => setEditing({ mode: 'edit', incident })}
            onResolve={(incident) => setEditing({ mode: 'resolve', incident })}
            onReopen={(incident) => void reopen(incident)}
          />
          <Pagination
            page={incidents.data.page}
            pageSize={incidents.data.pageSize}
            total={incidents.data.total}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}
