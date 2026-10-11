import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openSession } from '../../src/auth/domain/session-policy.js';
import {
  DEFAULT_LOCKOUT_POLICY,
  registerAccountFailure,
} from '../../src/auth/domain/lockout-policy.js';
import {
  KyselyKnownNetworkStore,
  KyselySessionStore,
  KyselyUserStore,
} from '../../src/auth/infrastructure/kysely-auth-stores.js';
import { KyselyAuditLog } from '../../src/shared/infrastructure/audit/kysely-audit-log.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { connectTestDatabase, resetData } from './database.js';

const T0 = new Date('2026-10-20T12:00:00Z');
const POLICY = { idleMinutes: 30, absoluteHours: 2, touchIntervalSec: 60 };
const hashOf = (n: number) => n.toString(16).padStart(64, '0');

let db: AppDatabase;
let users: KyselyUserStore;
let sessions: KyselySessionStore;
let knownNetworks: KyselyKnownNetworkStore;

beforeAll(async () => {
  db = await connectTestDatabase();
  users = new KyselyUserStore(db);
  sessions = new KyselySessionStore(db);
  knownNetworks = new KyselyKnownNetworkStore(db);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
});

async function createUser(username = 'ana') {
  const user = await users.create({
    username,
    displayName: 'Ana',
    role: 'supervisor',
    passwordHash: '$scrypt$ln=10,r=8,p=1$c2FsdA$a2V5',
  });
  if (user === null) throw new Error('not created');
  return user;
}

describe('KyselyUserStore (PostGIS)', () => {
  it('keeps usernames unique case-insensitively', async () => {
    await createUser('ana');

    expect(
      await users.create({ username: 'ana', displayName: 'X', role: 'admin', passwordHash: 'h' }),
    ).toBeNull();
    await expect(
      db
        .insertInto('users')
        .values({ username: 'ANA', display_name: 'X', role: 'admin', password_hash: 'h' })
        .execute(),
    ).rejects.toThrow();
  });

  it('reads credentials and counts failures under a row lock', async () => {
    const user = await createUser();

    await Promise.all(
      Array.from({ length: 3 }, () =>
        users.modifyLoginState(user.id, (current) =>
          registerAccountFailure(current, T0, DEFAULT_LOCKOUT_POLICY.perAccount),
        ),
      ),
    );

    expect(await users.findCredentials('ana')).toMatchObject({
      user: { id: user.id, role: 'supervisor', active: true },
      failedAttempts: 3,
      windowFailures: 3,
      lockedUntil: null,
      lastAttemptAt: T0,
      windowStartedAt: T0,
    });
  });

  it('clears a lockout and the known networks when the password is reset', async () => {
    const user = await createUser();
    await users.modifyLoginState(user.id, () => ({
      failedAttempts: 12,
      windowFailures: 40,
      lockedUntil: T0,
      lastAttemptAt: T0,
      windowStartedAt: T0,
    }));
    await knownNetworks.remember(user.id, '190.40.12.0/24', T0, T0);

    await users.update(user.id, { passwordHash: 'new-hash' });

    expect(await users.findCredentials('ana')).toMatchObject({
      passwordHash: 'new-hash',
      failedAttempts: 0,
      windowFailures: 0,
      lockedUntil: null,
      lastAttemptAt: null,
      windowStartedAt: null,
    });
    expect(await knownNetworks.isKnown(user.id, '190.40.12.0/24', T0)).toBe(false);
    expect(await users.findById('not-a-uuid')).toBeNull();
  });
});

describe('KyselyKnownNetworkStore (PostGIS)', () => {
  const NETWORK = '190.40.12.0/24';
  const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

  it('remembers a network per user, as a hash, and refreshes its last sign-in', async () => {
    const ana = await createUser('ana');
    const omar = await createUser('omar');

    await knownNetworks.remember(ana.id, NETWORK, T0, days(-30));
    await knownNetworks.remember(ana.id, NETWORK, days(10), days(-20));

    expect(await knownNetworks.isKnown(ana.id, NETWORK, days(5))).toBe(true);
    expect(await knownNetworks.isKnown(ana.id, '200.48.7.0/24', T0)).toBe(false);
    expect(await knownNetworks.isKnown(omar.id, NETWORK, T0)).toBe(false);
    expect(await knownNetworks.isKnown('not-a-uuid', NETWORK, T0)).toBe(false);
    const rows = await db.selectFrom('user_known_networks').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.network_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('190.40');
  });

  it('ignores and forgets networks last seen before the cutoff', async () => {
    const ana = await createUser('ana');
    const omar = await createUser('omar');
    await knownNetworks.remember(ana.id, NETWORK, T0, days(-30));

    expect(await knownNetworks.isKnown(ana.id, NETWORK, days(1))).toBe(false);
    await knownNetworks.remember(omar.id, NETWORK, days(31), days(1));

    const rows = await db.selectFrom('user_known_networks').select('user_id').execute();
    expect(rows).toEqual([{ user_id: omar.id }]);
  });
});

describe('KyselySessionStore (PostGIS)', () => {
  it('finds a session by token hash with its user, touches and revokes it', async () => {
    const user = await createUser();
    const id = await sessions.create({
      userId: user.id,
      tokenHash: hashOf(1),
      times: openSession(T0, POLICY),
      userAgentClass: 'desktop',
    });

    expect(await sessions.findByTokenHash(hashOf(1))).toMatchObject({
      id,
      createdAt: T0,
      revokedAt: null,
      user: { username: 'ana' },
    });
    const later = new Date(T0.getTime() + 60_000);
    await sessions.touch(id, later);
    expect((await sessions.findByTokenHash(hashOf(1)))?.lastSeenAt).toEqual(later);
    expect(await sessions.revoke(id, later)).toBe(true);
    expect(await sessions.revoke(id, later)).toBe(false);
  });

  it('revokes every session of a user and purges ended ones', async () => {
    const user = await createUser();
    for (const n of [1, 2]) {
      await sessions.create({
        userId: user.id,
        tokenHash: hashOf(n),
        times: openSession(T0, POLICY),
        userAgentClass: null,
      });
    }

    expect(await sessions.revokeAllOf(user.id, T0)).toBe(2);
    await sessions.purgeEndedOf(user.id, T0);
    expect(await db.selectFrom('sessions').selectAll().execute()).toEqual([]);
  });
});

describe('KyselyAuditLog (PostGIS)', () => {
  it('appends events and lists them newest first with the username', async () => {
    const user = await createUser();
    const audit = new KyselyAuditLog(db);
    await audit.record({
      userId: user.id,
      action: 'auth.login_succeeded',
      entity: 'user',
      entityId: user.id,
      at: T0,
    });
    await audit.record({
      userId: null,
      action: 'auth.login_failed',
      entity: 'user',
      entityId: null,
      at: new Date(T0.getTime() + 1000),
      details: { reason: 'unknown_user' },
    });

    const page = await audit.list({ entity: 'user', limit: 10, offset: 0 });

    expect(page.total).toBe(2);
    expect(page.items.map((e) => [e.action, e.username, e.details])).toEqual([
      ['auth.login_failed', null, { reason: 'unknown_user' }],
      ['auth.login_succeeded', 'ana', {}],
    ]);
  });
});
