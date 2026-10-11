import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field, type FieldControlProps } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import {
  DISPERSION_CAUSES,
  OBSERVATION_PHASES,
  type Dispersion,
  type DispersionCause,
  type ObservationPhase,
} from '../api/types';
import { PHASE_LABELS } from '../labels';
import { exposureOf, missingFields, numberErrors, type SheetForm } from './field-sheet';

const DISPERSION: readonly { readonly value: Dispersion; readonly label: string }[] = [
  { value: 'none', label: 'No' },
  { value: 'few', label: 'Pocos' },
  { value: 'many', label: 'Muchos' },
];

const CAUSE_LABELS: Record<DispersionCause, string> = {
  animals: 'Animales',
  wind: 'Viento',
  manipulation: 'Manipulación observada',
  undetermined: 'No determinada',
  other: 'Otra',
};

export interface FieldSheetFormProps {
  readonly initial: SheetForm;
  readonly routeCode: string;
  readonly points: readonly {
    readonly code: string;
    readonly name: string;
    readonly observesMusic: boolean;
  }[];
  /** Messages of the API's `problems`, by field. */
  readonly problems: Partial<Record<keyof SheetForm, string>>;
  /** A failure that is not about one field (permissions, connection). */
  readonly error: string | null;
  readonly working: boolean;
  /** False when the sheet can only be read (another observer's, or past the 24-hour window). */
  readonly editable: boolean;
  readonly onSubmit: (form: SheetForm) => void;
  readonly onDelete?: () => void;
}

/**
 * Instrument 2, one sheet per point and visit, in the order of the paper form. One column on a
 * phone; the exposure is computed from the two times and typed only when one is missing.
 */
