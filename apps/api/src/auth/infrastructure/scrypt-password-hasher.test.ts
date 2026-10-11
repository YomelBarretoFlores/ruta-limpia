import { describe, expect, it } from 'vitest';

import { CryptoSessionTokens } from './crypto-session-tokens.js';
import { decode, DEFAULT_SCRYPT_PARAMS, ScryptPasswordHasher } from './scrypt-password-hasher.js';

/** Cheap parameters keep the suite fast; one test exercises the production defaults. */
const fast = new ScryptPasswordHasher({ params: { logN: 10, r: 8, p: 1 } });

describe('ScryptPasswordHasher', () => {
  it('hashes with the OWASP defaults and encodes the parameters, salt and key', async () => {
    const hasher = new ScryptPasswordHasher();
    const hash = await hasher.hash('correct horse battery');

    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ logN: 17, r: 8, p: 1 });
    expect(hash).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{86}$/);
    const decoded = decode(hash);
    expect(decoded?.salt).toHaveLength(16);
    expect(decoded?.key).toHaveLength(64);
    await expect(hasher.verify('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await fast.hash('correct horse battery');

    await expect(fast.verify('correct horse batterz', hash)).resolves.toBe(false);
    await expect(fast.verify('', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([fast.hash('same password!'), fast.hash('same password!')]);

    expect(a).not.toBe(b);
  });

  it('verifies with the parameters stored in the hash, not the current defaults', async () => {
    const old = await new ScryptPasswordHasher({ params: { logN: 11, r: 4, p: 2 } }).hash(
      'legacy passphrase',
    );

    expect(old).toMatch(/^\$scrypt\$ln=11,r=4,p=2\$/);
    await expect(fast.verify('legacy passphrase', old)).resolves.toBe(true);
  });

  it('treats malformed or out-of-bounds hashes as a mismatch', async () => {
    const hash = await fast.hash('correct horse battery');

    await expect(fast.verify('correct horse battery', 'plain-text')).resolves.toBe(false);
    await expect(
      fast.verify('correct horse battery', hash.replace('ln=10', 'ln=30')),
    ).resolves.toBe(false);
    expect(decode(hash.replace(/\$[^$]+$/, '$AAAA'))).toBeNull();
  });

  it('normalizes Unicode so a passphrase typed on another keyboard still matches', async () => {
    const hash = await fast.hash('contraseña segura');

    await expect(fast.verify('contraseña segura', hash)).resolves.toBe(true);
  });

  it('burns verification work for unknown users without failing', async () => {
    await expect(fast.verifyDummy('whatever password')).resolves.toBeUndefined();
  });

  it('bounds parallel hashing and still completes every request', async () => {
    const limited = new ScryptPasswordHasher({
      params: { logN: 10, r: 8, p: 1 },
      maxConcurrent: 1,
    });
    const hashes = await Promise.all(
      ['one password 1', 'two password 2', 'three password'].map((p) => limited.hash(p)),
    );

    await expect(limited.verify('two password 2', hashes[1] ?? '')).resolves.toBe(true);
  });
});

describe('CryptoSessionTokens', () => {
  it('issues 256-bit tokens and stores only their SHA-256 digest', () => {
    const tokens = new CryptoSessionTokens();
    const { token, hash } = tokens.generate();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.hash(token)).toBe(hash);
    expect(tokens.generate().token).not.toBe(token);
  });
});
