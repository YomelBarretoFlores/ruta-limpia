import { describe, expect, it } from 'vitest';

import { classifyPushResponse, pushTopic, pushTtlSeconds } from './push-delivery.js';

describe('classifyPushResponse', () => {
  it.each([
    [201, 'sent'],
    [200, 'sent'],
    [202, 'sent'],
    [404, 'expired'],
    [410, 'expired'],
    [400, 'failed'],
    [413, 'failed'],
    [429, 'failed'],
    [500, 'failed'],
    [null, 'failed'],
  ] as const)('classifies HTTP %s as %s', (status, outcome) => {
    expect(classifyPushResponse(status)).toBe(outcome);
  });
});

describe('pushTtlSeconds', () => {
  it('keeps the message until the predicted pass, at least one minute', () => {
    expect(pushTtlSeconds(480)).toBe(480);
    expect(pushTtlSeconds(12)).toBe(60);
    expect(pushTtlSeconds(0)).toBe(60);
    expect(pushTtlSeconds(90, 120)).toBe(120);
  });
});

describe('pushTopic', () => {
  it('derives a URL-safe topic of at most 32 characters from the point code', () => {
    expect(pushTopic('P08')).toBe('ruta-limpia-P08');
    expect(pushTopic('P 08/ñ')).toBe('ruta-limpia-P_08__');
    expect(pushTopic('X'.repeat(40))).toHaveLength(32);
  });
});
