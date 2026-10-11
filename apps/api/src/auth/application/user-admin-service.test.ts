import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakePasswordHasher,
  InMemoryAuditLog,
  InMemorySessionStore,
  InMemoryUserStore,
} from '../../../test/fakes/in-memory-auth.js';
import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import { ImmediateUnitOfWork } from '../../../test/fakes/unit-of-work.js';
import { openSession } from '../domain/session-policy.js';
import { UserAdminService } from './user-admin-service.js';

const T0 = new Date('2026-10-20T12:00:00Z');
const PASSWORD = 'correct horse battery';

let users: InMemoryUserStore;
let sessions: InMemorySessionStore;
let audit: InMemoryAuditLog;
let admin: UserAdminService;

beforeEach(() => {
  const clock = new ManualClock(T0);
  users = new InMemoryUserStore(() => T0);
  sessions = new InMemorySessionStore(users);
  audit = new InMemoryAuditLog();
  admin = new UserAdminService({
    users,
    transactions: new ImmediateUnitOfWork({ users, sessions, audit }),
    hasher: new FakePasswordHasher(),
    clock,
  });
});

async function createUser(username = 'Luis.Rojas', role: 'observer' | 'admin' = 'observer') {
  const result = await admin.create(
    { username, displayName: ' Luis Rojas ', role, password: PASSWORD },
    { userId: 'admin-1' },
  );
  if (result.status !== 'ok') throw new Error(result.status);
  return result.user;
}

function openSessionFor(userId: string) {
  return sessions.create({
    userId,
    tokenHash: `sha:${userId}`,
    times: openSession(T0, { idleMinutes: 30, absoluteHours: 2, touchIntervalSec: 60 }),
    userAgentClass: null,
  });
}

describe('UserAdminService', () => {
  it('creates a user with a normalized username and a hashed password', async () => {
    const user = await createUser();

    expect(user).toMatchObject({
      username: 'luis.rojas',
      displayName: 'Luis Rojas',
      role: 'observer',
    });
    expect(users.rows.get(user.id)?.passwordHash).toBe(`hashed:${PASSWORD}`);
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'user.created',
        userId: 'admin-1',
        entityId: user.id,
        details: { role: 'observer' },
      }),
    ]);
  });

  it('rejects invalid usernames, short passwords and taken usernames', async () => {
    await createUser();
    const base = { displayName: 'X', role: 'observer' as const, password: PASSWORD };

    expect(await admin.create({ ...base, username: 'a b' }, null)).toEqual({
      status: 'invalid_username',
    });
    expect(await admin.create({ ...base, username: 'maria', password: 'short' }, null)).toEqual({
      status: 'weak_password',
      problem: 'too_short',
    });
    expect(await admin.create({ ...base, username: 'LUIS.ROJAS' }, null)).toEqual({
      status: 'username_taken',
    });
  });

  it('marks command-line actions in the audit trail', async () => {
    await admin.create(
      { username: 'root.admin', displayName: 'Admin', role: 'admin', password: PASSWORD },
      null,
    );

    expect(audit.events[0]).toMatchObject({ userId: null, details: { role: 'admin', via: 'cli' } });
  });

  it('ends the sessions of a user whose role changes, who is deactivated or whose password is reset', async () => {
    const user = await createUser();
    for (const change of [
      { role: 'supervisor' as const },
      { active: false },
      { password: 'another long password' },
    ]) {
      await openSessionFor(user.id);
      expect(await admin.update(user.id, change, { userId: 'admin-1' })).toMatchObject({
        status: 'ok',
      });
      expect([...sessions.rows.values()].every((s) => s.revokedAt !== null)).toBe(true);
    }
    expect(users.rows.get(user.id)?.passwordHash).toBe('hashed:another long password');
  });

  it('keeps sessions when only the display name changes', async () => {
    const user = await createUser();
    await openSessionFor(user.id);

    await admin.update(user.id, { displayName: 'Luis R.' }, { userId: 'admin-1' });

    expect([...sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it('audits the fields that actually changed, never the password', async () => {
    const user = await createUser();

    await admin.update(
      user.id,
      { password: 'another long password', active: true, role: 'observer' },
      { userId: 'admin-1' },
    );
    await admin.update(
      user.id,
      { displayName: 'Luis Rojas', role: 'supervisor' },
      { userId: 'admin-1' },
    );

    const [reset, promoted] = audit.events.slice(-2);
    // Already active and already an observer: only the password changed.
    expect(reset).toMatchObject({ action: 'user.updated' });
    expect(reset?.details).toEqual({ fields: [], passwordReset: true });
    // The display name was already "Luis Rojas".
    expect(promoted?.details).toEqual({
      fields: ['role'],
      passwordReset: false,
      role: 'supervisor',
    });
    expect(JSON.stringify(audit.events)).not.toContain('another long password');
  });

  it('changes and audits nothing, and keeps sessions, when the request changes nothing', async () => {
    const user = await createUser();
    await openSessionFor(user.id);
    const before = audit.events.length;

    const result = await admin.update(
      user.id,
      { role: 'observer', active: true, displayName: ' Luis Rojas ' },
      { userId: 'admin-1' },
    );

    expect(result).toMatchObject({ status: 'ok', user: { role: 'observer', active: true } });
    expect(audit.events).toHaveLength(before);
    expect([...sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it('prevents an administrator from demoting or deactivating themselves', async () => {
    const self = await createUser('jefa', 'admin');

    expect(await admin.update(self.id, { role: 'observer' }, { userId: self.id })).toEqual({
      status: 'cannot_modify_self',
    });
    expect(await admin.update(self.id, { active: false }, { userId: self.id })).toEqual({
      status: 'cannot_modify_self',
    });
    expect(await admin.update(self.id, { displayName: 'Jefa' }, { userId: self.id })).toMatchObject(
      {
        status: 'ok',
      },
    );
  });

  it('reports unknown users and weak reset passwords', async () => {
    const user = await createUser();

    expect(await admin.update('missing', { active: false }, null)).toEqual({ status: 'not_found' });
    expect(await admin.update(user.id, { password: 'short' }, null)).toEqual({
      status: 'weak_password',
      problem: 'too_short',
    });
  });
});
