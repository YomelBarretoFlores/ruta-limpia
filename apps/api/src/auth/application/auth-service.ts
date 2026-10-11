import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { Logger } from '../../shared/application/logger.js';
import { loginPassword, loginUsername } from '../domain/credentials.js';
import {
  admitSourceAttempt,
  DEFAULT_LOCKOUT_POLICY,
  isLocked,
  knownNetworkCutoff,
  registerAccountFailure,
  registerAccountSuccess,
  releaseAttempt,
  reserveAttempt,
  settleSourceAttempt,
  type AccountLoginState,
  type AttemptReservation,
  type LockoutPolicy,
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
  KnownNetworkStore,
  LoginSourceStore,
  PanelUser,
  PasswordHasher,
  SessionStore,
  SessionTokens,
  UserStore,
} from './auth-ports.js';
import type { VerificationTiming } from './verification-timing.js';

export interface AuthServiceDependencies {
  readonly users: UserStore;
  readonly sessions: SessionStore;
  readonly sources: LoginSourceStore;
  readonly knownNetworks: KnownNetworkStore;
  readonly hasher: PasswordHasher;
  /** Times real verifications, and makes refused attempts take as long without hashing. */
  readonly timing: VerificationTiming;
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
  /** The client's network (IPv4 /24, IPv6 /64), the "source" of the per-source lockout. */
  readonly clientNetwork?: string;
}

/**
 * The outcome of a login. There is deliberately no "locked" variant: a paused account or network
 * gets the same `invalid_credentials` as a wrong password, so no answer depends on whether the
 * username exists.
 */
export type LoginResult =
  | {
      readonly status: 'authenticated';
      readonly user: PanelUser;
      /** The new session token: it only ever travels in the cookie. */
      readonly token: string;
      readonly maxAgeSec: number;
    }
  | { readonly status: 'invalid_credentials' };

/** An authenticated request: the session and its (active) user. */
export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly user: PanelUser;
  readonly maxAgeSec: number;
}

type Refusal = 'account_locked' | 'source_locked' | 'account_throttled';

/** An attempt admitted to the password check, with what it holds until it is settled. */
interface Admission {
  readonly source: string;
  /** The account's reserved slot, when the spacing applied. */
  readonly reservation: AttemptReservation | null;
}

const INVALID_CREDENTIALS: LoginResult = Object.freeze({ status: 'invalid_credentials' });
/** The source of logins without a known client network (command line, tests). */
const UNKNOWN_NETWORK = 'unknown';

/**
 * Panel login, session validation and logout (OWASP ASVS L2):
 *
 * - oversized usernames and passwords are cut before any normalization, lookup or hashing;
 * - an unknown or inactive user burns one password verification (through the bounded hasher
 *   queue); a paused or throttled attempt waits as long as a recent real verification took,
 *   without hashing (`VerificationTiming`), so the response time does not reveal whether the user
 *   exists, is inactive, paused or throttled, and a flood against a throttled account takes no
 *   place in the hashing queue;
 * - failures are counted per (account, client network) and per account, as the lockout policy
 *   says; a paused or throttled attempt answers `invalid_credentials` like a wrong password;
 * - before any hashing, each attempt takes a provisional place in its source's budget (attempts
 *   still being checked count as failures), so a simultaneous burst from one network gets at most
 *   the remaining budget of password checks, from a known network too;
 * - the per-account spacing is decided, and a spaced-out attempt's slot reserved, under the
 *   account's row lock before any hashing, so attempts arriving together when an interval ends
 *   get one password check between them; attempts from a known network of the account (a
 *   successful sign-in from it within 30 days) are not spaced out;
 * - an attempt whose check never ran (the hasher shed it) gives back its provisional place and
 *   its reserved slot, so a shed request uses up neither;
 * - a login always opens a new session with a fresh random token and revokes the session the
 *   browser presented (no session fixation);
 * - sessions end on idleness, on their absolute lifetime, on logout, and when an administrator
 *   deactivates the user, changes their role or resets their password.
 */
export class AuthService {
  private readonly lockout: LockoutPolicy;

  constructor(private readonly deps: AuthServiceDependencies) {
    this.lockout = deps.lockoutPolicy ?? DEFAULT_LOCKOUT_POLICY;
  }

