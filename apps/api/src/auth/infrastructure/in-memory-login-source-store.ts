import type { LoginSourceStore } from '../application/auth-ports.js';
import { CLEAN_LOGIN_STATE, isLocked, type LoginState } from '../domain/lockout-policy.js';

/** Keys kept at most. */
const DEFAULT_CAPACITY = 10_000;

/**
 * Per-source login failures in process memory. Only real accounts are tracked (the key holds the
 * account id and the client network, both short), so the map is bounded in entries and in bytes,
 * and a clean state is not stored at all.
 *
 * When the map is full, the least recently changed entry that is not a running pause is
 * forgotten: an attacker who floods the store with fresh (account, network) pairs cannot push out
 * a pause and get that network's attempts back. When every entry is a running pause, a new count
 * is not kept until one of them ends (the per-account budget, stored with the user, still caps
 * the guessing meanwhile).
 */
export class InMemoryLoginSourceStore implements LoginSourceStore {
  private readonly states = new Map<string, LoginState>();

  constructor(
    private readonly now: () => Date,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {}

  find(key: string): Promise<LoginState> {
    return Promise.resolve(this.states.get(key) ?? CLEAN_LOGIN_STATE);
  }

  modify<T extends LoginState>(key: string, change: (current: LoginState) => T): Promise<T> {
    const next = change(this.states.get(key) ?? CLEAN_LOGIN_STATE);
    this.states.delete(key);
    if (next.failedAttempts > 0 || next.lockedUntil !== null) {
      this.states.set(key, { failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil });
      if (this.states.size > this.capacity) this.evictOne(key);
    }
    return Promise.resolve(next);
  }

  /** Keys currently tracked (tests). */
  get size(): number {
    return this.states.size;
  }

  /** Drops the oldest entry that is not a running pause, or else the one just written. */
  private evictOne(justWritten: string): void {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (!isLocked(state, now)) {
        this.states.delete(key);
        return;
      }
    }
    this.states.delete(justWritten);
  }
}
