import { describe, expect, it } from 'vitest';

import { DEFAULT_RETENTION_END, resolveCutoff } from './retention-policy.js';

const NOW = new Date('2028-01-15T12:00:00Z');

describe('resolveCutoff', () => {
  it('defaults to 12 months after the pilot ends (20 December 2027), at Lima midnight', () => {
    expect(DEFAULT_RETENTION_END).toBe('2027-12-20');
    expect(resolveCutoff(undefined, NOW)).toEqual({
      status: 'ok',
      date: '2027-12-20',
      cutoff: new Date('2027-12-20T05:00:00Z'),
    });
  });

  it('takes an explicit calendar date', () => {
    expect(resolveCutoff('2027-06-30', NOW)).toMatchObject({
      status: 'ok',
      cutoff: new Date('2027-06-30T05:00:00Z'),
    });
  });

  it('refuses a date that is not a real YYYY-MM-DD calendar date', () => {
    for (const input of ['2027-02-30', '20-12-2027', '2027-12-20T00:00', '', 'yesterday']) {
      expect(resolveCutoff(input, NOW)).toEqual({ status: 'invalid_date' });
    }
  });

  it('refuses a cutoff after today, so live data are never purged by mistake', () => {
    expect(resolveCutoff(undefined, new Date('2026-11-01T12:00:00Z'))).toEqual({
      status: 'in_future',
      date: '2027-12-20',
    });
    expect(resolveCutoff('2028-01-16', NOW)).toEqual({ status: 'in_future', date: '2028-01-16' });
    expect(resolveCutoff('2028-01-15', NOW)).toMatchObject({ status: 'ok' });
  });
});
