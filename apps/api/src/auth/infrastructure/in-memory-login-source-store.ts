import type { LoginSourceStore } from '../application/auth-ports.js';
import { CLEAN_LOGIN_STATE, type LoginState } from '../domain/lockout-policy.js';

/** Keys kept at most; the least recently changed is forgotten first. */
const DEFAULT_CAPACITY = 10_000;

/**
 * Per-source login failures in process memory. Only real accounts are tracked (the key holds the
 * account id and the client network, both short), so the map is bounded in entries and in bytes,
 * and a clean state is not stored at all.
 */
export class InMemoryLoginSourceStore implements LoginSourceStore {
  private readonly states = new Map<string, LoginState>();

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  find(key: string): Promise<LoginState> {
    return Promise.resolve(this.states.get(key) ?? CLEAN_LOGIN_STATE);
  }

  modify<T extends LoginState>(key: string, change: (current: LoginState) => T): Promise<T> {
    const next = change(this.states.get(key) ?? CLEAN_LOGIN_STATE);
    this.states.delete(key);
    if (next.failedAttempts > 0 || next.lockedUntil !== null) {
      this.states.set(key, { failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil });
      if (this.states.size > this.capacity) {
        const oldest = this.states.keys().next().value;
        if (oldest !== undefined) this.states.delete(oldest);
      }
    }
    return Promise.resolve(next);
  }

  /** Keys currently tracked (tests). */
  get size(): number {
    return this.states.size;
  }
}
