import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ManagementTokens } from '../application/subscription-ports.js';

/** 256-bit random tokens (base64url), stored as their SHA-256 hex digest. */
export class CryptoManagementTokens implements ManagementTokens {
  issue(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256Hex(token) };
  }

  matches(token: string, hash: string): boolean {
    const expected = Buffer.from(hash, 'hex');
    const actual = Buffer.from(sha256Hex(token), 'hex');
    // Both are SHA-256 digests, so the lengths only differ for a corrupt stored hash.
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
