/** Brute-force protection of one account: consecutive failures lock it for a while. */
export interface LockoutPolicy {
  readonly maxFailedAttempts: number;
  readonly lockoutMinutes: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = Object.freeze({
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
});

/** The login-related state of an account. */
export interface LoginState {
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

export function isLocked(state: LoginState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * A wrong password: counts the failure and, at the limit, locks the account and restarts the
 * count. A failure while locked changes nothing (the lock is not extended by the attacker).
 */
export function registerFailedLogin(
  state: LoginState,
  now: Date,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): LoginState & { readonly lockedNow: boolean } {
  if (isLocked(state, now)) return { ...state, lockedNow: false };
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= policy.maxFailedAttempts) {
    return {
      failedAttempts: 0,
      lockedUntil: new Date(now.getTime() + policy.lockoutMinutes * 60_000),
      lockedNow: true,
    };
  }
  return { failedAttempts, lockedUntil: null, lockedNow: false };
}

/** A successful login clears the failures and any expired lock. */
export function registerSuccessfulLogin(): LoginState {
  return { failedAttempts: 0, lockedUntil: null };
}
