import { describe, expect, it } from 'vitest';

import {
  formatCalendarDate,
  formatDateTime,
  formatDuration,
  localToday,
  minutesBetween,
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
});
