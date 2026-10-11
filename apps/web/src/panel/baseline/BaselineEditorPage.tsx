import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { PanelApiError } from '../api/panel-api';
import type { BaselineLog } from '../api/types';
import { errorMessage } from '../components/errors';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { formatCalendarDate, localToday } from '../format';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import {
  baselineErrors,
  baselineFromLog,
  emptyBaseline,
  toBaselineLog,
  type BaselineForm,
} from './baseline-form';

const EDIT_WINDOW_MS = 24 * 3_600_000;

const BASELINE_ERRORS = {
  edit_window_closed:
    'Pasaron más de 24 horas desde que se registró este recorrido: ya no se puede cambiar.',
  not_owner: 'Solo quien registró el recorrido puede cambiarlo.',
  unknown_route: 'La ruta ya no está activa.',
  not_found: 'No se encontró el recorrido. Es posible que lo hayan eliminado.',
} as const;

/** `/panel/linea-base/nuevo` and `/panel/linea-base/:id`: one manual route log (Instrument 1). */
export function BaselineEditorPage() {
  const deps = usePanelDeps();
  const { api } = deps;
  const user = useUser();
  const navigate = useNavigate();
  const { id } = useParams();
  const { routeCode } = useSelectedRoute();
  const existing = useAsync(
    useCallback(
      () => (id === undefined ? Promise.resolve(null) : api.getBaselineLog(id)),
      [api, id],
    ),
  );
  const logRoute = existing.data?.routeCode ?? routeCode;
  const route = useAsync(
    useCallback(
      () => (logRoute === null ? Promise.resolve(null) : api.getRoute(logRoute)),
      [api, logRoute],
    ),
  );
  const log = existing.data ?? null;

  const header = (
    <>
      <p className="back-link">
        <Link to="/panel/linea-base">Volver a la línea base</Link>
      </p>
      <PageHeader
        kicker="Instrumento 1 · registro manual del recorrido"
        title={
          log === null
            ? 'Nuevo recorrido de línea base'
            : `Recorrido del ${formatCalendarDate(log.serviceDate)}`
        }
      />
    </>
  );
  if (id !== undefined && log === null) {
    return (
      <>
        {header}
        {existing.status === 'error' ? (
          <Notice tone="danger" title="No se pudo abrir el recorrido">
            <p>{errorMessage(existing.error, BASELINE_ERRORS)}</p>
          </Notice>
        ) : (
          <p className="panel-loading">Cargando el recorrido…</p>
        )}
      </>
    );
  }
  if (logRoute === null || route.data == null) {
    return (
      <>
        {header}
        <p className="panel-loading">Cargando los puntos de la ruta…</p>
      </>
    );
  }

  const editable =
    log === null
      ? canAny(user, ['field:write_own', 'field:write_all'])
      : canAny(user, ['field:write_all']) ||
        (log.createdByUserId === user.id &&
          deps.now() - Date.parse(log.createdAt) < EDIT_WINDOW_MS);

  return (
    <>
      {header}
      {!editable && (
        <Notice tone="warn" title="Solo lectura" announce={false}>
          <p>Este recorrido ya no se puede cambiar desde tu cuenta.</p>
        </Notice>
      )}
      <BaselineLogForm
        key={log?.id ?? 'new'}
        log={log}
        routeCode={logRoute}
        points={route.data.points}
        today={localToday(deps.now())}
        editable={editable}
        onSave={async (input) => {
          if (log === null) await api.createBaselineLog(input);
          else await api.updateBaselineLog(log.id, input);
          void navigate('/panel/linea-base', { state: { saved: true } });
        }}
      />
    </>
  );
}

