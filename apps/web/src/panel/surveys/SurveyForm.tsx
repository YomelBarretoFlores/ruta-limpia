import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field, type FieldControlProps } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import {
  ACCESS,
  CHANNELS,
  INTERRUPTIONS,
  LEAD_TIMES,
  LITTER_SEEN,
  MISSED_PICKUPS,
  POST_ONLY_QUESTIONS,
  SEPARATES,
  SURVEY_WAVES,
} from '../api/types';
import { missingFields, type SurveyForm } from './survey-form';
import {
  ACCESS_LABELS,
  AGREEMENT_OPTIONS,
  ANNOYANCE_OPTIONS,
  CHANNEL_LABELS,
  INTERRUPTION_LABELS,
  LEAD_TIME_LABELS,
  LITTER_LABELS,
  MISSED_LABELS,
  POST_ONLY_LABELS,
  SATISFACTION_OPTIONS,
  SEPARATES_LABELS,
  WAVE_LABELS,
} from './survey-labels';

export interface SurveyFormProps {
  readonly initial: SurveyForm;
  /** Editing keeps the household and the wave (a survey is one household's answers in one wave). */
  readonly editing: boolean;
  /** API problems by field. */
  readonly problems: Partial<Record<keyof SurveyForm, string>>;
  readonly error: string | null;
  readonly working: boolean;
  readonly onSubmit: (form: SurveyForm) => void;
  readonly onDelete?: () => void;
}

type Options = readonly { readonly value: string; readonly label: string }[];

const options = <T extends string>(values: readonly T[], labels: Record<T, string>): Options =>
  values.map((value) => ({ value, label: labels[value] }));

/**
 * Instrument 3 (Tabla 19), in the order of the paper form, one column on a phone. Questions 6–11
 * appear only for the post wave.
 */
