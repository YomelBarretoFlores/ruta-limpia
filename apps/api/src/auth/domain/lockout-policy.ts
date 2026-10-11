/** When repeated failures pause sign-in, and for how long. */
export interface LockoutThreshold {
  readonly maxFailedAttempts: number;
  readonly lockoutMinutes: number;
}

/**
 * Brute-force protection of the panel accounts, in two layers:
 *
 * - **per source**: consecutive failures against one account from one client network (an IPv4
 *   /24 or an IPv6 /64) pause that network's attempts on that account. An attacker who knows a
 *   username therefore cannot lock its owner out from another network;
 * - **per account**: a much higher count of consecutive failures from any network pauses the
 *   account itself, which caps distributed guessing.
 *
 * A paused attempt gets the same answer as a wrong password (`invalid_credentials`), so pausing
 * never reveals whether a username exists.
 */
export interface LockoutPolicy {
  readonly perSource: LockoutThreshold;
  readonly perAccount: LockoutThreshold;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = Object.freeze({
  perSource: Object.freeze({ maxFailedAttempts: 5, lockoutMinutes: 15 }),
  perAccount: Object.freeze({ maxFailedAttempts: 50, lockoutMinutes: 15 }),
});

/** The login-related state of an account, or of one (account, client network) pair. */
export interface LoginState {
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

export const CLEAN_LOGIN_STATE: LoginState = Object.freeze({
  failedAttempts: 0,
  lockedUntil: null,
});

export function isLocked(state: LoginState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * A wrong password: counts the failure and, at the threshold, locks and restarts the count. A
 * failure while locked changes nothing (the lock is not extended by the attacker).
 */
export function registerFailedLogin(
  state: LoginState,
  now: Date,
  threshold: LockoutThreshold = DEFAULT_LOCKOUT_POLICY.perSource,
): LoginState & { readonly lockedNow: boolean } {
  if (isLocked(state, now)) return { ...state, lockedNow: false };
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= threshold.maxFailedAttempts) {
    return {
      failedAttempts: 0,
      lockedUntil: new Date(now.getTime() + threshold.lockoutMinutes * 60_000),
      lockedNow: true,
    };
  }
  return { failedAttempts, lockedUntil: null, lockedNow: false };
}

/** A successful login clears the failures and any expired lock. */
export function registerSuccessfulLogin(): LoginState {
  return CLEAN_LOGIN_STATE;
}
