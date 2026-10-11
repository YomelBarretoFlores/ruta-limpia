import type { AdoptionWeek } from './impact-indicators.js';

/**
 * One enrolled household in one week (America/Lima, Monday to Sunday, clipped to the requested
 * range): whether it used the system that week. Views without a household link and alerts to
 * subscriptions without one never count.
 */
export interface HouseholdWeek {
  /** `YYYY-MM-DD`, the Monday of the week. */
  readonly weekStart: string;
  readonly householdId: string;
  readonly householdCode: string;
  /** At least one app view linked to the household. */
  readonly viewed: boolean;
  /** At least one alert delivered (`sent`) to one of its subscriptions. */
  readonly alertSent: boolean;
  /** At least one of those alerts confirmed as received by the device. */
  readonly alertConfirmed: boolean;
}

/** The adoption rule: a view or a sent alert in the week. */
export function usedInWeek(week: HouseholdWeek): boolean {
  return week.viewed || week.alertSent;
}

/** The stricter rule: a view or a confirmed reception in the week. */
export function usedInWeekConfirmed(week: HouseholdWeek): boolean {
  return week.viewed || week.alertConfirmed;
}

/** Per-week counts, in week order, and the households active in at least one week. */
export function summarizeAdoption(rows: readonly HouseholdWeek[]): {
  readonly weeks: AdoptionWeek[];
  readonly activeHouseholdIds: string[];
} {
  const weeks = new Map<string, { enrolled: number; active: number; activeConfirmed: number }>();
  const active = new Set<string>();
  for (const row of rows) {
    const week = weeks.get(row.weekStart) ?? { enrolled: 0, active: 0, activeConfirmed: 0 };
    week.enrolled += 1;
    if (usedInWeek(row)) {
      week.active += 1;
      active.add(row.householdId);
    }
    if (usedInWeekConfirmed(row)) week.activeConfirmed += 1;
    weeks.set(row.weekStart, week);
  }
  return {
    weeks: [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, counts]) => ({ weekStart, ...counts })),
    activeHouseholdIds: [...active],
  };
}
