import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { CryptoManagementTokens } from './crypto-management-tokens.js';

describe('CryptoManagementTokens', () => {
  const tokens = new CryptoManagementTokens();

  it('issues distinct 256-bit base64url tokens stored as their SHA-256 hex digest', () => {
    const a = tokens.issue();
    const b = tokens.issue();

    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(createHash('sha256').update(a.token).digest('hex'));
    expect(a.hash).not.toContain(a.token);
  });

  it('matches only the token that produced the hash', () => {
    const { token, hash } = tokens.issue();

    expect(tokens.matches(token, hash)).toBe(true);
    expect(tokens.matches(`${token}x`, hash)).toBe(false);
    expect(tokens.matches('', hash)).toBe(false);
    expect(tokens.matches(token, 'not-a-hash')).toBe(false);
  });
});
