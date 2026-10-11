import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { PasswordHasherBusyError, type PasswordHasher } from '../application/auth-ports.js';

/** scrypt cost parameters; `logN` is log2 of the CPU/memory cost N. */
export interface ScryptParams {
  readonly logN: number;
  readonly r: number;
  readonly p: number;
}

/** OWASP Password Storage recommendation: N=2^17, r=8, p=1 (about 128 MiB per hash). */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = Object.freeze({ logN: 17, r: 8, p: 1 });

/**
 * Hashes computed at the same time. Each one holds about 128 MiB (at the default parameters) and
 * one libuv threadpool thread for its whole run, so two keep the peak at about 256 MiB on the 2 GB
 * host and leave two of the four default threadpool threads to DNS, file and other crypto work.
 */
export const DEFAULT_MAX_CONCURRENT_HASHES = 2;
/** Hashes allowed to wait for a slot; beyond this the request is shed at once. */
export const DEFAULT_MAX_QUEUED_HASHES = 16;
/** The longest a hash waits for a slot before it is shed. */
export const DEFAULT_MAX_HASH_WAIT_MS = 5_000;

/**
 * OpenSSL allocates scrypt's work area as 128·r·(N+2) bytes plus 128·r·p, which is 256·r bytes
 * more than the textbook 128·N·r + 128·r·p. One MiB of headroom covers that difference and any
 * small internal buffer, so a valid stored hash is never refused for memory.
 */
const MAXMEM_HEADROOM_BYTES = 1024 * 1024;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Bounds accepted when decoding a stored hash, so a corrupt row cannot request absurd work. */
const LIMITS = { logN: [10, 20], r: [1, 32], p: [1, 16], keyBytes: [32, 128] } as const;

/** `$scrypt$ln=17,r=8,p=1$<salt>$<key>` (PHC string format, base64 without padding). */
const ENCODED =
  /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** The key derivation function (Node's scrypt; tests substitute a controllable one). */
export type KeyDerivation = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer>;

export interface ScryptPasswordHasherOptions {
  /** Parameters of new hashes. Lower them only in tests. */
  readonly params?: ScryptParams;
  /** Hashes computed at the same time; each takes 128·N·r bytes of memory. */
  readonly maxConcurrent?: number;
  /** Hashes allowed to wait for a slot before new ones are refused. */
  readonly maxQueued?: number;
  /** How long a hash may wait for a slot before it is refused. */
  readonly maxWaitMs?: number;
  readonly kdf?: KeyDerivation;
}

interface Waiter {
  grant(): void;
}

/**
 * Password hashing with Node's built-in scrypt (no native dependency). The parameters, salt and
 * key are encoded in the hash, so stored hashes stay verifiable after the defaults change. The
 * comparison is constant-time.
 *
 * A semaphore bounds the memory and threadpool use of parallel logins, and its wait queue is
 * bounded in length and in time: under a burst of logins, extra requests fail fast with
 * `PasswordHasherBusyError` instead of making every later login wait longer and longer.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly params: ScryptParams;
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly maxWaitMs: number;
  private readonly kdf: KeyDerivation;
  private running = 0;
  private readonly waiting: Waiter[] = [];
  private dummyHash: Promise<string> | null = null;

  constructor(options: ScryptPasswordHasherOptions = {}) {
    this.params = options.params ?? DEFAULT_SCRYPT_PARAMS;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_HASHES;
    this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED_HASHES;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_HASH_WAIT_MS;
    this.kdf = options.kdf ?? scryptAsync;
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
    await this.verify(password, await this.dummy());
  }

  /** The throwaway hash, computed once; a failed attempt is forgotten so the next call retries. */
  private dummy(): Promise<string> {
    if (this.dummyHash === null) {
      const pending = this.hash(randomBytes(24).toString('base64url'));
      this.dummyHash = pending;
      pending.catch(() => {
        if (this.dummyHash === pending) this.dummyHash = null;
      });
    }
    return this.dummyHash;
  }

  private async derive(
    password: string,
    salt: Buffer,
    keyLength: number,
    params: ScryptParams,
  ): Promise<Buffer> {
    await this.acquire();
    try {
      return await this.kdf(password.normalize('NFC'), salt, keyLength, {
        N: 2 ** params.logN,
        r: params.r,
        p: params.p,
        // Node's default cap (32 MiB) is too low for N=2^17.
        maxmem:
          128 * 2 ** params.logN * params.r + 128 * params.r * params.p + MAXMEM_HEADROOM_BYTES,
      });
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(new PasswordHasherBusyError('queue_full'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new PasswordHasherBusyError('wait_timeout'));
      }, this.maxWaitMs);
      timer.unref();
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      this.waiting.push(waiter);
    });
  }

  private release(): void {
    // The releasing caller hands its slot over, so `running` stays unchanged.
    const next = this.waiting.shift();
    if (next === undefined) this.running -= 1;
    else next.grant();
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
