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
 *
 * The spacing does not apply to an attempt from one of the account's known networks: a client
 * network from which the account signed in successfully within the last `knownNetworkDays`. An
 * attacker elsewhere who keeps the interval running therefore cannot starve the owner out. The
 * hard pause and the per-network pause apply to every network.
 */
export interface AccountThrottle {
  readonly freeAttempts: number;
  readonly maxIntervalSec: number;
  readonly maxFailures: number;
  readonly windowHours: number;
  readonly knownNetworkDays: number;
}

/**
 * Brute-force protection of the panel accounts, in two layers:
 *
 * - **per source**: consecutive failures against one account from one client network (an IPv4
 *   /24 or an IPv6 /64) pause that network's attempts on that account. An attacker who knows a
 *   username therefore cannot lock its owner out from another network;
 * - **per account**: throttling rather than a low hard lock. Attempts are spaced out after a few
 *   failures from any network except the account's known networks, and only a large count within
 *   a day pauses the account itself. Guessing stays slow and capped while a few failures cannot
 *   lock the owner out.
 *
 * A paused or throttled attempt gets the same answer as a wrong password (`invalid_credentials`),
 * after the same password-hashing work.
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
    knownNetworkDays: 30,
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

/**
 * The per-source state: the counted failures, the pause, and the attempts of that source whose
 * password check is still running (`inFlight`).
 */
export interface SourceLoginState extends LoginState {
  readonly inFlight: number;
}

export const CLEAN_SOURCE_LOGIN_STATE: SourceLoginState = Object.freeze({
  failedAttempts: 0,
  lockedUntil: null,
  inFlight: 0,
});

/**
 * Admits an attempt from one source (account and client network) to the password check, counting
 * every attempt still being checked as a provisional failure: a burst of simultaneous attempts
 * gets at most the source's remaining budget of password checks, never more. The caller settles
 * each admitted attempt with `settleSourceAttempt`.
 */
export function admitSourceAttempt(
  state: SourceLoginState,
  now: Date,
  threshold: LockoutThreshold,
): SourceLoginState & { readonly admitted: boolean } {
  const exhausted = state.failedAttempts + state.inFlight >= threshold.maxFailedAttempts;
  if (isLocked(state, now) || exhausted) return { ...state, admitted: false };
  return { ...state, inFlight: state.inFlight + 1, admitted: true };
}

/**
 * Settles an admitted attempt: a failure is counted (and may pause the source), a success clears
 * the failures unless a parallel attempt paused the source meanwhile, and an abandoned attempt
 * (its check never ran) only gives its provisional place back.
 */
export function settleSourceAttempt(
  state: SourceLoginState,
  now: Date,
  threshold: LockoutThreshold,
  outcome: 'failed' | 'succeeded' | 'abandoned',
): SourceLoginState & { readonly lockedNow: boolean } {
  const inFlight = Math.max(0, state.inFlight - 1);
  if (outcome === 'failed') return { ...registerFailedLogin(state, now, threshold), inFlight };
  if (outcome === 'succeeded' && !isLocked(state, now)) {
    return { ...registerSuccessfulLogin(), inFlight, lockedNow: false };
  }
  return { ...state, inFlight, lockedNow: false };
}

/** A successful login clears the failures and any expired lock. */
export function registerSuccessfulLogin(): LoginState {
  return CLEAN_LOGIN_STATE;
}

/**
 * The login state of an account. `failedAttempts` counts the consecutive failures of the current
 * 24 h window since the last successful sign-in (it drives the spacing): a successful sign-in, the
 * start of a new window and a pause all restart it. `windowFailures` counts every failure of the
 * current window (it drives the hard pause) and survives a successful sign-in, so an owner who
 * signs in during an attack does not hand the attacker a fresh daily budget. A window starts at
 * its first failure and lasts `windowHours`, so the cap of `maxFailures` per window holds whatever
 * the spacing count is.
 */
export interface AccountLoginState extends LoginState {
  readonly windowFailures: number;
  /**
   * The last attempt that was checked against the password: a counted failure, or an admitted
   * attempt (its slot is reserved before the check). The next spaced-out attempt must wait the
   * throttle interval after it.
   */
  readonly lastAttemptAt: Date | null;
  /** The first failure of the current window; null without failures. */
  readonly windowStartedAt: Date | null;
}

export const CLEAN_ACCOUNT_LOGIN_STATE: AccountLoginState = Object.freeze({
  failedAttempts: 0,
  windowFailures: 0,
  lockedUntil: null,
  lastAttemptAt: null,
  windowStartedAt: null,
});

