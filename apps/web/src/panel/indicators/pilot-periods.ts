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
