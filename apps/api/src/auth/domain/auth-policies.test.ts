import { describe, expect, it } from 'vitest';

import {
  isValidUsername,
  loginPassword,
  loginUsername,
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_UTF16_UNITS,
  passwordProblem,
} from './credentials.js';
import { checkCsrf, CSRF_HEADER_VALUE, isMutatingMethod } from './csrf-policy.js';
import {
  attemptIntervalSec,
  CLEAN_ACCOUNT_LOGIN_STATE,
  DEFAULT_LOCKOUT_POLICY,
  isLocked,
  isThrottled,
  registerAccountFailure,
  registerFailedLogin,
  registerSuccessfulLogin,
  type AccountLoginState,
} from './lockout-policy.js';
import { can, isRole, permissionsOf, PERMISSIONS } from './role.js';
import {
  classifyUserAgent,
  openSession,
  remainingLifetimeSec,
  sessionStatus,
  shouldTouch,
  type SessionPolicy,
} from './session-policy.js';

const T0 = new Date('2026-10-20T12:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe('role matrix', () => {
  it('gives the admin every permission', () => {
    expect(permissionsOf('admin')).toEqual([...PERMISSIONS]);
  });

  it('lets a supervisor run operations but not manage users or delete households', () => {
    for (const permission of [
      'live:read',
      'vehicles:read',
      'trips:write',
      'incidents:update',
      'households:write',
      'field:write_all',
    ] as const) {
      expect(can('supervisor', permission)).toBe(true);
    }
    expect(can('supervisor', 'users:manage')).toBe(false);
    expect(can('supervisor', 'households:delete')).toBe(false);
  });

  it('limits an observer to the live view, new incidents and their own field records', () => {
    expect(permissionsOf('observer')).toEqual([
      'live:read',
      'incidents:create',
      'field:read_own',
      'field:write_own',
    ]);
    expect(can('observer', 'trips:write')).toBe(false);
    expect(can('observer', 'field:read_all')).toBe(false);
  });

  it('recognizes only the three roles', () => {
    expect(isRole('supervisor')).toBe(true);
    expect(isRole('root')).toBe(false);
  });
});

describe('credentials', () => {
  it('normalizes usernames to lower case and validates their shape', () => {
    expect(normalizeUsername('  Ana.Torres ')).toBe('ana.torres');
    expect(isValidUsername('ana.torres')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('ana torres')).toBe(false);
  });

  it('requires 12 to 256 characters, counted in code points', () => {
    expect(passwordProblem('short-pass1')).toBe('too_short');
    expect(passwordProblem('long enough!')).toBeNull();
    expect(passwordProblem('ñandú-ñandú')).toBe('too_short');
    expect(passwordProblem('x'.repeat(257))).toBe('too_long');
  });

  it('bounds login input before any normalization or hashing', () => {
    expect(loginUsername(' Ana.Torres ')).toBe('ana.torres');
    expect(loginUsername('a b')).toBeNull();
    expect(loginUsername(`ana${' '.repeat(100)}`)).toBeNull();
    expect(loginUsername('x'.repeat(1_000_000))).toBeNull();

    expect(loginPassword('long enough!')).toEqual({ value: 'long enough!', withinLimit: true });
    // 256 astral code points are 512 UTF-16 units: still within the limit.
    const astral = '😀'.repeat(PASSWORD_MAX_LENGTH);
    expect(loginPassword(astral)).toEqual({ value: astral, withinLimit: true });
    const huge = loginPassword('x'.repeat(1_000_000));
    expect(huge.withinLimit).toBe(false);
    expect(huge.value).toHaveLength(PASSWORD_MAX_UTF16_UNITS);
    expect(loginPassword('x'.repeat(PASSWORD_MAX_LENGTH + 1)).withinLimit).toBe(false);
  });
});