export function FieldSheetForm(props: FieldSheetFormProps) {
  const { routeCode, points, problems, error, working, editable } = props;
  const [form, setForm] = useState<SheetForm>(props.initial);
  const [checked, setChecked] = useState(false);
  const set = <K extends keyof SheetForm>(key: K, value: SheetForm[K]) =>
    setForm({ ...form, [key]: value });
  const formErrors = (sheet: SheetForm) => ({ ...missingFields(sheet), ...numberErrors(sheet) });
  const fieldErrors = checked ? formErrors(form) : {};
  const messageOf = (key: keyof SheetForm) => fieldErrors[key] ?? problems[key];
  const point = points.find((p) => p.code === form.pointCode);
  const exposure = exposureOf(form);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(formErrors(form)).length > 0) return;
    props.onSubmit(form);
  };

  /** The render function of a text-like input bound to one field of the sheet. */
  const input =
    (key: keyof SheetForm, extra: Record<string, unknown> = {}) =>
    (control: FieldControlProps) => (
      <input
        {...control}
        className="input"
        value={form[key] as string}
        disabled={!editable}
        onChange={(event) => set(key, event.target.value as never)}
        {...extra}
      />
    );

  return (
    <form className="sheet" onSubmit={submit} noValidate>
      {error !== null && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      {Object.keys(problems).length > 0 && (
        <Notice tone="danger" title="La ficha tiene datos que no cuadran">
          <p>Revisa los campos marcados.</p>
        </Notice>
      )}
      <SheetPart title="1. Punto y visita">
        <Field
          id="sheet-date"
          label="Fecha"
          error={messageOf('observedOn')}
          control={input('observedOn', { type: 'date' })}
        />
        <Field
          id="sheet-route"
          label="Ruta"
          control={(control) => <input {...control} className="input" value={routeCode} readOnly />}
        />
        <Field
          id="sheet-point"
          label="Punto"
          error={messageOf('pointCode')}
          control={(control) => (
            <select
              {...control}
              className="select"
              value={form.pointCode}
              disabled={!editable}
              onChange={(event) => set('pointCode', event.target.value)}
            >
              <option value="">Elige…</option>
              {points.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="sheet-phase"
          label="Fase"
          error={messageOf('phase')}
          control={(control) => (
            <select
              {...control}
              className="select"
              value={form.phase}
              disabled={!editable}
              onChange={(event) => set('phase', event.target.value as ObservationPhase)}
            >
              <option value="">Elige…</option>
              {OBSERVATION_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {PHASE_LABELS[phase]}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="sheet-observers"
          label="Observadores"
          hint="Iniciales, separadas por comas. Ejemplo: L.R., M.Q."
          error={messageOf('observers')}
          control={input('observers', { autoComplete: 'off' })}
        />
      </SheetPart>

      <SheetPart title="2. Horas y exposición">
        <Field
          id="sheet-placement"
          label="Hora de primera colocación"
          hint="Cuando se dejó la primera bolsa en el punto."
          error={messageOf('firstPlacementTime')}
          control={input('firstPlacementTime', { type: 'time' })}
        />
        <Field
          id="sheet-pass"
          label="Hora de paso del camión"
          error={messageOf('truckPassTime')}
          control={input('truckPassTime', { type: 'time' })}
        />
        {exposure.computed ? (
          <Field
            id="sheet-exposure"
            label="Exposición (minutos)"
            hint="Calculada con las dos horas."
            control={(control) => (
              <input {...control} className="input num" value={exposure.minutes ?? ''} readOnly />
            )}
          />
        ) : (
          <Field
            id="sheet-exposure"
            label="Exposición (minutos)"
            hint="Falta una hora: escribe los minutos observados, si los tienes."
            error={messageOf('exposureMinutes')}
            control={input('exposureMinutes', { inputMode: 'numeric', pattern: '[0-9]*' })}
          />
        )}
      </SheetPart>

      <SheetPart title="3. Bolsas">
        <Field
          id="sheet-bags"
          label="Bolsas al paso del camión"
          error={messageOf('bagsAtPass')}
          control={input('bagsAtPass', { inputMode: 'numeric', pattern: '[0-9]*' })}
        />
        <Field
          id="sheet-broken"
          label="Bolsas rotas"
          error={messageOf('brokenBags')}
          control={input('brokenBags', { inputMode: 'numeric', pattern: '[0-9]*' })}
        />
      </SheetPart>

      <SheetPart title="4. Residuos dispersos (a menos de 5 m)">
        <fieldset className="choices form-wide">
          <legend>¿Hubo residuos dispersos?</legend>
          <div className="choice-row">
            {DISPERSION.map((option) => (
              <label key={option.value} className="choice">
                <input
                  type="radio"
                  name="dispersion"
                  value={option.value}
                  checked={form.dispersion === option.value}
                  disabled={!editable}
                  onChange={() => set('dispersion', option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset
          className={
            messageOf('dispersionCauses') === undefined
              ? 'choices form-wide'
              : 'choices form-wide field--error'
          }
          aria-describedby={
            messageOf('dispersionCauses') === undefined ? undefined : 'sheet-causes-error'
          }
        >
          <legend>Causas observadas</legend>
          {messageOf('dispersionCauses') !== undefined && (
            <p id="sheet-causes-error" className="field__error">
              {messageOf('dispersionCauses')}
            </p>
          )}
          <div className="choice-row">
            {DISPERSION_CAUSES.map((cause) => (
              <label key={cause} className="choice">
                <input
                  type="checkbox"
                  checked={form.dispersionCauses.includes(cause)}
                  disabled={!editable}
                  onChange={(event) =>
                    set(
                      'dispersionCauses',
                      event.target.checked
                        ? [...form.dispersionCauses, cause]
                        : form.dispersionCauses.filter((c) => c !== cause),
                    )
                  }
                />
                <span>{CAUSE_LABELS[cause]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-wide">
          <Field
            id="sheet-other-cause"
            label="Otra causa"
            hint="Solo si marcaste «Otra»."
            error={messageOf('dispersionCauseOther')}
            control={input('dispersionCauseOther', { maxLength: 200 })}
          />
        </div>
      </SheetPart>

      <SheetPart title="5. Después del paso">
        <fieldset className="choices form-wide">
          <legend>¿Quedaron residuos tras el paso del camión?</legend>
          <div className="choice-row">
            {(['yes', 'no'] as const).map((value) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="remaining"
                  checked={form.wasteRemainingAfterPass === value}
                  disabled={!editable}
                  onChange={() => set('wasteRemainingAfterPass', value)}
                />
                <span>{value === 'yes' ? 'Sí' : 'No'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </SheetPart>

      <SheetPart
        title="6. Fotografías"
        note="Sin rostros ni placas. Solo se anota el código del archivo."
      >
        <label className="choice">
          <input
            type="checkbox"
            checked={form.photoBeforeTaken}
            disabled={!editable}
            onChange={(event) => set('photoBeforeTaken', event.target.checked)}
          />
          <span>Se tomó la foto antes del paso</span>
        </label>
        <Field
          id="sheet-photo-before"
          label="Código de la foto antes"
          hint="Ejemplo: F-P08-001"
          error={messageOf('photoBeforeCode')}
          control={input('photoBeforeCode', { maxLength: 40, autoCapitalize: 'characters' })}
        />
        <label className="choice">
          <input
            type="checkbox"
            checked={form.photoAfterTaken}
            disabled={!editable}
            onChange={(event) => set('photoAfterTaken', event.target.checked)}
          />
          <span>Se tomó la foto después del paso</span>
        </label>
        <Field
          id="sheet-photo-after"
          label="Código de la foto después"
          error={messageOf('photoAfterCode')}
          control={input('photoAfterCode', { maxLength: 40, autoCapitalize: 'characters' })}
        />
      </SheetPart>

      {point?.observesMusic === true && (
        <SheetPart
          title="7. Aviso con música"
          note={`En ${point.code} se observa la música del camión.`}
        >
          <Field
            id="sheet-music-start"
            label="Inicio de la ventana"
            error={messageOf('musicWindowStart')}
            control={input('musicWindowStart', { type: 'time' })}
          />
          <Field
            id="sheet-music-end"
            label="Fin de la ventana"
            error={messageOf('musicWindowEnd')}
            control={input('musicWindowEnd', { type: 'time' })}
          />
          <Field
            id="sheet-music-seconds"
            label="Segundos de música"
            error={messageOf('musicSeconds')}
            control={input('musicSeconds', { inputMode: 'numeric', pattern: '[0-9]*' })}
          />
          <Field
            id="sheet-music-conditions"
            label="Clima y otras fuentes de ruido"
            control={input('musicConditions', { maxLength: 300 })}
          />
        </SheetPart>
      )}

      <SheetPart title={point?.observesMusic === true ? '8. Notas' : '7. Notas'}>
        <div className="form-wide">
          <Field
            id="sheet-notes"
            label="Notas"
            hint="Opcional. Sin nombres ni direcciones."
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
      </SheetPart>

      {editable && (
        <div className="sheet__actions">
          <Button type="submit" disabled={working}>
            {working ? 'Guardando…' : 'Guardar ficha'}
          </Button>
          {props.onDelete !== undefined && (
            <Button variant="destructive" disabled={working} onClick={props.onDelete}>
              Eliminar ficha
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

function SheetPart({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="sheet__part">
      <legend className="sheet__legend">{title}</legend>
      {note !== undefined && <p className="sheet__note">{note}</p>}
      <div className="form-grid">{children}</div>
    </fieldset>
  );
}
