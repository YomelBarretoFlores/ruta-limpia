import type {
  Dispersion,
  DispersionCause,
  Observation,
  ObservationPhase,
  ObservationProblem,
  ObservationSheet,
} from '../api/types';
import { minutesBetween } from '../format';

/** The sheet as the form holds it: text inputs are strings until sent. */
export interface SheetForm {
  readonly observedOn: string;
  readonly pointCode: string;
  readonly phase: ObservationPhase | '';
  readonly observers: string;
  readonly firstPlacementTime: string;
  readonly truckPassTime: string;
  /** Typed by the observer; used only when the two times do not give the exposure. */
  readonly exposureMinutes: string;
  /** The placement happened before the observation began (a minimum exposure). */
  readonly exposureIncomplete: boolean;
  readonly bagsAtPass: string;
  readonly brokenBags: string;
  readonly dispersion: Dispersion | '';
  readonly dispersionCauses: readonly DispersionCause[];
  readonly dispersionCauseOther: string;
  readonly wasteRemainingAfterPass: 'yes' | 'no' | '';
  readonly photoBeforeTaken: boolean;
  readonly photoBeforeCode: string;
  readonly photoAfterTaken: boolean;
  readonly photoAfterCode: string;
  readonly musicWindowStart: string;
  readonly musicWindowEnd: string;
  readonly musicSeconds: string;
  readonly musicConditions: string;
  /** "Mismo punto y ventana": yes, no, or not answered. */
  readonly comparableWindow: 'yes' | 'no' | '';
  readonly notes: string;
}

export function emptySheet(observedOn: string): SheetForm {
  return {
    observedOn,
    pointCode: '',
    phase: '',
    observers: '',
    firstPlacementTime: '',
    truckPassTime: '',
    exposureMinutes: '',
    exposureIncomplete: false,
    bagsAtPass: '',
    brokenBags: '',
    dispersion: '',
    dispersionCauses: [],
    dispersionCauseOther: '',
    wasteRemainingAfterPass: '',
    photoBeforeTaken: false,
    photoBeforeCode: '',
    photoAfterTaken: false,
    photoAfterCode: '',
    musicWindowStart: '',
    musicWindowEnd: '',
    musicSeconds: '',
    musicConditions: '',
    comparableWindow: '',
    notes: '',
  };
}

const text = (value: string | number | null | undefined) => (value == null ? '' : String(value));

export function sheetFromObservation(observation: Observation): SheetForm {
  return {
    observedOn: observation.observedOn,
    pointCode: observation.pointCode,
    phase: observation.phase,
    observers: observation.observers,
    firstPlacementTime: text(observation.firstPlacementTime),
    truckPassTime: text(observation.truckPassTime),
    exposureMinutes: observation.exposureComputed ? '' : text(observation.exposureMinutes),
    exposureIncomplete: observation.exposureIncomplete,
    bagsAtPass: text(observation.bagsAtPass),
    brokenBags: text(observation.brokenBags),
    dispersion: observation.dispersion ?? '',
    dispersionCauses: observation.dispersionCauses,
    dispersionCauseOther: text(observation.dispersionCauseOther),
    wasteRemainingAfterPass:
      observation.wasteRemainingAfterPass === null
        ? ''
        : observation.wasteRemainingAfterPass
          ? 'yes'
          : 'no',
    photoBeforeTaken: observation.photoBefore.taken,
    photoBeforeCode: text(observation.photoBefore.code),
    photoAfterTaken: observation.photoAfter.taken,
    photoAfterCode: text(observation.photoAfter.code),
    musicWindowStart: text(observation.music?.windowStart),
    musicWindowEnd: text(observation.music?.windowEnd),
    musicSeconds: text(observation.music?.musicSeconds),
    musicConditions: text(observation.music?.conditions),
    // Only an explicit answer is shown: a missing field (an older response) stays unanswered
    // instead of turning into "No", which would drop the sheet from the I3 and I8 comparisons.
    comparableWindow:
      observation.comparableWindow === true
        ? 'yes'
        : observation.comparableWindow === false
          ? 'no'
          : '',
    notes: text(observation.notes),
  };
}

/**
 * The exposure of the first bag: computed from the placement and pass times when both are given
 * (as the API does), otherwise what the observer typed.
 */