/** The minimum interval, in seconds, after the `failedAttempts`-th consecutive failure. */
export function attemptIntervalSec(failedAttempts: number, throttle: AccountThrottle): number {
  if (failedAttempts < throttle.freeAttempts) return 0;
  return Math.min(2 ** (failedAttempts - throttle.freeAttempts), throttle.maxIntervalSec);
}

/** Whether an attempt now comes too early after the last checked attempt. */
export function isThrottled(state: AccountLoginState, now: Date, throttle: AccountThrottle) {
  const interval = attemptIntervalSec(state.failedAttempts, throttle);
  if (interval === 0 || state.lastAttemptAt === null) return false;
  return now.getTime() - state.lastAttemptAt.getTime() < interval * 1000;
}

/** The slot an admitted attempt took, so it can be given back if the check never ran. */
export interface AttemptReservation {
  readonly at: Date;
  /** The `lastAttemptAt` the reservation replaced. */
  readonly previous: Date | null;
}

/**
 * Admits an attempt to the password check, or refuses it, atomically with the stored state (the
 * caller runs it under the account's row lock, before any hashing). An admitted attempt while the
 * spacing applies reserves its slot (`lastAttemptAt = now`, returned as `reservation`), so
 * concurrent attempts arriving when an interval ends get at most one password check between them.
 * A paused account admits nothing and changes nothing.
 */
export function reserveAttempt(
  state: AccountLoginState,
  now: Date,
  throttle: AccountThrottle,
): AccountLoginState & {
  readonly admitted: boolean;
  readonly reservation: AttemptReservation | null;
} {
  if (isLocked(state, now) || isThrottled(state, now, throttle)) {
    return { ...state, admitted: false, reservation: null };
  }
  if (attemptIntervalSec(state.failedAttempts, throttle) === 0) {
    return { ...state, admitted: true, reservation: null };
  }
  return {
    ...state,
    lastAttemptAt: now,
    admitted: true,
    reservation: { at: now, previous: state.lastAttemptAt },
  };
}

/**
 * Gives back a reserved slot whose password check never ran (the hasher shed the request, for
 * instance), so a refused request does not use up the interval. Nothing changes when a later
 * failure or attempt has replaced the slot since.
 */
export function releaseAttempt(
  state: AccountLoginState,
  reservation: AttemptReservation,
): AccountLoginState {
  if (state.lastAttemptAt?.getTime() !== reservation.at.getTime()) return state;
  return { ...state, lastAttemptAt: reservation.previous };
}

/**
 * A wrong password against the account: counts it in the current window (a new window starts
 * when the last one is over); at `maxFailures` failures in the window the account is paused until
 * the window ends. A failure while paused changes nothing. `throttledNow` marks the failure that
 * starts the spacing-out.
 */
export function registerAccountFailure(
  state: AccountLoginState,
  now: Date,
  throttle: AccountThrottle,
): AccountLoginState & { readonly lockedNow: boolean; readonly throttledNow: boolean } {
  if (isLocked(state, now)) return { ...state, lockedNow: false, throttledNow: false };
  const windowMs = throttle.windowHours * 3_600_000;
  const currentWindow =
    state.windowStartedAt !== null && now.getTime() - state.windowStartedAt.getTime() < windowMs
      ? state.windowStartedAt
      : null;
  const windowStartedAt = currentWindow ?? now;
  const windowFailures = (currentWindow === null ? 0 : state.windowFailures) + 1;
  const failedAttempts = (currentWindow === null ? 0 : state.failedAttempts) + 1;
  if (windowFailures >= throttle.maxFailures) {
    return {
      ...CLEAN_ACCOUNT_LOGIN_STATE,
      lockedUntil: new Date(windowStartedAt.getTime() + windowMs),
      lockedNow: true,
      throttledNow: false,
    };
  }
  return {
    failedAttempts,
    windowFailures,
    lockedUntil: null,
    lastAttemptAt: now,
    windowStartedAt,
    lockedNow: false,
    throttledNow: failedAttempts === throttle.freeAttempts,
  };
}

/**
 * A successful sign-in: ends the spacing (the consecutive failures and the last attempt) but keeps
 * the failures of the current window, so the daily cap still holds. A paused account stays paused.
 */
export function registerAccountSuccess(state: AccountLoginState, now: Date): AccountLoginState {
  if (isLocked(state, now)) return state;
  return { ...state, failedAttempts: 0, lockedUntil: null, lastAttemptAt: null };
}

/** The oldest successful sign-in that still makes its network a known network of the account. */
export function knownNetworkCutoff(now: Date, throttle: AccountThrottle): Date {
  return new Date(now.getTime() - throttle.knownNetworkDays * 86_400_000);
}
