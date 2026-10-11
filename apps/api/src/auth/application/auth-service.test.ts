import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakePasswordHasher,
  InMemoryAuditLog,
  InMemorySessionStore,
  InMemoryUserStore,
  SequentialSessionTokens,
} from '../../../test/fakes/in-memory-auth.js';
import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { AuthService } from './auth-service.js';

const T0 = new Date('2026-10-20T12:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const PASSWORD = 'correct horse battery';

let clock: ManualClock;
let users: InMemoryUserStore;
let sessions: InMemorySessionStore;
let hasher: FakePasswordHasher;
let audit: InMemoryAuditLog;
let auth: AuthService;
let userId: string;

beforeEach(async () => {
  clock = new ManualClock(T0);
  users = new InMemoryUserStore(() => clock.now());
  sessions = new InMemorySessionStore(users);
  hasher = new FakePasswordHasher();
  audit = new InMemoryAuditLog();
  auth = new AuthService({
    users,
    sessions,
    hasher,
    tokens: new SequentialSessionTokens(),
    audit,
    clock,
    logger: SILENT_LOGGER,
    sessionPolicy: { idleMinutes: 30, absoluteHours: 2, touchIntervalSec: 60 },
  });
  const created = await users.create({
    username: 'ana',
    displayName: 'Ana',
    role: 'supervisor',
    passwordHash: `hashed:${PASSWORD}`,
  });
  userId = created?.id ?? '';
});

describe('AuthService.login', () => {
  it('opens a session for a valid, case-insensitive username', async () => {
    const result = await auth.login({ username: ' ANA ', password: PASSWORD });

    expect(result).toMatchObject({ status: 'authenticated', token: 'token-1', maxAgeSec: 7200 });
    expect([...sessions.rows.values()][0]).toMatchObject({ tokenHash: 'sha:token-1', userId });
    expect((await users.findById(userId))?.lastLoginAt).toEqual(T0);
    expect(audit.events.at(-1)).toMatchObject({ action: 'auth.login_succeeded', userId });
  });

  it('answers the same generic failure, at the same cost, for unknown users and wrong passwords', async () => {
    const unknown = await auth.login({ username: 'nobody', password: PASSWORD });
    const wrong = await auth.login({ username: 'ana', password: 'wrong password!' });
    const malformed = await auth.login({ username: 'a b', password: PASSWORD });

    expect([unknown, wrong, malformed]).toEqual([
      { status: 'invalid_credentials' },
      { status: 'invalid_credentials' },
      { status: 'invalid_credentials' },
    ]);
    expect(hasher.verifications).toBe(3);
    expect(audit.events.map((e) => [e.action, e.userId, e.details])).toEqual([
      ['auth.login_failed', null, { reason: 'unknown_user' }],
      ['auth.login_failed', userId, { reason: 'wrong_password' }],
      ['auth.login_failed', null, { reason: 'unknown_user' }],
    ]);
  });

  it('never stores the attempted username or password in the audit trail', async () => {
    await auth.login({ username: 'nobody', password: PASSWORD });

    expect(JSON.stringify(audit.events)).not.toMatch(/nobody|horse/);
  });

  it('rejects inactive users generically', async () => {
    await users.update(userId, { active: false });

    expect(await auth.login({ username: 'ana', password: PASSWORD })).toEqual({
      status: 'invalid_credentials',
    });
    expect(hasher.verifications).toBe(1);
  });

  it('locks the account at the fifth failure for 15 minutes, even for the right password', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push((await auth.login({ username: 'ana', password: 'wrong password!' })).status);
    }
    expect(results).toEqual([...Array<string>(4).fill('invalid_credentials'), 'account_locked']);
    expect(audit.actions().at(-1)).toBe('auth.account_locked');

    clock.set(minutes(14));
    expect(await auth.login({ username: 'ana', password: PASSWORD })).toEqual({
      status: 'account_locked',
    });
    expect(audit.actions().at(-1)).toBe('auth.login_blocked');
    expect(hasher.verifications).toBe(6);

    clock.set(minutes(15));
    expect((await auth.login({ username: 'ana', password: PASSWORD })).status).toBe(
      'authenticated',
    );
  });

  it('locks unknown usernames the same way, so lockout does not reveal which accounts exist', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push((await auth.login({ username: 'ghost', password: 'wrong password!' })).status);
    }

    expect(results).toEqual([
      ...Array<string>(4).fill('invalid_credentials'),
      'account_locked',
      'account_locked',
    ]);
  });

  it('resets the failure count after a successful login', async () => {
    for (let i = 0; i < 4; i++) await auth.login({ username: 'ana', password: 'wrong password!' });
    await auth.login({ username: 'ana', password: PASSWORD });

    expect(users.rows.get(userId)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('rotates the session: the cookie presented at login is revoked', async () => {
    const first = await auth.login({ username: 'ana', password: PASSWORD });
    const token = first.status === 'authenticated' ? first.token : '';
    const second = await auth.login({ username: 'ana', password: PASSWORD, previousToken: token });

    expect(second).toMatchObject({ status: 'authenticated', token: 'token-2' });
    expect(await auth.authenticate(token)).toBeNull();
    expect(await auth.authenticate('token-2')).not.toBeNull();
  });
});

describe('AuthService sessions', () => {
  async function loggedIn(): Promise<string> {
    const result = await auth.login({ username: 'ana', password: PASSWORD });
    if (result.status !== 'authenticated') throw new Error('login failed');
    return result.token;
  }

  it('authenticates a token and refreshes its last-seen time at most once a minute', async () => {
    const token = await loggedIn();
    clock.set(minutes(10));

    expect(await auth.authenticate(token)).toMatchObject({ user: { id: userId }, maxAgeSec: 6600 });
    expect([...sessions.rows.values()][0]?.lastSeenAt).toEqual(minutes(10));
  });

  it('expires an idle session and a session past its absolute lifetime', async () => {
    const token = await loggedIn();
    clock.set(minutes(29));
    expect(await auth.authenticate(token)).not.toBeNull();
    clock.set(minutes(59));
    expect(await auth.authenticate(token)).toBeNull();

    const busy = await loggedIn();
    for (let m = 70; m < 180; m += 20) {
      clock.set(minutes(m));
      expect(await auth.authenticate(busy)).not.toBeNull();
    }
    clock.set(minutes(59 + 120));
    expect(await auth.authenticate(busy)).toBeNull();
  });

  it('rejects unknown tokens and sessions of deactivated users', async () => {
    const token = await loggedIn();

    expect(await auth.authenticate('forged')).toBeNull();
    await users.update(userId, { active: false });
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('revokes the session on logout', async () => {
    const token = await loggedIn();
    const session = await auth.authenticate(token);
    if (session === null) throw new Error('no session');

    await auth.logout(session);

    expect(await auth.authenticate(token)).toBeNull();
    expect(audit.actions().at(-1)).toBe('auth.logout');
  });
});
