import {
  POST_ONLY_QUESTIONS,
  type Access,
  type Channel,
  type Interruptions,
  type LeadTime,
  type LitterSeen,
  type MissedPickups,
  type PostOnlyQuestion,
  type Separates,
  type Survey,
  type SurveyInput,
  type SurveyProblem,
  type SurveyWave,
} from '../api/types';

/** The survey as the form holds it: radio answers are codes, '' when unanswered. */
export interface SurveyForm extends Record<PostOnlyQuestion, string> {
  readonly householdCode: string;
  readonly wave: SurveyWave | '';
  readonly surveyedOn: string;
  readonly knowsSchedule: 'yes' | 'no' | '';
  readonly leadTime: LeadTime | '';
  readonly missedPickups: MissedPickups | '';
  readonly litterSeen: LitterSeen | '';
  readonly separates: Separates | '';
  /** Q12: `0`–`4`, `not_heard`, or ''. */
  readonly annoyance: string;
  readonly interrupted: Interruptions | '';
  readonly channels: readonly Channel[];
  readonly channelOther: string;
  readonly access: Access | '';
  readonly altChannel: string;
}

const NO_POST_ANSWERS = Object.fromEntries(POST_ONLY_QUESTIONS.map((q) => [q, ''])) as Record<
  PostOnlyQuestion,
  string
>;

export function emptySurvey(surveyedOn: string): SurveyForm {
  return {
    householdCode: '',
    wave: '',
    surveyedOn,
    knowsSchedule: '',
    leadTime: '',
    missedPickups: '',
    litterSeen: '',
    separates: '',
    ...NO_POST_ANSWERS,
    annoyance: '',
    interrupted: '',
    channels: [],
    channelOther: '',
    access: '',
    altChannel: '',
  };
}

const text = (value: number | string | null) => (value === null ? '' : String(value));

export function surveyFromRecord(survey: Survey): SurveyForm {
  return {
    householdCode: survey.householdCode,
    wave: survey.wave,
    surveyedOn: survey.surveyedOn,
    knowsSchedule: survey.knowsSchedule === null ? '' : survey.knowsSchedule ? 'yes' : 'no',
    leadTime: survey.leadTime ?? '',
    missedPickups: survey.missedPickups ?? '',
    litterSeen: survey.litterSeen ?? '',
    separates: survey.separates ?? '',
    ...(Object.fromEntries(POST_ONLY_QUESTIONS.map((q) => [q, text(survey[q])])) as Record<
      PostOnlyQuestion,
      string
    >),
    annoyance: survey.notHeard ? 'not_heard' : text(survey.annoyance),
    interrupted: survey.interrupted ?? '',
    channels: survey.channels,
    channelOther: survey.channelOther ?? '',
    access: survey.access ?? '',
    altChannel: survey.altChannel ?? '',
  };
}

const orNull = <T extends string>(value: T | '') => (value === '' ? null : value);
const score = (value: string) => (value === '' ? null : Number(value));
const trimmedOrNull = (value: string) => (value.trim() === '' ? null : value.trim());

/**
 * The survey to send. Questions 6–11 go only with the post wave, the "Otro" text only with
 * "Otro" ticked, and the alternative channel only with no access.
 */
export function toSurveyInput(form: SurveyForm): SurveyInput {
  const post = form.wave === 'post';
  return {
    householdCode: form.householdCode.trim().toUpperCase(),
    wave: form.wave as SurveyWave,
    surveyedOn: form.surveyedOn,
    knowsSchedule: form.knowsSchedule === '' ? null : form.knowsSchedule === 'yes',
    leadTime: orNull(form.leadTime),
    missedPickups: orNull(form.missedPickups),
    litterSeen: orNull(form.litterSeen),
    separates: orNull(form.separates),
    ...(Object.fromEntries(
      POST_ONLY_QUESTIONS.map((q) => [q, post ? score(form[q]) : null]),
    ) as Record<PostOnlyQuestion, number | null>),
    annoyance: form.annoyance === 'not_heard' ? null : score(form.annoyance),
    notHeard: form.annoyance === 'not_heard',
    interrupted: orNull(form.interrupted),
    channels: form.channels,
    channelOther: form.channels.includes('other') ? trimmedOrNull(form.channelOther) : null,
    access: orNull(form.access),
    altChannel: form.access === 'no' ? trimmedOrNull(form.altChannel) : null,
  };
}

/** The answers a survey needs before it is sent; the API checks the rest. */
export function missingFields(form: SurveyForm): Partial<Record<keyof SurveyForm, string>> {
  return {
    ...(/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/.test(form.householdCode.trim())
      ? {}
      : { householdCode: 'Escribe el código del hogar, como en su sticker (H-001).' }),
    ...(form.wave === '' ? { wave: 'Elige si es la aplicación pre o post.' } : {}),
    ...(form.surveyedOn === '' ? { surveyedOn: 'Escribe la fecha de la encuesta.' } : {}),
    ...(form.channels.includes('other') && form.channelOther.trim() === ''
      ? { channelOther: 'Escribe cuál es el otro medio.' }
      : {}),
  };
}

/** Where each inconsistency the API finds is shown, and what it says. */
export const SURVEY_PROBLEM_MESSAGES: Record<
  SurveyProblem,
  { readonly field: keyof SurveyForm; readonly message: string }
> = {
  post_only_answer_in_pre: {
    field: 'wave',
    message: 'Las preguntas 6 a 11 son solo de la aplicación post.',
  },
  annoyance_and_not_heard: {
    field: 'annoyance',
    message: 'Elige un puntaje o «No la escuché», no ambos.',
  },
  other_channel_text_required: { field: 'channelOther', message: 'Escribe cuál es el otro medio.' },
  other_channel_text_without_other: {
    field: 'channelOther',
    message: 'Marca «Otro» para escribir otro medio, o borra el texto.',
  },
  alt_channel_without_no_access: {
    field: 'altChannel',
    message: 'El medio alternativo se anota solo si no puede acceder a las alertas.',
  },
};

export function surveyProblemsByField(
  problems: readonly string[],
): Partial<Record<keyof SurveyForm, string>> {
  const result: Partial<Record<keyof SurveyForm, string>> = {};
  for (const problem of problems) {
    const known = SURVEY_PROBLEM_MESSAGES[problem as SurveyProblem] as
      (typeof SURVEY_PROBLEM_MESSAGES)[SurveyProblem] | undefined;
    if (known === undefined) continue;
    result[known.field] =
      result[known.field] === undefined ? known.message : `${result[known.field]} ${known.message}`;
  }
  return result;
}
