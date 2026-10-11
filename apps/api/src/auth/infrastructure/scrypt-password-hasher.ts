import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import type { PasswordHasher } from '../application/auth-ports.js';

/** scrypt cost parameters; `logN` is log2 of the CPU/memory cost N. */
export interface ScryptParams {
  readonly logN: number;
  readonly r: number;
  readonly p: number;
}

/** OWASP Password Storage recommendation: N=2^17, r=8, p=1 (about 128 MiB per hash). */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = Object.freeze({ logN: 17, r: 8, p: 1 });

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Bounds accepted when decoding a stored hash, so a corrupt row cannot request absurd work. */
const LIMITS = { logN: [10, 20], r: [1, 32], p: [1, 16], keyBytes: [32, 128] } as const;

/** `$scrypt$ln=17,r=8,p=1$<salt>$<key>` (PHC string format, base64 without padding). */
const ENCODED =
  /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export interface ScryptPasswordHasherOptions {
  /** Parameters of new hashes. Lower them only in tests. */
  readonly params?: ScryptParams;
  /** Hashes computed at the same time; each takes 128·N·r bytes of memory. */
  readonly maxConcurrent?: number;
}

/**
 * Password hashing with Node's built-in scrypt (no native dependency). The parameters, salt and
 * key are encoded in the hash, so stored hashes stay verifiable after the defaults change. The
 * comparison is constant-time, and a small semaphore bounds the memory used by parallel logins.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly params: ScryptParams;
  private readonly maxConcurrent: number;
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private dummyHash: Promise<string> | null = null;

  constructor(options: ScryptPasswordHasherOptions = {}) {
    this.params = options.params ?? DEFAULT_SCRYPT_PARAMS;
    this.maxConcurrent = options.maxConcurrent ?? 2;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.derive(password, salt, KEY_BYTES, this.params);
    const { logN, r, p } = this.params;
    return `$scrypt$ln=${logN},r=${r},p=${p}$${unpadded(salt)}$${unpadded(key)}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const decoded = decode(encodedHash);
    if (decoded === null) return false;
    const key = await this.derive(password, decoded.salt, decoded.key.length, decoded.params);
    return timingSafeEqual(key, decoded.key);
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(24).toString('base64url'));
    await this.verify(password, await this.dummyHash);
  }

  private async derive(
    password: string,
    salt: Buffer,
    keyLength: number,
    params: ScryptParams,
  ): Promise<Buffer> {
    await this.acquire();
    try {
      return await scryptAsync(password.normalize('NFC'), salt, keyLength, {
        N: 2 ** params.logN,
        r: params.r,
        p: params.p,
        // scrypt needs 128·N·r bytes (plus 128·r·p); Node's default cap (32 MiB) is too low.
        maxmem: 128 * 2 ** params.logN * params.r + 128 * params.r * params.p + 1024 * 1024,
      });
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return;
    }
    // The releasing caller hands its slot over, so `running` stays unchanged.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) this.running -= 1;
    else next();
  }
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

function unpadded(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

function inRange(value: number, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Decodes a stored hash; null when it is malformed or outside the accepted bounds. */
export function decode(
  encoded: string,
): { readonly params: ScryptParams; readonly salt: Buffer; readonly key: Buffer } | null {
  const match = ENCODED.exec(encoded);
  if (match === null) return null;
  const [, logN, r, p, salt, key] = match;
  const params = { logN: Number(logN), r: Number(r), p: Number(p) };
  const saltBytes = Buffer.from(salt ?? '', 'base64');
  const keyBytes = Buffer.from(key ?? '', 'base64');
  const valid =
    inRange(params.logN, LIMITS.logN) &&
    inRange(params.r, LIMITS.r) &&
    inRange(params.p, LIMITS.p) &&
    inRange(keyBytes.length, LIMITS.keyBytes) &&
    saltBytes.length >= SALT_BYTES;
  return valid ? { params, salt: saltBytes, key: keyBytes } : null;
}
