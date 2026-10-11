import { describe, expect, it } from 'vitest';

import { isStale } from './staleness.js';

describe('isStale', () => {
  const lastFixAt = new Date('2026-10-20T07:00:00Z');

  it('is fresh up to 60 s after the last fix', () => {
    expect(isStale(lastFixAt, new Date('2026-10-20T07:01:00Z'))).toBe(false);
  });

  it('is stale once the last fix is older than 60 s', () => {
    expect(isStale(lastFixAt, new Date('2026-10-20T07:01:00.001Z'))).toBe(true);
  });

  it('is stale when no fix was ever received', () => {
    expect(isStale(null, lastFixAt)).toBe(true);
  });

  it('accepts a custom maximum age', () => {
    expect(isStale(lastFixAt, new Date('2026-10-20T07:00:31Z'), 30)).toBe(true);
  });
});
