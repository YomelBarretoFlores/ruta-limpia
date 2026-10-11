import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Notice } from '../../shared/ui/Notice';
import { PanelApiError } from '../api/panel-api';
import type { ObservationProblem } from '../api/types';
import { errorMessage } from '../components/errors';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { formatCalendarDate, localToday } from '../format';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import {
  emptySheet,
  problemsByField,
  sheetFromObservation,
  toSheet,
  type SheetForm,
} from './field-sheet';
import { FieldSheetForm } from './FieldSheetForm';

/** The 24-hour edit window of the API, for the note above an observer's own sheet. */
const EDIT_WINDOW_MS = 24 * 3_600_000;

const SHEET_ERRORS = {
  edit_window_closed:
    'Pasaron más de 24 horas desde que se registró esta ficha: ya no se puede cambiar.',
  not_owner: 'Solo quien registró la ficha puede cambiarla.',
  unknown_point: 'El punto ya no está activo en la ruta. Elige otro.',
  unknown_route: 'La ruta ya no está activa.',
  not_found: 'No se encontró la ficha. Es posible que la hayan eliminado.',
} as const;

/** `/panel/fichas/nueva` and `/panel/fichas/:id`: one Instrument 2 sheet. */
export function FieldSheetEditorPage() {
  const deps = usePanelDeps();
  const { api } = deps;
  const user = useUser();
  const navigate = useNavigate();
  const { id } = useParams();
  const { routeCode } = useSelectedRoute();
  const existing = useAsync(
    useCallback(
      () => (id === undefined ? Promise.resolve(null) : api.getObservation(id)),
      [api, id],
    ),
  );
  const sheetRoute = existing.data?.routeCode ?? routeCode;
  const route = useAsync(
    useCallback(
      () => (sheetRoute === null ? Promise.resolve(null) : api.getRoute(sheetRoute)),
      [api, sheetRoute],
    ),
  );
  const [problems, setProblems] = useState<readonly ObservationProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const observation = existing.data ?? null;
  const writesAll = canAny(user, ['field:write_all']);
  const ownWithinWindow =
    observation !== null &&
    observation.createdByUserId === user.id &&
    deps.now() - Date.parse(observation.createdAt) < EDIT_WINDOW_MS;
  const editable =
    observation === null
      ? canAny(user, ['field:write_own', 'field:write_all'])
      : writesAll || ownWithinWindow;

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    setProblems([]);
    try {
      await action();
    } catch (failure) {
      if (failure instanceof PanelApiError && failure.problems.length > 0) {
        setProblems(failure.problems);
      } else {
        setError(errorMessage(failure, SHEET_ERRORS));
      }
    } finally {
      setWorking(false);
    }
  };

  const save = (form: SheetForm) => {
    if (sheetRoute === null) return;
    const point = route.data?.points.find((p) => p.code === form.pointCode);
    const sheet = toSheet(form, sheetRoute, point?.observesMusic ?? false);
    void run(async () => {
      if (observation === null) await api.createObservation(sheet);
      else await api.updateObservation(observation.id, sheet);
      void navigate('/panel/fichas', { state: { saved: true } });
    });
  };

  const remove = () => {
    if (observation === null) return;
    if (!window.confirm('¿Eliminar esta ficha? No se puede deshacer.')) return;
    void run(async () => {
      await api.deleteObservation(observation.id);
      void navigate('/panel/fichas');
    });
  };

  const header = (
    <>
      <p className="back-link">
        <Link to="/panel/fichas">Volver a las fichas</Link>
      </p>
      <PageHeader
        kicker="Instrumento 2 · ficha de observación"
        title={
          observation === null
            ? 'Nueva ficha de campo'
            : `Ficha de ${observation.pointCode} · ${formatCalendarDate(observation.observedOn)}`
        }
      />
    </>
  );

  if (id !== undefined && observation === null) {
    return (
      <>
        {header}
        {existing.status === 'error' ? (
          <Notice tone="danger" title="No se pudo abrir la ficha">
            <p>{errorMessage(existing.error, SHEET_ERRORS)}</p>
          </Notice>
        ) : (
          <p className="panel-loading">Cargando la ficha…</p>
        )}
      </>
    );
  }
  if (sheetRoute === null) return <p className="panel-loading">Cargando la ruta…</p>;

  return (
    <>
      {header}
      {observation !== null && !editable && (
        <Notice tone="warn" title="Solo lectura" announce={false}>
          <p>
            {observation.createdByUserId === user.id
              ? 'Pasaron más de 24 horas desde que registraste esta ficha: ya no se puede cambiar.'
              : 'Esta ficha la registró otra persona: solo ella puede cambiarla.'}
          </p>
        </Notice>
      )}
      <FieldSheetForm
        key={observation?.id ?? 'new'}
        initial={
          observation === null
            ? emptySheet(localToday(deps.now()))
            : sheetFromObservation(observation)
        }
        routeCode={sheetRoute}
        points={route.data?.points ?? []}
        problems={problemsByField(problems)}
        error={error}
        working={working}
        editable={editable}
        onSubmit={save}
        onDelete={observation === null ? undefined : remove}
      />
    </>
  );
}
