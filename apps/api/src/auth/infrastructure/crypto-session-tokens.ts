import { createHash, randomBytes } from 'node:crypto';

import type { SessionTokens } from '../application/auth-ports.js';

/**
 * 256-bit random session tokens (base64url). Only their SHA-256 digest is stored, so a database
 * leak does not reveal usable session cookies. Lookups are by digest, which needs no constant-time
 * comparison: an attacker cannot steer the digest of a guessed token.
 */
export class CryptoSessionTokens implements SessionTokens {
  generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
