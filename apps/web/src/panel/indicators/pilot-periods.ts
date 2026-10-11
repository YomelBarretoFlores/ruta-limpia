/**
 * The pilot's calendar (proposal, 2026-10-19 to 2026-12-20, nine weeks). Phases are not stored:
 * the indicator screens offer them as ready-made periods.
 */
export interface PilotPeriod {
  readonly label: string;
  /** `YYYY-MM-DD`, America/Lima, inclusive. */
  readonly from: string;
  readonly to: string;
}

/** Fase 3 runs in weeks 5 to 8 (S5–S8), when the precision, adoption and availability count. */
export const PHASE_3: PilotPeriod = {
  label: 'Fase 3 (semanas 5 a 8)',
  from: '2026-11-16',
  to: '2026-12-13',
};

export const WHOLE_PILOT: PilotPeriod = {
  label: 'Todo el piloto',
  from: '2026-10-19',
  to: '2026-12-20',
};

export const PILOT_PERIODS: readonly PilotPeriod[] = [PHASE_3, WHOLE_PILOT];

/** The longest period the API accepts for the indicators and the exports, in days. */
export const MAX_PERIOD_DAYS = 120;

/** What is wrong with a chosen period, if anything. */
export type PeriodProblem = 'reversed' | 'too_long' | null;

export interface ChosenPeriod {
  readonly from: string;
  readonly to: string;
  readonly problem: PeriodProblem;
  /** The words for the problem, or null. */
  readonly message: string | null;
}

const PERIOD_MESSAGES: Record<Exclude<PeriodProblem, null>, string> = {
  reversed: 'La fecha «Desde» es posterior a «Hasta». Corrige el periodo.',
  too_long: `El periodo puede abarcar como máximo ${MAX_PERIOD_DAYS} días. Acórtalo.`,
};

/** Whether a text is a real calendar date written `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

/**
 * The period of the `desde` and `hasta` address parameters: each one missing or not a real
 * `YYYY-MM-DD` date (a hand-edited address) falls back to the default period's bound.
 */
export function chosenPeriod(
  values: { readonly desde: string; readonly hasta: string },
  fallback: PilotPeriod = PHASE_3,
): ChosenPeriod {
  const from = isCalendarDate(values.desde) ? values.desde : fallback.from;
  const to = isCalendarDate(values.hasta) ? values.hasta : fallback.to;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const problem: PeriodProblem =
    from > to ? 'reversed' : days >= MAX_PERIOD_DAYS ? 'too_long' : null;
  return { from, to, problem, message: problem === null ? null : PERIOD_MESSAGES[problem] };
}