export function exposureOf(
  form: Pick<SheetForm, 'firstPlacementTime' | 'truckPassTime' | 'exposureMinutes'>,
): {
  readonly minutes: number | null;
  readonly computed: boolean;
} {
  const computed = minutesBetween(form.firstPlacementTime || null, form.truckPassTime || null);
  if (computed !== null) return { minutes: computed, computed: true };
  return { minutes: wholeNumber(form.exposureMinutes), computed: false };
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** The sheet to send. Music is sent only at points that observe it. */
export function toSheet(
  form: SheetForm,
  routeCode: string,
  observesMusic: boolean,
): ObservationSheet {
  const exposure = exposureOf(form);
  const hasMusic =
    observesMusic &&
    (form.musicWindowStart !== '' || form.musicWindowEnd !== '' || form.musicSeconds !== '');
  return {
    routeCode,
    pointCode: form.pointCode,
    tripId: null,
    observedOn: form.observedOn,
    phase: form.phase as ObservationPhase,
    observers: form.observers.trim(),
    notes: orNull(form.notes),
    firstPlacementTime: orNull(form.firstPlacementTime),
    truckPassTime: orNull(form.truckPassTime),
    exposureMinutes: exposure.computed ? null : exposure.minutes,
    exposureIncomplete: form.exposureIncomplete,
    comparableWindow: form.comparableWindow === '' ? null : form.comparableWindow === 'yes',
    bagsAtPass: wholeNumber(form.bagsAtPass),
    brokenBags: wholeNumber(form.brokenBags),
    dispersion: form.dispersion === '' ? null : form.dispersion,
    dispersionCauses: form.dispersionCauses,
    dispersionCauseOther: orNull(form.dispersionCauseOther),
    wasteRemainingAfterPass:
      form.wasteRemainingAfterPass === '' ? null : form.wasteRemainingAfterPass === 'yes',
    photoBefore: { taken: form.photoBeforeTaken, code: orNull(form.photoBeforeCode) },
    photoAfter: { taken: form.photoAfterTaken, code: orNull(form.photoAfterCode) },
    music: hasMusic
      ? {
          windowStart: form.musicWindowStart,
          windowEnd: form.musicWindowEnd,
          musicSeconds: wholeNumber(form.musicSeconds) ?? 0,
          conditions: orNull(form.musicConditions),
        }
      : null,
  };
}

/** The form fields a sheet needs before it is sent; the API checks the rest. */
export function missingFields(form: SheetForm): Partial<Record<keyof SheetForm, string>> {
  return {
    ...(form.observedOn === '' ? { observedOn: 'Escribe la fecha de la observación.' } : {}),
    ...(form.pointCode === '' ? { pointCode: 'Elige el punto observado.' } : {}),
    ...(form.phase === '' ? { phase: 'Elige la fase del estudio.' } : {}),
    ...(form.observers.trim() === ''
      ? { observers: 'Escribe las iniciales de quienes observaron.' }
      : {}),
  };
}

const NOT_A_WHOLE_NUMBER = 'Escribe un número entero, sin decimales ni signos.';

/**
 * Counts typed in a way that is not a whole number (a decimal, a sign, a typo). They are refused
 * with a message: sending them as "not recorded" would lose what the observer meant to record. A
 * typed exposure is checked only when the two times do not give it.
 */
export function numberErrors(form: SheetForm): Partial<Record<keyof SheetForm, string>> {
  const fields: (keyof SheetForm)[] = ['bagsAtPass', 'brokenBags', 'musicSeconds'];
  if (!exposureOf(form).computed) fields.push('exposureMinutes');
  const errors: Partial<Record<keyof SheetForm, string>> = {};
  for (const field of fields) {
    const value = (form[field] as string).trim();
    if (value !== '' && wholeNumber(value) === null) errors[field] = NOT_A_WHOLE_NUMBER;
  }
  return errors;
}

/** Where each inconsistency the API finds is shown, and what it says. */
export const PROBLEM_MESSAGES: Record<
  ObservationProblem,
  { readonly field: keyof SheetForm; readonly message: string }
> = {
  pass_before_placement: {
    field: 'truckPassTime',
    message: 'La hora de paso es anterior a la primera colocación. Revisa las dos horas.',
  },
  broken_bags_exceed_bags: {
    field: 'brokenBags',
    message: 'Las bolsas rotas no pueden ser más que las bolsas al paso.',
  },
  causes_without_dispersion: {
    field: 'dispersionCauses',
    message: 'Marca causas solo si hubo residuos dispersos.',
  },
  other_cause_text_required: {
    field: 'dispersionCauseOther',
    message: 'Describe la otra causa.',
  },
  other_cause_text_without_other: {
    field: 'dispersionCauseOther',
    message: 'Marca «Otra» para describir otra causa, o borra el texto.',
  },
  photo_code_without_photo: {
    field: 'photoBeforeCode',
    message: 'Hay un código de foto sin marcar que la foto se tomó. Márcalo o borra el código.',
  },
  music_not_observed_at_point: {
    field: 'musicWindowStart',
    message: 'En este punto no se observa la música. Deja la sección vacía.',
  },
  music_window_invalid: {
    field: 'musicWindowEnd',
    message: 'El fin de la ventana debe ser posterior a su inicio.',
  },
  music_seconds_exceed_window: {
    field: 'musicSeconds',
    message: 'Los segundos de música superan la duración de la ventana.',
  },
};

/** The API's problems as messages by field (several may land on one field). */
export function problemsByField(
  problems: readonly ObservationProblem[],
): Partial<Record<keyof SheetForm, string>> {
  const result: Partial<Record<keyof SheetForm, string>> = {};
  for (const problem of problems) {
    const { field, message } = PROBLEM_MESSAGES[problem];
    result[field] = result[field] === undefined ? message : `${result[field]} ${message}`;
  }
  return result;
}
