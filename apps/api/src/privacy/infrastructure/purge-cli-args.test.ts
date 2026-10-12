import { describe, expect, it } from 'vitest';

import { parsePurgeArgs } from './purge-cli-args.js';

const NOW = new Date('2028-01-15T12:00:00Z');

describe('parsePurgeArgs', () => {
  it('runs with the default retention end, for real, without options', () => {
    expect(parsePurgeArgs([], NOW)).toEqual({
      status: 'run',
      date: '2027-12-20',
      cutoff: new Date('2027-12-20T05:00:00Z'),
      dryRun: false,
    });
  });

  it('passes --dry-run and --before through', () => {
    expect(parsePurgeArgs(['--before', '2027-06-30', '--dry-run'], NOW)).toEqual({
      status: 'run',
      date: '2027-06-30',
      cutoff: new Date('2027-06-30T05:00:00Z'),
      dryRun: true,
    });
  });

  it('refuses a cutoff after today, before anything touches the database', () => {
    const early = new Date('2026-11-01T12:00:00Z');

    const refused = parsePurgeArgs([], early);
    expect(refused.status).toBe('refused');
    expect(refused.status === 'refused' && refused.message).toMatch(/2027-12-20 is after today/);
    expect(parsePurgeArgs(['--before', '2028-01-16', '--dry-run'], NOW)).toMatchObject({
      status: 'refused',
    });
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(parsePurgeArgs(['--before', '20-12-2027'], NOW)).toEqual({
      status: 'refused',
      message: '--before must be a calendar date: YYYY-MM-DD.',
    });
  });

  it('refuses unknown options and stray arguments', () => {
    expect(parsePurgeArgs(['--force'], NOW)).toMatchObject({ status: 'refused' });
    expect(parsePurgeArgs(['2027-06-30'], NOW)).toMatchObject({ status: 'refused' });
  });
});
