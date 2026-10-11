import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { INCIDENT_KINDS, type IncidentKind, type NewIncident } from '../api/types';
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '../format';
import { INCIDENT_KIND_LABELS } from '../labels';

export interface IncidentFormValues {
  readonly kind: IncidentKind | '';
  readonly pointCode: string;
  readonly tripId: string;
  readonly occurredAt: string;
  readonly description: string;
}

export interface IncidentFormProps {
  readonly routeCode: string;
  readonly points: readonly { readonly code: string; readonly name: string }[];
  /** Trips the incident may belong to (the active one in the live view). */
  readonly trips: readonly { readonly id: string; readonly label: string }[];
  /** The trips are still loading: a preset trip is kept until the list arrives. */
  readonly tripsLoading?: boolean;
  readonly initial?: Partial<IncidentFormValues>;
  /** Editing keeps the route, the point, the trip and the time (the API changes kind and text). */
  readonly editing?: boolean;
  readonly now: number;
  readonly submitLabel: string;
  readonly onSubmit: (incident: NewIncident) => Promise<void>;
  readonly onCancel: () => void;
  readonly describeError: (error: unknown) => string;
}

/** An incident: kind, optional point and trip, when it happened, and what happened. */
export function IncidentForm(props: IncidentFormProps) {
  const { routeCode, points, trips, initial, editing = false, tripsLoading = false, now } = props;
  const [values, setValues] = useState<IncidentFormValues>({
    kind: '',
    pointCode: '',
    tripId: '',
    occurredAt: toLocalDateTimeInput(now),
    description: '',
    ...initial,
  });
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const occurredAt = fromLocalDateTimeInput(values.occurredAt);
  // A trip that is no longer offered (it ended while the form was open) is not chosen anymore:
  // the select shows "Sin viaje" and nothing stale is sent. Editing never sends the trip. While
  // the trips are still loading, a preset trip is kept (the list cannot tell yet).
  const offered = trips.some((trip) => trip.id === values.tripId);
  const tripId = editing || tripsLoading || offered ? values.tripId : '';
  const pendingTrip = tripId !== '' && !offered;
  const kindError = checked && values.kind === '' ? 'Elige el tipo de incidencia.' : undefined;
  const timeError =
    checked && occurredAt === null
      ? 'Escribe la fecha y la hora (día, mes, año y hora).'
      : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (values.kind === '' || occurredAt === null) return;
    setWorking(true);
    setError(null);
    try {
      const description = values.description.trim();
      await props.onSubmit({
        kind: values.kind,
        routeCode,
        ...(values.pointCode === '' ? {} : { pointCode: values.pointCode }),
        ...(tripId === '' ? {} : { tripId }),
        occurredAt,
        ...(description === '' ? {} : { description }),
      });
    } catch (failure) {
      setError(props.describeError(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>
      {error !== null && (
        <div className="form-wide">
          <Notice tone="danger">
            <p>{error}</p>
          </Notice>
        </div>
      )}
      <Field
        id="incident-kind"
        label="Tipo"
        error={kindError}
        control={(control) => (
          <select
            {...control}
            className="select"
            value={values.kind}
            onChange={(event) => setValues({ ...values, kind: event.target.value as IncidentKind })}
          >
            <option value="">Elige…</option>
            {INCIDENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {INCIDENT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        )}
      />
      <Field
        id="incident-point"
        label="Punto (opcional)"
        control={(control) => (
          <select
            {...control}
            className="select"
            value={values.pointCode}
            disabled={editing}
            onChange={(event) => setValues({ ...values, pointCode: event.target.value })}
          >
            <option value="">Toda la ruta</option>
            {points.map((point) => (
              <option key={point.code} value={point.code}>
                {point.code} · {point.name}
              </option>
            ))}
          </select>
        )}
      />
      <Field
        id="incident-trip"
        label="Viaje (opcional)"
        control={(control) => (
          <select
            {...control}
            className="select"
            value={tripId}
            disabled={editing}
            onChange={(event) => setValues({ ...values, tripId: event.target.value })}
          >
            <option value="">Sin viaje</option>
            {pendingTrip && (
              <option value={tripId}>
                {tripsLoading ? 'Cargando viajes…' : 'Viaje registrado'}
              </option>
            )}
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.label}
              </option>
            ))}
          </select>
        )}
      />
      <Field
        id="incident-time"
        label="Fecha y hora"
        hint="Hora de Lima."
        error={timeError}
        control={(control) => (
          <input
            {...control}
            className="input"
            type="datetime-local"
            value={values.occurredAt}
            disabled={editing}
            onChange={(event) => setValues({ ...values, occurredAt: event.target.value })}
          />
        )}
      />
      <div className="form-wide">
        <Field
          id="incident-description"
          label="Descripción (opcional)"
          hint="Qué pasó y qué se hizo. Sin nombres ni direcciones de vecinos."
          control={(control) => (
            <textarea
              {...control}
              className="input"
              maxLength={1000}
              value={values.description}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
            />
          )}
        />
      </div>
      <div className="form-actions">
        <Button type="submit" className="button--compact" disabled={working}>
          {props.submitLabel}
        </Button>
        <button type="button" className="link-button" onClick={props.onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