function BaselineLogForm({
  log,
  routeCode,
  points,
  today,
  editable,
  onSave,
}: {
  readonly log: BaselineLog | null;
  readonly routeCode: string;
  readonly points: readonly { readonly code: string; readonly name: string }[];
  readonly today: string;
  readonly editable: boolean;
  readonly onSave: (input: ReturnType<typeof toBaselineLog>) => Promise<void>;
}) {
  const [form, setForm] = useState<BaselineForm>(
    log === null ? emptyBaseline(today) : baselineFromLog(log),
  );
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointError, setPointError] = useState<{ code: string; message: string } | null>(null);
  const [working, setWorking] = useState(false);
  const errors = checked ? baselineErrors(form) : {};
  const set = <K extends keyof BaselineForm>(key: K, value: BaselineForm[K]) =>
    setForm({ ...form, [key]: value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(baselineErrors(form)).length > 0) return;
    setWorking(true);
    setError(null);
    setPointError(null);
    try {
      await onSave(
        toBaselineLog(
          form,
          routeCode,
          points.map((p) => p.code),
        ),
      );
    } catch (failure) {
      if (failure instanceof PanelApiError && failure.pointCode !== null) {
        setPointError({
          code: failure.pointCode,
          message:
            failure.code === 'duplicate_point'
              ? 'Este punto aparece dos veces.'
              : 'Este punto ya no está activo en la ruta: deja su hora vacía.',
        });
      } else {
        setError(errorMessage(failure, BASELINE_ERRORS));
      }
    } finally {
      setWorking(false);
    }
  };

  const timeInput = (key: 'plannedStart' | 'actualStart', label: string) => (
    <Field
      id={`baseline-${key}`}
      label={label}
      hint="HH:MM"
      error={errors[key]}
      control={(control) => (
        <input
          {...control}
          className="input num"
          type="time"
          value={form[key]}
          disabled={!editable}
          onChange={(event) => set(key, event.target.value)}
        />
      )}
    />
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      {error !== null && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      <section className="panel-section panel-section--flush" aria-labelledby="baseline-data-title">
        <h2 id="baseline-data-title" className="panel-section__title">
          Datos del recorrido
        </h2>
        <div className="form-grid">
          <Field
            id="baseline-date"
            label="Fecha"
            error={errors.serviceDate}
            control={(control) => (
              <input
                {...control}
                className="input"
                type="date"
                value={form.serviceDate}
                disabled={!editable}
                onChange={(event) => set('serviceDate', event.target.value)}
              />
            )}
          />
          <Field
            id="baseline-route"
            label="Ruta"
            control={(control) => (
              <input {...control} className="input" value={routeCode} readOnly />
            )}
          />
          <Field
            id="baseline-vehicle"
            label="Vehículo"
            hint="Como figura en la unidad. Ejemplo: Compactadora 2"
            control={(control) => (
              <input
                {...control}
                className="input"
                maxLength={80}
                value={form.vehicleLabel}
                disabled={!editable}
                onChange={(event) => set('vehicleLabel', event.target.value)}
              />
            )}
          />
          {timeInput('plannedStart', 'Inicio previsto')}
          {timeInput('actualStart', 'Inicio real')}
          <div className="form-wide">
            <Field
              id="baseline-notes"
              label="Notas"
              hint="Opcional. Desvíos, demoras, clima."
              control={(control) => (
                <textarea
                  {...control}
                  className="input"
                  maxLength={1000}
                  value={form.notes}
                  disabled={!editable}
                  onChange={(event) => set('notes', event.target.value)}
                />
              )}
            />
          </div>
        </div>
      </section>
      <div className="table-wrap baseline-passes">
        <table className="data-table">
          <caption>Hora de paso por punto (deja vacío si no se observó)</caption>
          <thead>
            <tr>
              <th scope="col">Punto</th>
              <th scope="col">Hora de paso (HH:MM)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => {
              const message =
                pointError?.code === point.code ? pointError.message : errors[point.code];
              return (
                <tr key={point.code}>
                  <th scope="row">
                    <label htmlFor={`pass-${point.code}`}>
                      <span className="num">{point.code}</span>
                      <span className="cell-note"> · {point.name}</span>
                    </label>
                  </th>
                  <td className={message === undefined ? undefined : 'cell-error'}>
                    {message !== undefined && (
                      <p id={`pass-${point.code}-error`} className="field__error">
                        {message}
                      </p>
                    )}
                    <input
                      id={`pass-${point.code}`}
                      className="input input--time num"
                      type="time"
                      value={form.passes[point.code] ?? ''}
                      disabled={!editable}
                      aria-invalid={message === undefined ? undefined : true}
                      aria-describedby={
                        message === undefined ? undefined : `pass-${point.code}-error`
                      }
                      onChange={(event) =>
                        set('passes', { ...form.passes, [point.code]: event.target.value })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="sheet__actions">
          <Button type="submit" disabled={working}>
            {working ? 'Guardando…' : 'Guardar recorrido'}
          </Button>
        </div>
      )}
    </form>
  );
}
