import { describe, expect, it } from 'vitest';

import { formatLocalTime } from './time';

describe('formatLocalTime', () => {
  it('formats an instant as HH:MM in Lima time', () => {
    expect(formatLocalTime('2026-10-20T22:30:00Z')).toBe('17:30');
  });

  it('answers null for a missing, empty or malformed timestamp instead of throwing', () => {
    expect(formatLocalTime(null)).toBeNull();
    expect(formatLocalTime(undefined)).toBeNull();
    expect(formatLocalTime('')).toBeNull();
    expect(formatLocalTime('yesterday at noon')).toBeNull();
    expect(formatLocalTime('2026-13-45T99:99:99Z')).toBeNull();
  });
});
