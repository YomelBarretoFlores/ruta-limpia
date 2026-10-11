import { describe, expect, it } from 'vitest';

import {
  formatCalendarDate,
  formatDateTime,
  formatAge,
  formatDuration,
  fromLocalDateTimeInput,
  localToday,
  minutesBetween,
  toLocalDateTimeInput,
} from './format';

describe('panel formats', () => {
  it('shows instants in Lima time and dashes for missing values', () => {
    expect(formatDateTime('2026-10-20T22:30:00.000Z')).toBe('20/10/2026 17:30');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('nonsense')).toBe('—');
    expect(formatCalendarDate('2026-10-20')).toBe('20/10/2026');
    expect(formatCalendarDate(null)).toBe('—');
  });

  it('writes durations in words people read at a glance', () => {
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(40)).toBe('40 s');
    expect(formatDuration(null)).toBe('—');
  });

  it('computes the minutes between two times of day, and today in Lima', () => {
    expect(minutesBetween('06:40', '07:55')).toBe(75);
    expect(minutesBetween('07:55', '06:40')).toBe(-75);
    expect(minutesBetween('7:5', '07:55')).toBeNull();
    expect(minutesBetween(null, '07:55')).toBeNull();
    // 02:00 UTC is still the previous day in Lima (UTC-5).
    expect(localToday(Date.parse('2026-10-21T02:00:00Z'))).toBe('2026-10-20');
  });

  it('reads and writes datetime-local values in Lima time, and says how old a time is', () => {
    const now = Date.parse('2026-10-20T22:30:00.000Z');
    expect(toLocalDateTimeInput(now)).toBe('2026-10-20T17:30');
    expect(fromLocalDateTimeInput('2026-10-20T17:30')).toBe('2026-10-20T17:30:00-05:00');
    expect(fromLocalDateTimeInput('20/10/2026')).toBeNull();
    expect(formatAge('2026-10-20T22:27:40.000Z', now)).toBe('hace 2 min');
    expect(formatAge('2026-10-20T22:29:40.000Z', now)).toBe('hace menos de 1 min');
    expect(formatAge('2026-10-20T21:20:00.000Z', now)).toBe('hace 1 h 10 min');
    expect(formatAge(null, now)).toBeNull();
  });
});
