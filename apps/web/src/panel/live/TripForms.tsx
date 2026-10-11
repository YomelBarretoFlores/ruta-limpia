import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import type { Vehicle } from '../api/types';

/** The longest end note the API keeps. */
const END_NOTE_MAX_LENGTH = 500;

interface FormChrome {
  readonly onCancel: () => void;
  readonly describeError: (error: unknown) => string;
}

async function attempt(
  action: () => Promise<void>,
  setError: (message: string | null) => void,
  setWorking: (working: boolean) => void,
  describeError: (error: unknown) => string,
) {
  setWorking(true);
  setError(null);
  try {
    await action();
  } catch (failure) {
    setError(describeError(failure));
  } finally {
    setWorking(false);
  }
}

/** "Iniciar viaje": a manual start, when the truck's GPS did not start the trip by itself. */
export function StartTripForm({
  routeCode,
  vehicles,
  onStart,
  onCancel,
  describeError,
}: FormChrome & {
  readonly routeCode: string;
  readonly vehicles: readonly Vehicle[] | undefined;
  readonly onStart: (vehicleCode: string) => Promise<void>;
}) {
  const usable = (vehicles ?? []).filter((v) => v.active);
  const preferred = usable.find((v) => v.defaultRoute?.code === routeCode) ?? usable[0];
  const [vehicleCode, setVehicleCode] = useState(preferred?.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const chosen = vehicleCode === '' ? (preferred?.code ?? '') : vehicleCode;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen === '') return;
    void attempt(() => onStart(chosen), setError, setWorking, describeError);
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      {error !== null && (
        <div className="form-wide">
          <Notice tone="danger">
            <p>{error}</p>
          </Notice>
        </div>
      )}
      <Field
        id="start-vehicle"
        label="Vehículo"
        hint={vehicles === undefined ? 'Cargando los vehículos…' : undefined}
        control={(control) => (
          <select
            {...control}
            className="select"
            value={chosen}
            onChange={(event) => setVehicleCode(event.target.value)}
          >
            {usable.map((vehicle) => (
              <option
                key={vehicle.code}
                value={vehicle.code}
                disabled={vehicle.activeTrip !== null}
              >
                {vehicle.label}
                {vehicle.activeTrip === null ? '' : ' (en viaje)'}
              </option>
            ))}
          </select>
        )}
      />
      <Field
        id="start-route"
        label="Ruta"
        control={(control) => <input {...control} className="input" value={routeCode} readOnly />}
      />
      <div className="form-actions">
        <Button type="submit" className="button--compact" disabled={working || chosen === ''}>
          Iniciar viaje
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** "Finalizar viaje": a manual end always says why (the note is kept with the trip). */
export function EndTripForm({
  vehicleLabel,
  onEnd,
  onCancel,
  describeError,
}: FormChrome & {
  readonly vehicleLabel: string;
  readonly onEnd: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const missing = note.trim() === '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (missing) return;
    void attempt(() => onEnd(note.trim()), setError, setWorking, describeError);
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      {error !== null && (
        <div className="form-wide">
          <Notice tone="danger">
            <p>{error}</p>
          </Notice>
        </div>
      )}
      <div className="form-wide">
        <Field
          id="end-note"
          label={`Motivo para finalizar el viaje de ${vehicleLabel}`}
          hint={`Obligatorio. Hasta ${END_NOTE_MAX_LENGTH} caracteres; queda registrado con el viaje.`}
          error={checked && missing ? 'Escribe por qué se finaliza el viaje.' : undefined}
          control={(control) => (
            <textarea
              {...control}
              className="input"
              maxLength={END_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        />
      </div>
      <div className="form-actions">
        <Button type="submit" className="button--compact" disabled={working}>
          Finalizar viaje
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
