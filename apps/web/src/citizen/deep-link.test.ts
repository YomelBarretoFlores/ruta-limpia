import { describe, expect, it } from 'vitest';

import { parseDeepLink } from './deep-link';
import { EMPTY_PREFERENCES, loadPreferences, mergeDeepLink, savePreferences } from './preferences';

describe('parseDeepLink', () => {
  it('reads the route, point and household of the QR sticker', () => {
    expect(parseDeepLink('?r=RI-01&p=P08&h=H-001')).toEqual({
      routeCode: 'RI-01',
      pointCode: 'P08',
      householdCode: 'H-001',
    });
  });

  it('upper-cases codes and treats every part as optional', () => {
    expect(parseDeepLink('?p=p08')).toEqual({
      routeCode: null,
      pointCode: 'P08',
      householdCode: null,
    });
    expect(parseDeepLink('')).toEqual({ routeCode: null, pointCode: null, householdCode: null });
  });

  it('ignores malformed values', () => {
    expect(parseDeepLink('?r=RI 01&p=<script>&h=' + 'H'.repeat(21))).toEqual({
      routeCode: null,
      pointCode: null,
      householdCode: null,
    });
  });
});

describe('preferences', () => {
  it('lets the deep link win part by part', () => {
    const saved = { routeCode: 'RI-01', pointCode: 'P03', householdCode: 'H-009' };

    expect(
      mergeDeepLink(saved, { routeCode: null, pointCode: 'P08', householdCode: null }),
    ).toEqual({ routeCode: 'RI-01', pointCode: 'P08', householdCode: 'H-009' });
  });

  it('drops the saved point when the link names another route without a point', () => {
    const saved = { routeCode: 'RI-01', pointCode: 'P03', householdCode: null };

    expect(
      mergeDeepLink(saved, { routeCode: 'HZ-02', pointCode: null, householdCode: null }),
    ).toEqual({ routeCode: 'HZ-02', pointCode: null, householdCode: null });
  });

  it('round-trips through storage and reads broken storage as empty', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    const preferences = { routeCode: 'RI-01', pointCode: 'P08', householdCode: null };

    savePreferences(storage, preferences);

    expect(loadPreferences(storage)).toEqual(preferences);
    expect(
      loadPreferences({
        getItem: () => {
          throw new Error('SecurityError');
        },
      }),
    ).toEqual(EMPTY_PREFERENCES);
    expect(loadPreferences({ getItem: () => '{not json' })).toEqual(EMPTY_PREFERENCES);
  });
});
