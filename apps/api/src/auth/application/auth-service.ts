import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { Logger } from '../../shared/application/logger.js';
import { isValidUsername, normalizeUsername, PASSWORD_MAX_LENGTH } from '../domain/credentials.js';
import {
  DEFAULT_LOCKOUT_POLICY,
  isLocked,
  registerFailedLogin,
  registerSuccessfulLogin,
  type LockoutPolicy,
  type LoginState,
} from '../domain/lockout-policy.js';
import {
  classifyUserAgent,
  openSession,
  remainingLifetimeSec,
  sessionStatus,
  shouldTouch,
  type SessionPolicy,
} from '../domain/session-policy.js';
import type {
  PanelUser,
  PasswordHasher,
  SessionStore,
  SessionTokens,
  UserStore,
} from './auth-ports.js';

export interface AuthServiceDependencies {
  readonly users: UserStore;
  readonly sessions: SessionStore;
  readonly hasher: PasswordHasher;
  readonly tokens: SessionTokens;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sessionPolicy: SessionPolicy;
  readonly lockoutPolicy?: LockoutPolicy;
}

export interface LoginCommand {
  readonly username: string;
  readonly password: string;
  readonly userAgent?: string;
  /** The session cookie the browser still sent, if any: it is revoked (session rotation). */
  readonly previousToken?: string;
}

export type LoginResult =
  | {
      readonly status: 'authenticated';
      readonly user: PanelUser;
      /** The new session token: it only ever travels in the cookie. */
      readonly token: string;
      readonly maxAgeSec: number;
    }
  | { readonly status: 'invalid_credentials' }
  | { readonly status: 'account_locked' };

/** An authenticated request: the session and its (active) user. */
export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly user: PanelUser;
  readonly maxAgeSec: number;
}

/**
 * Unknown usernames get the same failure counting and lockout as real accounts (kept in memory,
 * bounded), so the `account_locked` answer cannot be used to tell which usernames exist.
 */
const MAX_PHANTOM_ACCOUNTS = 10_000;

/**
 * Panel login, session validation and logout (OWASP ASVS L2):
 *
 * - every failed path burns one password verification, so the response time does not reveal
 *   whether the user exists, is inactive or is locked;
 * - failures are counted under a row lock; five in a row lock the account for 15 minutes;
 * - a login always opens a new session with a fresh random token and revokes the session the
 *   browser presented (no session fixation);
 * - sessions end on idleness, on their absolute lifetime, on logout, and when an administrator
 *   deactivates the user, changes their role or resets their password.
 */
export class AuthService {
  private readonly lockout: LockoutPolicy;
  private readonly phantoms = new Map<string, LoginState>();

  constructor(private readonly deps: AuthServiceDependencies) {
    this.lockout = deps.lockoutPolicy ?? DEFAULT_LOCKOUT_POLICY;
  }

  async login(command: LoginCommand): Promise<LoginResult> {
    const { users, hasher, clock } = this.deps;
    const username = normalizeUsername(command.username);
    const password = command.password;
    const now = clock.now();

    const credentials =
      isValidUsername(username) && [...password].length <= PASSWORD_MAX_LENGTH
        ? await users.findCredentials(username)
        : null;
    if (credentials === null || !credentials.user.active) {
      await hasher.verifyDummy(password);
      const lockedNow = this.failPhantom(username, now);
      await this.record('auth.login_failed', credentials?.user.id ?? null, now, {
        reason: credentials === null ? 'unknown_user' : 'inactive_user',
      });
      return lockedNow ? { status: 'account_locked' } : { status: 'invalid_credentials' };
    }

    const user = credentials.user;
    if (isLocked(credentials, now)) {
      await hasher.verifyDummy(password);
      await this.record('auth.login_blocked', user.id, now, { reason: 'locked' });
      return { status: 'account_locked' };
    }

    if (!(await hasher.verify(password, credentials.passwordHash))) {
      const outcome = await users.modifyLoginState(user.id, (current) =>
        registerFailedLogin(current, now, this.lockout),
      );
      await this.record(
        outcome.lockedNow ? 'auth.account_locked' : 'auth.login_failed',
        user.id,
        now,
        { reason: 'wrong_password' },
      );
      return outcome.lockedNow || isLocked(outcome, now)
        ? { status: 'account_locked' }
        : { status: 'invalid_credentials' };
    }

    // The password was checked outside the row lock: a parallel attempt may have locked it since.
    const state = await users.modifyLoginState(user.id, (current) =>
      isLocked(current, now) ? current : registerSuccessfulLogin(),
    );
    if (isLocked(state, now)) {
      await this.record('auth.login_blocked', user.id, now, { reason: 'locked' });
      return { status: 'account_locked' };
    }

    const opened = await this.openSession(user, now, command.userAgent);
    if (command.previousToken !== undefined) await this.revokeToken(command.previousToken, now);
    await users.recordLogin(user.id, now);
    await this.deps.sessions.purgeEndedOf(user.id, now);
    await this.record('auth.login_succeeded', user.id, now, {});
    return { status: 'authenticated', user, ...opened };
  }

  /** The active session of a cookie token, or null (unknown, expired, revoked, inactive user). */
  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    const { sessions, tokens, clock, sessionPolicy } = this.deps;
    const session = await sessions.findByTokenHash(tokens.hash(token));
    if (session === null || !session.user.active) return null;
    const now = clock.now();
    if (sessionStatus(session, now, sessionPolicy) !== 'active') return null;
    if (shouldTouch(session, now, sessionPolicy)) await sessions.touch(session.id, now);
    return {
      sessionId: session.id,
      user: session.user,
      maxAgeSec: remainingLifetimeSec(session, now),
    };
  }

  async logout(session: AuthenticatedSession): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.sessions.revoke(session.sessionId, now);
    await this.record('auth.logout', session.user.id, now, {});
  }

  private async openSession(user: PanelUser, now: Date, userAgent: string | undefined) {
    const { sessions, tokens, sessionPolicy } = this.deps;
    const { token, hash } = tokens.generate();
    const times = openSession(now, sessionPolicy);
    await sessions.create({
      userId: user.id,
      tokenHash: hash,
      times,
      userAgentClass: classifyUserAgent(userAgent),
    });
    return { token, maxAgeSec: remainingLifetimeSec(times, now) };
  }

  private async revokeToken(token: string, now: Date): Promise<void> {
    const previous = await this.deps.sessions.findByTokenHash(this.deps.tokens.hash(token));
    if (previous !== null) await this.deps.sessions.revoke(previous.id, now);
  }

  /** Counts a failure of an unknown or inactive username; true when it locks now. */
  private failPhantom(username: string, now: Date): boolean {
    const current = this.phantoms.get(username) ?? { failedAttempts: 0, lockedUntil: null };
    if (isLocked(current, now)) return true;
    const next = registerFailedLogin(current, now, this.lockout);
    this.phantoms.delete(username);
    this.phantoms.set(username, {
      failedAttempts: next.failedAttempts,
      lockedUntil: next.lockedUntil,
    });
    if (this.phantoms.size > MAX_PHANTOM_ACCOUNTS) {
      const oldest = this.phantoms.keys().next().value;
      if (oldest !== undefined) this.phantoms.delete(oldest);
    }
    return next.lockedNow;
  }

  private async record(
    action: string,
    userId: string | null,
    at: Date,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({ userId, action, entity: 'user', entityId: userId, at, details });
  }
}