describe('lockout policy', () => {
  it('pauses one client network after 5 failures; spaces out and caps guessing per account', () => {
    expect(DEFAULT_LOCKOUT_POLICY).toEqual({
      perSource: { maxFailedAttempts: 5, lockoutMinutes: 15 },
      perAccount: { freeAttempts: 10, maxIntervalSec: 60, maxFailures: 100, windowHours: 24 },
    });
  });

  it('spaces account attempts 2^(n-10) s apart after 10 failures, at most 60 s', () => {
    const throttle = DEFAULT_LOCKOUT_POLICY.perAccount;
    const intervals = [0, 9, 10, 11, 12, 15, 16, 17, 99].map((n) =>
      attemptIntervalSec(n, throttle),
    );

    expect(intervals).toEqual([0, 0, 1, 2, 4, 32, 60, 60, 60]);
  });

  it('refuses an attempt before the interval since the last failure has passed', () => {
    const throttle = DEFAULT_LOCKOUT_POLICY.perAccount;
    let state: AccountLoginState = CLEAN_ACCOUNT_LOGIN_STATE;
    for (let i = 0; i < 9; i++) state = registerAccountFailure(state, T0, throttle);
    expect(isThrottled(state, T0, throttle)).toBe(false);

    const tenth = registerAccountFailure(state, T0, throttle);
    expect(tenth).toMatchObject({ failedAttempts: 10, throttledNow: true, lockedNow: false });
    expect(isThrottled(tenth, new Date(T0.getTime() + 999), throttle)).toBe(true);
    expect(isThrottled(tenth, new Date(T0.getTime() + 1000), throttle)).toBe(false);
    expect(registerAccountFailure(tenth, at(1), throttle).throttledNow).toBe(false);
  });

  it('pauses the account at 100 failures within 24 h, until that window ends', () => {
    const throttle = DEFAULT_LOCKOUT_POLICY.perAccount;
    let state: AccountLoginState = CLEAN_ACCOUNT_LOGIN_STATE;
    for (let i = 0; i < 99; i++) state = registerAccountFailure(state, at(i), throttle);
    expect(isLocked(state, at(99))).toBe(false);

    const locked = registerAccountFailure(state, at(99), throttle);

    expect(locked).toMatchObject({ lockedNow: true, failedAttempts: 0, lockedUntil: at(24 * 60) });
    expect(isLocked(locked, at(24 * 60 - 1))).toBe(true);
    expect(registerAccountFailure(locked, at(100), throttle)).toMatchObject({ lockedNow: false });
  });

  it('starts a new 24 h window when the previous one has ended', () => {
    const throttle = DEFAULT_LOCKOUT_POLICY.perAccount;
    let state: AccountLoginState = CLEAN_ACCOUNT_LOGIN_STATE;
    for (let i = 0; i < 50; i++) state = registerAccountFailure(state, at(i), throttle);

    const later = registerAccountFailure(state, at(24 * 60), throttle);

    expect(later).toMatchObject({ failedAttempts: 1, windowStartedAt: at(24 * 60) });
  });

  it('locks for 15 minutes at the fifth consecutive failure of a threshold', () => {
    let state = { failedAttempts: 0, lockedUntil: null as Date | null };
    for (let i = 1; i <= 4; i++) {
      const next = registerFailedLogin(state, T0, DEFAULT_LOCKOUT_POLICY.perSource);
      expect(next).toEqual({ failedAttempts: i, lockedUntil: null, lockedNow: false });
      state = next;
    }
    const locked = registerFailedLogin(state, T0, DEFAULT_LOCKOUT_POLICY.perSource);

    expect(locked).toEqual({ failedAttempts: 0, lockedUntil: at(15), lockedNow: true });
    expect(isLocked(locked, at(14))).toBe(true);
    expect(isLocked(locked, at(15))).toBe(false);
  });

  it('does not extend a lock on failures while locked', () => {
    const locked = { failedAttempts: 0, lockedUntil: at(10) };

    expect(registerFailedLogin(locked, at(5), DEFAULT_LOCKOUT_POLICY.perSource)).toEqual({
      ...locked,
      lockedNow: false,
    });
  });

  it('clears the failures on success', () => {
    expect(registerSuccessfulLogin()).toEqual({ failedAttempts: 0, lockedUntil: null });
  });
});

