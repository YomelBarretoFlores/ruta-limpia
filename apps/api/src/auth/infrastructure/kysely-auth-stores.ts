import type { Selectable } from 'kysely';

import type { AppDatabase, UsersTable } from '../../shared/infrastructure/db/database.js';
import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
import { KyselyAuditLog } from '../../shared/infrastructure/audit/kysely-audit-log.js';
import {
  inTransaction,
  KyselyUnitOfWork,
} from '../../shared/infrastructure/db/kysely-unit-of-work.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  NewUser,
  PanelUser,
  SessionStore,
  StoredSession,
  UserChanges,
  UserCredentials,
  UserStore,
} from '../application/auth-ports.js';
import type { UserAdminTransaction } from '../application/user-admin-service.js';
import type { AccountLoginState } from '../domain/lockout-policy.js';
import type { SessionTimes, UserAgentClass } from '../domain/session-policy.js';

const PROFILE_COLUMNS = [
  'id',
  'username',
  'display_name',
  'role',
  'active',
  'created_at',
  'last_login_at',
] as const;

type ProfileRow = Pick<Selectable<UsersTable>, (typeof PROFILE_COLUMNS)[number]>;

function toPanelUser(row: ProfileRow): PanelUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

const LOGIN_STATE_COLUMNS = [
  'failed_attempts',
  'locked_until',
  'last_failed_at',
  'failure_window_started_at',
] as const;

/** A password reset clears the failures, the throttle and any pause. */
const CLEARED_LOGIN_STATE = {
  failed_attempts: 0,
  locked_until: null,
  last_failed_at: null,
  failure_window_started_at: null,
} as const;

function toLoginState(row: {
  readonly failed_attempts: number;
  readonly locked_until: Date | null;
  readonly last_failed_at: Date | null;
  readonly failure_window_started_at: Date | null;
}): AccountLoginState {
  return {
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastFailedAt: row.last_failed_at,
    windowStartedAt: row.failure_window_started_at,
  };
}

/** Panel users in PostgreSQL (`users`). */
export class KyselyUserStore implements UserStore {
  constructor(private readonly db: AppDatabase) {}

  async findCredentials(username: string): Promise<UserCredentials | null> {
    const row = await this.db
      .selectFrom('users')
      .select([...PROFILE_COLUMNS, 'password_hash', ...LOGIN_STATE_COLUMNS])
      .where('username', '=', username)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          user: toPanelUser(row),
          passwordHash: row.password_hash,
          ...toLoginState(row),
        };
  }

  async findById(userId: string): Promise<PanelUser | null> {
    if (!isUuid(userId)) return null;
    const row = await this.db
      .selectFrom('users')
      .select(PROFILE_COLUMNS)
      .where('id', '=', userId)
      .executeTakeFirst();
    return row === undefined ? null : toPanelUser(row);
  }

  async list(): Promise<PanelUser[]> {
    const rows = await this.db
      .selectFrom('users')
      .select(PROFILE_COLUMNS)
      .orderBy('username')
      .execute();
    return rows.map(toPanelUser);
  }

  async create(user: NewUser): Promise<PanelUser | null> {
    const row = await this.db
      .insertInto('users')
      .values({
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        password_hash: user.passwordHash,
      })
      // The only unique key is the case-insensitive username.
      .onConflict((oc) => oc.doNothing())
      .returning(PROFILE_COLUMNS)
      .executeTakeFirst();
    return row === undefined ? null : toPanelUser(row);
  }

  async update(userId: string, changes: UserChanges): Promise<PanelUser | null> {
    if (!isUuid(userId)) return null;
    const row = await this.db
      .updateTable('users')
      .set({
        ...(changes.displayName === undefined ? {} : { display_name: changes.displayName }),
        ...(changes.role === undefined ? {} : { role: changes.role }),
        ...(changes.active === undefined ? {} : { active: changes.active }),
        // A reset password also clears a lockout and the throttle.
        ...(changes.passwordHash === undefined
          ? {}
          : { password_hash: changes.passwordHash, ...CLEARED_LOGIN_STATE }),
      })
      .where('id', '=', userId)
      .returning(PROFILE_COLUMNS)
      .executeTakeFirst();
    return row === undefined ? null : toPanelUser(row);
  }

  modifyLoginState<T extends AccountLoginState>(
    userId: string,
    change: (current: AccountLoginState) => T,
  ): Promise<T> {
    return inTransaction(this.db, async (trx) => {
      const row = await trx
        .selectFrom('users')
        .select(LOGIN_STATE_COLUMNS)
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const next = change(toLoginState(row));
      await trx
        .updateTable('users')
        .set({
          failed_attempts: next.failedAttempts,
          locked_until: next.lockedUntil,
          last_failed_at: next.lastFailedAt,
          failure_window_started_at: next.windowStartedAt,
        })
        .where('id', '=', userId)
        .execute();
      return next;
    });
  }

  async recordLogin(userId: string, at: Date): Promise<void> {
    await this.db
      .updateTable('users')
      .set({ last_login_at: at })
      .where('id', '=', userId)
      .execute();
  }
}

/** Panel sessions in PostgreSQL (`sessions`), looked up by the SHA-256 of their token. */
export class KyselySessionStore implements SessionStore {
  constructor(private readonly db: AppDatabase) {}

  async create(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly times: SessionTimes;
    readonly userAgentClass: UserAgentClass | null;
  }): Promise<string> {
    const row = await this.db
      .insertInto('sessions')
      .values({
        user_id: input.userId,
        token_hash: input.tokenHash,
        user_agent_class: input.userAgentClass,
        created_at: input.times.createdAt,
        last_seen_at: input.times.lastSeenAt,
        expires_at: input.times.expiresAt,
        revoked_at: input.times.revokedAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const row = await this.db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id as session_id',
        's.created_at as session_created_at',
        's.last_seen_at',
        's.expires_at',
        's.revoked_at',
        'u.id',
        'u.username',
        'u.display_name',
        'u.role',
        'u.active',
        'u.created_at',
        'u.last_login_at',
      ])
      .where('s.token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          id: row.session_id,
          createdAt: row.session_created_at,
          lastSeenAt: row.last_seen_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          user: toPanelUser(row),
        };
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({ last_seen_at: at })
      .where('id', '=', sessionId)
      .where('last_seen_at', '<', at)
      .execute();
  }

  async revoke(sessionId: string, at: Date): Promise<boolean> {
    const result = await this.db
      .updateTable('sessions')
      .set({ revoked_at: at })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async revokeAllOf(userId: string, at: Date): Promise<number> {
    const result = await this.db
      .updateTable('sessions')
      .set({ revoked_at: at })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async purgeEndedOf(userId: string, before: Date): Promise<void> {
    await this.db
      .deleteFrom('sessions')
      .where('user_id', '=', userId)
      .where((eb) => eb.or([eb('revoked_at', 'is not', null), eb('expires_at', '<=', before)]))
      .execute();
  }
}

/** User changes, the sessions they end and their audit events, in one transaction. */
export function kyselyUserAdminTransactions(db: AppDatabase): UnitOfWork<UserAdminTransaction> {
  return new KyselyUnitOfWork(db, (trx) => ({
    users: new KyselyUserStore(trx),
    sessions: new KyselySessionStore(trx),
    audit: new KyselyAuditLog(trx),
  }));
}
