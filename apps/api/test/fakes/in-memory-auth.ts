import type {
  NewUser,
  PanelUser,
  PasswordHasher,
  SessionStore,
  SessionTokens,
  StoredSession,
  UserChanges,
  UserCredentials,
  UserStore,
} from '../../src/auth/application/auth-ports.js';
import {
  CLEAN_ACCOUNT_LOGIN_STATE,
  type AccountLoginState,
} from '../../src/auth/domain/lockout-policy.js';
import type { SessionTimes, UserAgentClass } from '../../src/auth/domain/session-policy.js';
import type { AuditEvent, AuditLog } from '../../src/shared/application/audit-log.js';

interface UserRow {
  user: PanelUser;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastFailedAt: Date | null;
  windowStartedAt: Date | null;
}

export class InMemoryUserStore implements UserStore {
  readonly rows = new Map<string, UserRow>();
  private nextId = 1;

  constructor(private readonly now: () => Date = () => new Date('2026-10-20T12:00:00Z')) {}

  findCredentials(username: string): Promise<UserCredentials | null> {
    const row = [...this.rows.values()].find((r) => r.user.username === username);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  findById(userId: string): Promise<PanelUser | null> {
    return Promise.resolve(this.rows.get(userId)?.user ?? null);
  }

  list(): Promise<PanelUser[]> {
    return Promise.resolve([...this.rows.values()].map((r) => r.user));
  }

  create(user: NewUser): Promise<PanelUser | null> {
    if ([...this.rows.values()].some((r) => r.user.username === user.username)) {
      return Promise.resolve(null);
    }
    const created: PanelUser = {
      id: `user-${this.nextId++}`,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: true,
      createdAt: this.now(),
      lastLoginAt: null,
    };
    this.rows.set(created.id, {
      user: created,
      passwordHash: user.passwordHash,
      ...CLEAN_ACCOUNT_LOGIN_STATE,
    });
    return Promise.resolve(created);
  }

  update(userId: string, changes: UserChanges): Promise<PanelUser | null> {
    const row = this.rows.get(userId);
    if (row === undefined) return Promise.resolve(null);
    const { passwordHash, ...profile } = changes;
    row.user = { ...row.user, ...profile };
    if (passwordHash !== undefined) Object.assign(row, { passwordHash }, CLEAN_ACCOUNT_LOGIN_STATE);
    return Promise.resolve(row.user);
  }

  modifyLoginState<T extends AccountLoginState>(
    userId: string,
    change: (current: AccountLoginState) => T,
  ): Promise<T> {
    const row = this.rows.get(userId);
    if (row === undefined) throw new Error(`No user ${userId}`);
    const { failedAttempts, lockedUntil, lastFailedAt, windowStartedAt } = row;
    const next = change({ failedAttempts, lockedUntil, lastFailedAt, windowStartedAt });
    row.failedAttempts = next.failedAttempts;
    row.lockedUntil = next.lockedUntil;
    row.lastFailedAt = next.lastFailedAt;
    row.windowStartedAt = next.windowStartedAt;
    return Promise.resolve(next);
  }

  recordLogin(userId: string, at: Date): Promise<void> {
    const row = this.rows.get(userId);
    if (row !== undefined) row.user = { ...row.user, lastLoginAt: at };
    return Promise.resolve();
  }
}

interface SessionRow extends SessionTimes {
  id: string;
  userId: string;
  tokenHash: string;
  userAgentClass: UserAgentClass | null;
}

export class InMemorySessionStore implements SessionStore {
  readonly rows = new Map<string, SessionRow>();
  private nextId = 1;

  constructor(private readonly users: InMemoryUserStore) {}

  create(input: {
    userId: string;
    tokenHash: string;
    times: SessionTimes;
    userAgentClass: UserAgentClass | null;
  }): Promise<string> {
    const id = `session-${this.nextId++}`;
    this.rows.set(id, {
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      userAgentClass: input.userAgentClass,
      ...input.times,
    });
    return Promise.resolve(id);
  }

  async findByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const row = [...this.rows.values()].find((r) => r.tokenHash === tokenHash);
    if (row === undefined) return null;
    const user = await this.users.findById(row.userId);
    return user === null ? null : { ...row, user };
  }

  touch(sessionId: string, at: Date): Promise<void> {
    const row = this.rows.get(sessionId);
    if (row !== undefined) this.rows.set(sessionId, { ...row, lastSeenAt: at });
    return Promise.resolve();
  }

  revoke(sessionId: string, at: Date): Promise<boolean> {
    const row = this.rows.get(sessionId);
    if (row === undefined || row.revokedAt !== null) return Promise.resolve(false);
    this.rows.set(sessionId, { ...row, revokedAt: at });
    return Promise.resolve(true);
  }

  revokeAllOf(userId: string, at: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.userId === userId && row.revokedAt === null) {
        this.rows.set(row.id, { ...row, revokedAt: at });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  purgeEndedOf(userId: string, before: Date): Promise<void> {
    for (const row of [...this.rows.values()]) {
      const ended = row.revokedAt !== null || row.expiresAt.getTime() <= before.getTime();
      if (row.userId === userId && ended) this.rows.delete(row.id);
    }
    return Promise.resolve();
  }
}

/**
 * `hashed:<password>`; counts every verification so equal-cost paths can be asserted, and calls
 * `onVerify` with the password each verification received.
 */
export class FakePasswordHasher implements PasswordHasher {
  verifications = 0;
  onVerify: (password: string) => void = () => undefined;

  hash(password: string): Promise<string> {
    return Promise.resolve(`hashed:${password}`);
  }

  verify(password: string, encodedHash: string): Promise<boolean> {
    this.verifications += 1;
    this.onVerify(password);
    return Promise.resolve(encodedHash === `hashed:${password}`);
  }

  verifyDummy(password: string): Promise<void> {
    this.verifications += 1;
    this.onVerify(password);
    return Promise.resolve();
  }
}

export class SequentialSessionTokens implements SessionTokens {
  private next = 1;

  generate(): { token: string; hash: string } {
    const token = `token-${this.next++}`;
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return `sha:${token}`;
  }
}

export class InMemoryAuditLog implements AuditLog {
  readonly events: AuditEvent[] = [];

  record(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  actions(): string[] {
    return this.events.map((e) => e.action);
  }
}
