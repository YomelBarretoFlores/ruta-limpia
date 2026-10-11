/**
 * Instrument 3, the household survey (proposal, Tabla 19), applied before (`pre`) and after
 * (`post`) the pilot. A survey is linked to a household by its code only (never an address).
 * Questions 1–5 and 12–15 belong to both waves; 6–11 only to the post wave. "No la escuché" (Q12)
 * is recorded on its own, never as a zero annoyance.
 */
export const SURVEY_WAVES = ['pre', 'post'] as const;
export type SurveyWave = (typeof SURVEY_WAVES)[number];

/** Q2: how long before the truck's pass the household puts its waste out. */
export const LEAD_TIMES = ['0_15', '15_60', '1_3h', 'gt_3h', 'after_pass'] as const;
export type LeadTime = (typeof LEAD_TIMES)[number];

/** Q3: times the truck was missed in the last month. */
export const MISSED_PICKUPS = ['0', '1_2', '3_plus'] as const;
export type MissedPickups = (typeof MISSED_PICKUPS)[number];

/** Q4: broken bags or scattered waste seen on the block in the last week. */
export const LITTER_SEEN = ['never', 'sometimes', 'often'] as const;
export type LitterSeen = (typeof LITTER_SEEN)[number];

/** Q5: separates its waste. */
export const SEPARATES = ['yes', 'sometimes', 'no'] as const;
export type Separates = (typeof SEPARATES)[number];

/** Q13: the truck's music interrupted rest or activities in the last 7 days. */
export const INTERRUPTIONS = ['never', '1_2', '3_plus', 'not_heard'] as const;
export type Interruptions = (typeof INTERRUPTIONS)[number];

/** Q14: how the household learned of the truck's pass in the last 7 days (several answers). */
export const CHANNELS = [
  'music',
  'alert',
  'web_map',
  'printed_schedule',
  'neighbor',
  'other',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Q15: can access the alerts from home. */
export const ACCESS = ['yes', 'with_help', 'no'] as const;
export type Access = (typeof ACCESS)[number];

/** Q6–Q11: 1–5 (Q6–Q10 agreement, Q11 satisfaction). Q12: 0–4. */
export const AGREEMENT_SCALE = { min: 1, max: 5 } as const;
export const ANNOYANCE_SCALE = { min: 0, max: 4 } as const;

export interface SurveyAnswers {
  /** Q1. */
  readonly knowsSchedule: boolean | null;
  /** Q2. */
  readonly leadTime: LeadTime | null;
  /** Q3. */
  readonly missedPickups: MissedPickups | null;
  /** Q4. */
  readonly litterSeen: LitterSeen | null;
  /** Q5. */
  readonly separates: Separates | null;
  /** Q6–Q10 (post only): agreement, 1 = strongly disagree … 5 = strongly agree. */
  readonly alertsHelped: number | null;
  readonly easyToUse: number | null;
  readonly etaReliable: number | null;
  readonly streetCleaner: number | null;
  readonly keepSystem: number | null;
  /** Q11 (post only): overall satisfaction, 1 = very dissatisfied … 5 = very satisfied. */
  readonly satisfaction: number | null;
  /** Q12: 0 = not at all … 4 = extremely. */
  readonly annoyance: number | null;
  /** Q12 "No la escuché". */
  readonly notHeard: boolean;
  /** Q13. */
  readonly interrupted: Interruptions | null;
  /** Q14. */
  readonly channels: readonly Channel[];
  readonly channelOther: string | null;
  /** Q15. */
  readonly access: Access | null;
  /** Q15 "No; medio alternativo requerido". */
  readonly altChannel: string | null;
}

export type SurveyProblem =
  /** A question 6–11 is answered in the pre wave. */
  | 'post_only_answer_in_pre'
  /** Q12 has a score and "No la escuché". */
  | 'annoyance_and_not_heard'
  /** Q14 "Otro" is ticked but its text is missing. */
  | 'other_channel_text_required'
  /** A text for Q14 "Otro" is given but "Otro" is not ticked. */
  | 'other_channel_text_without_other'
  /** An alternative channel is given but Q15 is not "No". */
  | 'alt_channel_without_no_access';

const POST_ONLY = [
  'alertsHelped',
  'easyToUse',
  'etaReliable',
  'streetCleaner',
  'keepSystem',
  'satisfaction',
] as const satisfies readonly (keyof SurveyAnswers)[];

/** Every inconsistency of a survey (empty when it can be stored). */
export function surveyProblems(wave: SurveyWave, answers: SurveyAnswers): SurveyProblem[] {
  const problems: SurveyProblem[] = [];
  if (wave === 'pre' && POST_ONLY.some((question) => answers[question] !== null)) {
    problems.push('post_only_answer_in_pre');
  }
  if (answers.notHeard && answers.annoyance !== null) problems.push('annoyance_and_not_heard');
  const hasOtherText = (answers.channelOther?.trim() ?? '') !== '';
  const hasOther = answers.channels.includes('other');
  if (hasOther && !hasOtherText) problems.push('other_channel_text_required');
  if (hasOtherText && !hasOther) problems.push('other_channel_text_without_other');
  if ((answers.altChannel?.trim() ?? '') !== '' && answers.access !== 'no') {
    problems.push('alt_channel_without_no_access');
  }
  return problems;
}
