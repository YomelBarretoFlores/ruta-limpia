import { describe, expect, it } from 'vitest';

import {
  formatHouseholdCode,
  householdCodeSequence,
  householdStickerUrl,
  nextHouseholdCode,
} from './household-code.js';

describe('household codes', () => {
  it('formats sequences with at least three digits', () => {
    expect(formatHouseholdCode(1)).toBe('H-001');
    expect(formatHouseholdCode(42)).toBe('H-042');
    expect(formatHouseholdCode(1000)).toBe('H-1000');
    expect(() => formatHouseholdCode(0)).toThrow(RangeError);
  });

  it('reads the sequence of generated codes only', () => {
    expect(householdCodeSequence('H-007')).toBe(7);
    expect(householdCodeSequence('H-1000')).toBe(1000);
    expect(householdCodeSequence('H-07')).toBeNull();
    expect(householdCodeSequence('PILOT-1')).toBeNull();
  });

  it('continues after the highest sequence', () => {
    expect(nextHouseholdCode(null)).toBe('H-001');
    expect(nextHouseholdCode(99)).toBe('H-100');
  });

  it('builds the sticker deep link on the public origin', () => {
    expect(
      householdStickerUrl('https://rutalimpia.example.org/', {
        code: 'H-001',
        routeCode: 'RI-01',
        pointCode: 'P08',
      }),
    ).toBe('https://rutalimpia.example.org/?r=RI-01&p=P08&h=H-001');
  });
});
