import type { LoginSourceStore } from '../application/auth-ports.js';
import {
  CLEAN_SOURCE_LOGIN_STATE,
  isLocked,
  type SourceLoginState,
} from '../domain/lockout-policy.js';

/** Keys kept at most. */
const DEFAULT_CAPACITY = 10_000;

/**
 * Per-source login failures in process memory. Only real accounts are tracked (the key holds the
 * account id and the client network, both short), so the map is bounded in entries and in bytes,
 * and a clean state is not stored at all. Each `modify` runs synchronously, so it is atomic within
 * the process.
 *
 * When the map is full, the least recently changed entry that is neither a running pause nor
 * holding attempts being checked is forgotten: an attacker who floods the store with fresh
 * (account, network) pairs cannot push out a pause, or a burst's provisional failures, and get
 * that network's attempts back. When no entry can go, a new count is not kept until one can (the
 * per-account budget, stored with the user, still caps the guessing meanwhile).
 */
export class InMemoryLoginSourceStore implements LoginSourceStore {
  private readonly states = new Map<string, SourceLoginState>();

  constructor(
    private readonly now: () => Date,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {}

  find(key: string): Promise<SourceLoginState> {
    return Promise.resolve(this.states.get(key) ?? CLEAN_SOURCE_LOGIN_STATE);
  }

  modify<T extends SourceLoginState>(
    key: string,
    change: (current: SourceLoginState) => T,
  ): Promise<T> {
    const next = change(this.states.get(key) ?? CLEAN_SOURCE_LOGIN_STATE);
    this.states.delete(key);
    if (next.failedAttempts > 0 || next.lockedUntil !== null || next.inFlight > 0) {
      const { failedAttempts, lockedUntil, inFlight } = next;
      this.states.set(key, { failedAttempts, lockedUntil, inFlight });
      if (this.states.size > this.capacity) this.evictOne(key);
    }
    return Promise.resolve(next);
  }

  /** Keys currently tracked (tests). */
  get size(): number {
    return this.states.size;
  }

  /** Drops the oldest entry that may go, or else the one just written. */
  private evictOne(justWritten: string): void {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (!isLocked(state, now) && state.inFlight === 0) {
        this.states.delete(key);
        return;
      }
    }
    this.states.delete(justWritten);
  }
}