  async login(command: LoginCommand): Promise<LoginResult> {
    const { users, hasher, clock } = this.deps;
    const now = clock.now();
    const username = loginUsername(command.username);
    const password = loginPassword(command.password);

    const credentials =
      username !== null && password.withinLimit ? await users.findCredentials(username) : null;
    if (credentials === null || !credentials.user.active) {
      await this.deps.timing.measure(() => hasher.verifyDummy(password.value));
      await this.record('auth.login_failed', credentials?.user.id ?? null, now, {
        reason: credentials === null ? 'unknown_user' : 'inactive_user',
      });
      return INVALID_CREDENTIALS;
    }

    const user = credentials.user;
    const network = command.clientNetwork;
    const source = `${user.id}|${network ?? UNKNOWN_NETWORK}`;
    const admission = await this.admit(credentials, user.id, network, source, now);
    if (typeof admission === 'string') {
      // As long as a checked attempt, without the hashing: the timing reveals nothing.
      await this.deps.timing.imitate();
      await this.record('auth.login_blocked', user.id, now, { reason: admission });
      return INVALID_CREDENTIALS;
    }

    let valid: boolean;
    try {
      valid = await this.deps.timing.measure(() =>
        hasher.verify(password.value, credentials.passwordHash),
      );
    } catch (error) {
      await this.abandon(user.id, admission, now);
      throw error;
    }
    if (!valid) {
      await this.countFailure(user, source, now);
      return INVALID_CREDENTIALS;
    }

    // The password was checked outside the locks: a parallel attempt may have paused it since.
    const state = await users.modifyLoginState(user.id, (current) =>
      registerAccountSuccess(current, now),
    );
    const accountLocked = isLocked(state, now);
    const bySource = await this.settleSource(
      source,
      now,
      accountLocked ? 'abandoned' : 'succeeded',
    );
    const pausedMeanwhile = accountLocked
      ? 'account_locked'
      : isLocked(bySource, now)
        ? 'source_locked'
        : null;
    if (pausedMeanwhile !== null) {
      await this.record('auth.login_blocked', user.id, now, { reason: pausedMeanwhile });
      return INVALID_CREDENTIALS;
    }
    if (network !== undefined) {
      const forgetBefore = knownNetworkCutoff(now, this.lockout.perAccount);
      await this.deps.knownNetworks.remember(user.id, network, now, forgetBefore);
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

  /**
   * Admits an attempt to the password check, or says why it is refused. Before any hashing, the
   * attempt takes a provisional place in its source's budget, and, outside the account's known
   * networks, the throttle check and the reservation of the attempt's slot happen in one locked
   * read-modify-write.
   */
  private async admit(
    credentials: AccountLoginState,
    userId: string,
    network: string | undefined,
    source: string,
    now: Date,
  ): Promise<Admission | Refusal> {
    if (isLocked(credentials, now)) return 'account_locked';
    const bySource = await this.deps.sources.modify(source, (current) =>
      admitSourceAttempt(current, now, this.lockout.perSource),
    );
    if (!bySource.admitted) return 'source_locked';
    const throttle = this.lockout.perAccount;
    const known =
      network !== undefined &&
      (await this.deps.knownNetworks.isKnown(userId, network, knownNetworkCutoff(now, throttle)));
    if (known) return { source, reservation: null };
    const reserved = await this.deps.users.modifyLoginState(userId, (current) =>
      reserveAttempt(current, now, throttle),
    );
    if (reserved.admitted) return { source, reservation: reserved.reservation };
    await this.settleSource(source, now, 'abandoned');
    return isLocked(reserved, now) ? 'account_locked' : 'account_throttled';
  }

  /** Gives back what an admitted attempt held when its password check never ran. */
  private async abandon(userId: string, admission: Admission, now: Date): Promise<void> {
    await this.settleSource(admission.source, now, 'abandoned');
    const reservation = admission.reservation;
    if (reservation !== null) {
      await this.deps.users.modifyLoginState(userId, (current) =>
        releaseAttempt(current, reservation),
      );
    }
  }

  private settleSource(source: string, now: Date, outcome: 'failed' | 'succeeded' | 'abandoned') {
    return this.deps.sources.modify(source, (current) =>
      settleSourceAttempt(current, now, this.lockout.perSource, outcome),
    );
  }

  /** A wrong password: counts it for the source and for the account, and reports a new pause. */
  private async countFailure(user: PanelUser, source: string, now: Date): Promise<void> {
    const bySource = await this.settleSource(source, now, 'failed');
    const byAccount = await this.deps.users.modifyLoginState(user.id, (current) =>
      registerAccountFailure(current, now, this.lockout.perAccount),
    );
    // The user id is an opaque key; the username, the password and the network are never logged.
    if (byAccount.throttledNow) {
      this.deps.logger.warn(
        { userId: user.id, scope: 'account_throttle', failedAttempts: byAccount.failedAttempts },
        'Panel sign-in attempts spaced out after repeated failures',
      );
    }
    if (!byAccount.lockedNow && !bySource.lockedNow) {
      await this.record('auth.login_failed', user.id, now, { reason: 'wrong_password' });
      return;
    }
    const scope = byAccount.lockedNow ? 'account' : 'source';
    const lockedUntil = (byAccount.lockedNow ? byAccount : bySource).lockedUntil;
    const lockoutMinutes =
      lockedUntil === null ? 0 : Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000);
    this.deps.logger.warn(
      { userId: user.id, scope, lockoutMinutes },
      'Panel sign-in paused after repeated failures',
    );
    await this.record('auth.account_locked', user.id, now, { reason: 'wrong_password', scope });
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