describe('session policy', () => {
  const policy: SessionPolicy = { idleMinutes: 30, absoluteHours: 2, touchIntervalSec: 60 };

  it('opens a session that expires after the absolute lifetime', () => {
    const session = openSession(T0, policy);

    expect(session).toEqual({ createdAt: T0, lastSeenAt: T0, expiresAt: at(120), revokedAt: null });
    expect(remainingLifetimeSec(session, at(60))).toBe(3600);
    expect(remainingLifetimeSec(session, at(200))).toBe(0);
  });

  it('expires on idleness, on the absolute lifetime, and when revoked', () => {
    const session = openSession(T0, policy);

    expect(sessionStatus(session, at(29), policy)).toBe('active');
    expect(sessionStatus(session, at(30), policy)).toBe('idle_expired');
    expect(sessionStatus({ ...session, lastSeenAt: at(110) }, at(120), policy)).toBe('expired');
    expect(sessionStatus({ ...session, revokedAt: at(1) }, at(2), policy)).toBe('revoked');
  });

  it('refreshes the last-seen time at most once per touch interval', () => {
    const session = openSession(T0, policy);

    expect(shouldTouch(session, new Date(T0.getTime() + 59_000), policy)).toBe(false);
    expect(shouldTouch(session, at(1), policy)).toBe(true);
  });

  it('classifies user agents coarsely without keeping them', () => {
    expect(classifyUserAgent('Mozilla/5.0 (Linux; Android 14) Mobile Safari')).toBe('mobile');
    expect(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
    expect(classifyUserAgent('curl/8.7.1')).toBe('other');
    expect(classifyUserAgent(undefined)).toBeNull();
  });
});

describe('CSRF policy', () => {
  const post = {
    method: 'POST',
    requestedWith: CSRF_HEADER_VALUE,
    origin: undefined,
    host: 'panel.example.org',
    publicOrigin: null,
  };

  it('lets safe methods through without any header', () => {
    expect(checkCsrf({ ...post, method: 'GET', requestedWith: undefined })).toEqual({
      allowed: true,
    });
    expect(isMutatingMethod('patch')).toBe(true);
  });

  it('requires the custom header on mutating requests', () => {
    expect(checkCsrf({ ...post, requestedWith: undefined })).toEqual({
      allowed: false,
      reason: 'missing_header',
    });
    expect(checkCsrf({ ...post, requestedWith: 'XMLHttpRequest' })).toEqual({
      allowed: false,
      reason: 'missing_header',
    });
    expect(checkCsrf(post)).toEqual({ allowed: true });
  });

  it('requires a present Origin to be the configured public origin', () => {
    const configured = { ...post, publicOrigin: 'https://panel.example.org' };

    expect(checkCsrf({ ...configured, origin: 'https://panel.example.org' }).allowed).toBe(true);
    expect(checkCsrf({ ...configured, origin: 'https://evil.example' })).toEqual({
      allowed: false,
      reason: 'foreign_origin',
    });
    expect(checkCsrf({ ...configured, origin: 'http://panel.example.org' }).allowed).toBe(false);
    expect(checkCsrf({ ...configured, origin: 'null' }).allowed).toBe(false);
  });

  it('falls back to the requested host when no public origin is configured', () => {
    expect(checkCsrf({ ...post, host: 'localhost:5173', origin: 'http://localhost:5173' })).toEqual(
      { allowed: true },
    );
    expect(checkCsrf({ ...post, host: 'localhost:5173', origin: 'http://evil.test:5173' })).toEqual(
      { allowed: false, reason: 'foreign_origin' },
    );
  });
});
