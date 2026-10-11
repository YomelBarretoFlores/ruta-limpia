/** When repeated failures pause sign-in, and for how long. */
export interface LockoutThreshold {
  readonly maxFailedAttempts: number;
  readonly lockoutMinutes: number;
}

/**
 * Per-account guessing limits, after NIST SP 800-63B (5.2.2, rate limiting): the first
 * `freeAttempts` consecutive failures are free; after that, attempts must be spaced out by an
 * interval that doubles with each failure (`2^(n - freeAttempts)` seconds, at most
 * `maxIntervalSec`); `maxFailures` failures within `windowHours` pause the account until that
 * window ends.
 */
export interface AccountThrottle {
  readonly freeAttempts: number;
  readonly maxIntervalSec: number;
  readonly maxFailures: number;
  readonly windowHours: number;
}

/**
 * Brute-force protection of the panel accounts, in two layers:
 *
 * - **per source**: consecutive failures against one account from one client network (an IPv4
 *   /24 or an IPv6 /64) pause that network's attempts on that account. An attacker who knows a
 *   username therefore cannot lock its owner out from another network;
 * - **per account**: throttling rather than a low hard lock. Attempts are spaced out after a few
 *   failures from any network, and only a large count within a day pauses the account itself.
 *   Guessing stays slow and capped while a few failures cannot lock the owner out.
 *
 * A paused or throttled attempt gets the same answer as a wrong password (`invalid_credentials`).
 */
export interface LockoutPolicy {
  readonly perSource: LockoutThreshold;
  readonly perAccount: AccountThrottle;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = Object.freeze({
  perSource: Object.freeze({ maxFailedAttempts: 5, lockoutMinutes: 15 }),
  perAccount: Object.freeze({
    freeAttempts: 10,
    maxIntervalSec: 60,
    maxFailures: 100,
    windowHours: 24,
  }),
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
 * failure while locked changes nothing (the lock is not extended by the attacker). The threshold
 * is required: each call names the layer (per source or per account) it counts for.
 */
export function registerFailedLogin(
  state: LoginState,
  now: Date,
  threshold: LockoutThreshold,
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

/** The login state of an account: the consecutive failures of the current 24 h window. */
export interface AccountLoginState extends LoginState {
  /** The last counted failure: the next attempt must wait the throttle interval after it. */
  readonly lastFailedAt: Date | null;
  /** The first failure of the current window; null without failures. */
  readonly windowStartedAt: Date | null;
}

export const CLEAN_ACCOUNT_LOGIN_STATE: AccountLoginState = Object.freeze({
  failedAttempts: 0,
  lockedUntil: null,
  lastFailedAt: null,
  windowStartedAt: null,
});

/** The minimum interval, in seconds, after the `failedAttempts`-th consecutive failure. */
export function attemptIntervalSec(failedAttempts: number, throttle: AccountThrottle): number {
  if (failedAttempts < throttle.freeAttempts) return 0;
  return Math.min(2 ** (failedAttempts - throttle.freeAttempts), throttle.maxIntervalSec);
}

/** Whether an attempt now comes too early after the last failure (it is refused unchecked). */
export function isThrottled(state: AccountLoginState, now: Date, throttle: AccountThrottle) {
  const interval = attemptIntervalSec(state.failedAttempts, throttle);
  if (interval === 0 || state.lastFailedAt === null) return false;
  return now.getTime() - state.lastFailedAt.getTime() < interval * 1000;
}

/**
 * A wrong password against the account: counts it in the current window (a new window starts
 * when the last one is over); at `maxFailures` the account is paused until the window ends. A
 * failure while paused changes nothing. `throttledNow` marks the failure that starts the
 * spacing-out.
 */
export function registerAccountFailure(
  state: AccountLoginState,
  now: Date,
  throttle: AccountThrottle,
): AccountLoginState & { readonly lockedNow: boolean; readonly throttledNow: boolean } {
  if (isLocked(state, now)) return { ...state, lockedNow: false, throttledNow: false };
  const windowMs = throttle.windowHours * 3_600_000;
  const windowOver =
    state.windowStartedAt === null || now.getTime() - state.windowStartedAt.getTime() >= windowMs;
  const windowStartedAt = windowOver ? now : (state.windowStartedAt ?? now);
  const failedAttempts = (windowOver ? 0 : state.failedAttempts) + 1;
  if (failedAttempts >= throttle.maxFailures) {
    return {
      ...CLEAN_ACCOUNT_LOGIN_STATE,
      lockedUntil: new Date(windowStartedAt.getTime() + windowMs),
      lockedNow: true,
      throttledNow: false,
    };
  }
  return {
    failedAttempts,
    lockedUntil: null,
    lastFailedAt: now,
    windowStartedAt,
    lockedNow: false,
    throttledNow: failedAttempts === throttle.freeAttempts,
  };
}
