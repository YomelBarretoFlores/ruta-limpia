import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import type { HouseholdChanges, HouseholdListItem, NewHousehold } from '../api/types';

/** The consent text households sign at enrollment (the API's default version). */
const CONSENT_VERSION = 'enrollment-2026-10';
const NOTES_MAX_LENGTH = 280;
const NOTES_HINT =
  'Opcional, hasta 280 caracteres. Nunca escribas direcciones, nombres ni teléfonos.';

interface Point {
  readonly code: string;
  readonly name: string;
}

function PointSelect({
  id,
  points,
  value,
  onChange,
  error,
}: {
  readonly id: string;
  readonly points: readonly Point[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
}) {
  return (
    <Field
      id={id}
      label="Punto de referencia"
      error={error}
      control={(control) => (
        <select
          {...control}
          className="select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Elige…</option>
          {points.map((point) => (
            <option key={point.code} value={point.code}>
              {point.code} · {point.name}
            </option>
          ))}
        </select>
      )}
    />
  );
}

function useSubmit(describeError: (error: unknown) => string) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setWorking(false);
    }
  };
  return { error, working, run };
}

/**
 * Why a consent date cannot be sent, or null. The form has `noValidate`, so the input's `max` is
 * not enforced by the browser: a future date is refused here, with a message.
 */
function consentDateError(date: string, today: string): string | null {
  if (date === '') return 'Escribe la fecha en que el hogar firmó.';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const parsed = match === null ? Number.NaN : Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return 'Escribe una fecha válida (día, mes y año).';
  }
  return date > today ? 'La fecha del consentimiento no puede ser posterior a hoy.' : null;
}

/** "Inscribir hogar": the point, the consent date and version, and notes. The API gives the code. */
export function EnrollForm({
  routeCode,
  points,
  today,
  onEnroll,
  onCancel,
  describeError,
}: {
  readonly routeCode: string;
  readonly points: readonly Point[];
  /** `YYYY-MM-DD` in Lima. */
  readonly today: string;
  readonly onEnroll: (household: NewHousehold) => Promise<void>;
  readonly onCancel: () => void;
  readonly describeError: (error: unknown) => string;
}) {
  const [pointCode, setPointCode] = useState('');
  const [consentDate, setConsentDate] = useState(today);
  const [consentVersion, setConsentVersion] = useState(CONSENT_VERSION);
  const [notes, setNotes] = useState('');
  const [checked, setChecked] = useState(false);
  const { error, working, run } = useSubmit(describeError);

  const dateError = consentDateError(consentDate, today);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (pointCode === '' || dateError !== null) return;
    void run(() =>
      onEnroll({
        routeCode,
        pointCode,
        // Today's consent is stamped by the server; an earlier one is the start of that day.
        ...(consentDate === today ? {} : { consentAt: `${consentDate}T00:00:00-05:00` }),
        consentVersion: consentVersion.trim() === '' ? CONSENT_VERSION : consentVersion.trim(),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      }),
    );
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
      <PointSelect
        id="enroll-point"
        points={points}
        value={pointCode}
        onChange={setPointCode}
        error={
          checked && pointCode === ''
            ? 'Elige el punto donde el hogar deja sus residuos.'
            : undefined
        }
      />
      <Field
        id="enroll-consent-date"
        label="Fecha del consentimiento"
        error={checked ? (dateError ?? undefined) : undefined}
        control={(control) => (
          <input
            {...control}
            className="input"
            type="date"
            max={today}
            value={consentDate}
            onChange={(e) => setConsentDate(e.target.value)}
          />
        )}
      />
      <Field
        id="enroll-consent-version"
        label="Versión del consentimiento"
        control={(control) => (
          <input
            {...control}
            className="input"
            maxLength={32}
            value={consentVersion}
            onChange={(e) => setConsentVersion(e.target.value)}
          />
        )}
      />
      <div className="form-wide">
        <Field
          id="enroll-notes"
          label="Notas"
          hint={NOTES_HINT}
          control={(control) => (
            <textarea
              {...control}
              className="input"
              maxLength={NOTES_MAX_LENGTH}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        />
      </div>
      <div className="form-actions">
        <Button type="submit" className="button--compact" disabled={working}>
          Inscribir hogar
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Editing a household: another point of the same route, notes, or taking it out (inactive). */
export function EditHouseholdForm({
  household,
  points,
  onSave,
  onCancel,
  describeError,
}: {
  readonly household: HouseholdListItem;
  readonly points: readonly Point[];
  readonly onSave: (changes: HouseholdChanges) => Promise<void>;
  readonly onCancel: () => void;
  readonly describeError: (error: unknown) => string;
}) {
  const [pointCode, setPointCode] = useState(household.pointCode);
  const [notes, setNotes] = useState(household.notes ?? '');
  const [active, setActive] = useState(household.active);
  const { error, working, run } = useSubmit(describeError);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = notes.trim();
    const changes: HouseholdChanges = {
      ...(pointCode !== household.pointCode ? { pointCode } : {}),
      ...(trimmed !== (household.notes ?? '') ? { notes: trimmed === '' ? null : trimmed } : {}),
      ...(active !== household.active ? { active } : {}),
    };
    // Nothing changed: nothing to send.
    if (Object.keys(changes).length === 0) return onCancel();
    void run(() => onSave(changes));
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
      <PointSelect
        id="edit-household-point"
        points={points}
        value={pointCode}
        onChange={setPointCode}
      />
      <label className="choice">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>
          Hogar activo (al darlo de baja, su código ya no sirve para nuevas suscripciones)
        </span>
      </label>
      <div className="form-wide">
        <Field
          id="edit-household-notes"
          label="Notas"
          hint={NOTES_HINT}
          control={(control) => (
            <textarea
              {...control}
              className="input"
              maxLength={NOTES_MAX_LENGTH}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        />
      </div>
      <div className="form-actions">
        <Button type="submit" className="button--compact" disabled={working}>
          Guardar cambios
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