export function SurveyFormView(props: SurveyFormProps) {
  const { editing, problems, error, working } = props;
  const [form, setForm] = useState<SurveyForm>(props.initial);
  const [checked, setChecked] = useState(false);
  const set = <K extends keyof SurveyForm>(key: K, value: SurveyForm[K]) =>
    setForm({ ...form, [key]: value });
  const missing = checked ? missingFields(form) : {};
  const messageOf = (key: keyof SurveyForm) => missing[key] ?? problems[key];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(missingFields(form)).length > 0) return;
    props.onSubmit(form);
  };

  const choices = (key: keyof SurveyForm, legend: string, list: Options) => (
    <Choices
      name={key}
      legend={legend}
      options={list}
      value={form[key] as string}
      error={messageOf(key)}
      onChange={(value) => set(key, value as never)}
    />
  );

  return (
    <form className="sheet" onSubmit={submit} noValidate>
      {error !== null && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      <Part title="Hogar y aplicación">
        <Field
          id="survey-household"
          label="Código del hogar"
          hint="Como en el sticker. Ejemplo: H-001"
          error={messageOf('householdCode')}
          control={(control: FieldControlProps) => (
            <input
              {...control}
              className="input"
              value={form.householdCode}
              disabled={editing}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(event) => set('householdCode', event.target.value)}
            />
          )}
        />
        <Field
          id="survey-date"
          label="Fecha"
          error={messageOf('surveyedOn')}
          control={(control) => (
            <input
              {...control}
              className="input"
              type="date"
              value={form.surveyedOn}
              onChange={(event) => set('surveyedOn', event.target.value)}
            />
          )}
        />
        <Choices
          name="wave"
          legend="Aplicación"
          options={options(SURVEY_WAVES, WAVE_LABELS)}
          value={form.wave}
          error={messageOf('wave')}
          disabled={editing}
          onChange={(value) => set('wave', value as SurveyForm['wave'])}
        />
      </Part>

      <Part title="Preguntas 1 a 5">
        {choices('knowsSchedule', '1. ¿Conoce el horario de recolección de su calle?', [
          { value: 'yes', label: 'Sí' },
          { value: 'no', label: 'No' },
        ])}
        {choices(
          'leadTime',
          '2. Normalmente, ¿cuánto tiempo antes del paso del camión saca sus residuos?',
          options(LEAD_TIMES, LEAD_TIME_LABELS),
        )}
        {choices(
          'missedPickups',
          '3. En el último mes, ¿cuántas veces perdió el paso del camión?',
          options(MISSED_PICKUPS, MISSED_LABELS),
        )}
        {choices(
          'litterSeen',
          '4. ¿Ha visto bolsas rotas o basura dispersa en su cuadra en la última semana?',
          options(LITTER_SEEN, LITTER_LABELS),
        )}
        {choices(
          'separates',
          '5. ¿Separa sus residuos (orgánicos, reciclables, otros)?',
          options(SEPARATES, SEPARATES_LABELS),
        )}
      </Part>

      {form.wave === 'post' && (
        <Part title="Preguntas 6 a 11 (solo post)" note="Escala de 1 a 5.">
          {POST_ONLY_QUESTIONS.map((question) => (
            <Choices
              key={question}
              name={question}
              legend={POST_ONLY_LABELS[question]}
              options={question === 'satisfaction' ? SATISFACTION_OPTIONS : AGREEMENT_OPTIONS}
              value={form[question]}
              onChange={(value) => set(question, value)}
            />
          ))}
        </Part>
      )}

      <Part title="Preguntas 12 a 15">
        {choices(
          'annoyance',
          '12. En los últimos 7 días, ¿cuánto le molestó la música usada por el camión?',
          ANNOYANCE_OPTIONS,
        )}
        {choices(
          'interrupted',
          '13. En los últimos 7 días, ¿la música del camión interrumpió su descanso o sus actividades?',
          options(INTERRUPTIONS, INTERRUPTION_LABELS),
        )}
        <fieldset className="choices form-wide">
          <legend>
            14. ¿Por qué medios se enteró del paso del camión en los últimos 7 días? (varias
            respuestas)
          </legend>
          <div className="choice-row">
            {CHANNELS.map((channel) => (
              <label key={channel} className="choice">
                <input
                  type="checkbox"
                  checked={form.channels.includes(channel)}
                  onChange={(event) =>
                    set(
                      'channels',
                      event.target.checked
                        ? [...form.channels, channel]
                        : form.channels.filter((c) => c !== channel),
                    )
                  }
                />
                <span>{CHANNEL_LABELS[channel]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {form.channels.includes('other') && (
          <div className="form-wide">
            <Field
              id="survey-channel-other"
              label="Otro medio"
              error={messageOf('channelOther')}
              control={(control) => (
                <input
                  {...control}
                  className="input"
                  maxLength={200}
                  value={form.channelOther}
                  onChange={(event) => set('channelOther', event.target.value)}
                />
              )}
            />
          </div>
        )}
        {choices(
          'access',
          '15. ¿Puede acceder a las alertas desde su hogar?',
          options(ACCESS, ACCESS_LABELS),
        )}
        {form.access === 'no' && (
          <div className="form-wide">
            <Field
              id="survey-alt-channel"
              label="Medio alternativo requerido"
              error={messageOf('altChannel')}
              control={(control) => (
                <input
                  {...control}
                  className="input"
                  maxLength={200}
                  value={form.altChannel}
                  onChange={(event) => set('altChannel', event.target.value)}
                />
              )}
            />
          </div>
        )}
      </Part>

      <div className="sheet__actions">
        <Button type="submit" disabled={working}>
          {working ? 'Guardando…' : 'Guardar encuesta'}
        </Button>
        {props.onDelete !== undefined && (
          <Button variant="destructive" disabled={working} onClick={props.onDelete}>
            Eliminar encuesta
          </Button>
        )}
      </div>
    </form>
  );
}

/** A question answered with one option: radio buttons in a row (one column on a phone). */
function Choices({
  name,
  legend,
  options: list,
  value,
  error,
  disabled = false,
  onChange,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: Options;
  readonly value: string;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const errorId = `survey-${name}-error`;
  return (
    <fieldset
      className={error === undefined ? 'choices form-wide' : 'choices form-wide field--error'}
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <legend>{legend}</legend>
      {error !== undefined && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
      <div className="choice-row">
        {list.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {value !== '' && !disabled && (
          <button type="button" className="link-button" onClick={() => onChange('')}>
            Sin respuesta
          </button>
        )}
      </div>
    </fieldset>
  );
}

function Part({
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
