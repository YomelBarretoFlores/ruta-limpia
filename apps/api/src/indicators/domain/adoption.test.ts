import { describe, expect, it } from 'vitest';

import { summarizeAdoption, type HouseholdWeek } from './adoption.js';

function week(weekStart: string, householdId: string, use: Partial<HouseholdWeek>): HouseholdWeek {
  return {
    weekStart,
    householdId,
    householdCode: householdId.toUpperCase(),
    viewed: false,
    alertSent: false,
    alertConfirmed: false,
    ...use,
  };
}

describe('summarizeAdoption', () => {
  it('counts enrolled and active households per week, and who was active in any week', () => {
    const summary = summarizeAdoption([
      week('2026-11-23', 'h1', { alertSent: true }),
      week('2026-11-16', 'h1', { viewed: true }),
      week('2026-11-16', 'h2', { alertSent: true, alertConfirmed: true }),
      week('2026-11-16', 'h3', {}),
      week('2026-11-23', 'h2', {}),
      week('2026-11-23', 'h3', {}),
    ]);

    expect(summary.weeks).toEqual([
      { weekStart: '2026-11-16', enrolled: 3, active: 2, activeConfirmed: 2 },
      { weekStart: '2026-11-23', enrolled: 3, active: 1, activeConfirmed: 0 },
    ]);
    expect(summary.activeHouseholdIds.sort()).toEqual(['h1', 'h2']);
  });
});
