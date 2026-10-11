import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakePasswordHasher,
  FakeStopwatch,
  InMemoryAuditLog,
  InMemoryKnownNetworkStore,
  InMemorySessionStore,
  InMemoryUserStore,
  SequentialSessionTokens,
} from '../../../test/fakes/in-memory-auth.js';
import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import type { Logger } from '../../shared/application/logger.js';
import { InMemoryLoginSourceStore } from '../infrastructure/in-memory-login-source-store.js';
import { ScryptPasswordHasher } from '../infrastructure/scrypt-password-hasher.js';
import { PasswordHasherBusyError, type PasswordHasher } from './auth-ports.js';
import { AuthService } from './auth-service.js';
import { VerificationTiming } from './verification-timing.js';

const T0 = new Date('2026-10-20T12:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const PASSWORD = 'correct horse battery';

let clock: ManualClock;
let users: InMemoryUserStore;
let sessions: InMemorySessionStore;
let hasher: FakePasswordHasher;
let audit: InMemoryAuditLog;
let knownNetworks: InMemoryKnownNetworkStore;
let sources: InMemoryLoginSourceStore;
let stopwatch: FakeStopwatch;
let warnings: { context: object; message: string | undefined }[];
let auth: AuthService;
let userId: string;

const OFFICE = '190.40.12.0/24';
const ELSEWHERE = '200.48.7.0/24';

beforeEach(async () => {
  clock = new ManualClock(T0);
  users = new InMemoryUserStore(() => clock.now());
  sessions = new InMemorySessionStore(users);
  hasher = new FakePasswordHasher();
  audit = new InMemoryAuditLog();
  knownNetworks = new InMemoryKnownNetworkStore();
  sources = new InMemoryLoginSourceStore(() => clock.now());
  stopwatch = new FakeStopwatch();
  warnings = [];
  auth = authWith(hasher);
  const created = await users.create({
    username: 'ana',
    displayName: 'Ana',
    role: 'supervisor',
    passwordHash: `hashed:${PASSWORD}`,
  });
  userId = created?.id ?? '';
});

function authWith(passwordHasher: PasswordHasher): AuthService {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (context, message) => warnings.push({ context, message }),
    error: () => undefined,
  };
  return new AuthService({
    users,
    sessions,
    sources,
    knownNetworks,
    hasher: passwordHasher,
    timing: new VerificationTiming(stopwatch),
    tokens: new SequentialSessionTokens(),
    audit,
    clock,
    logger,
    sessionPolicy: { idleMinutes: 30, absoluteHours: 2, touchIntervalSec: 60 },
  });
}

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

  const attempt = (password: string, clientNetwork = OFFICE, username = 'ana') =>
    auth.login({ username, password, clientNetwork });

  it('pauses a client network after five failures, answering like a wrong password', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await attempt('wrong password!')).status);
    expect(results).toEqual(Array<string>(5).fill('invalid_credentials'));
    expect(audit.actions().at(-1)).toBe('auth.account_locked');
    expect(audit.events.at(-1)?.details).toEqual({ reason: 'wrong_password', scope: 'source' });

    clock.set(minutes(14));
    // Even the right password is refused from the paused network, after as long a wait as a
    // check takes, without hashing.
    expect(await attempt(PASSWORD)).toEqual({ status: 'invalid_credentials' });
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.login_blocked',
      details: { reason: 'source_locked' },
    });
    expect(hasher.verifications).toBe(5);
    expect(stopwatch.sleeps).toHaveLength(1);

    clock.set(minutes(15));
    expect((await attempt(PASSWORD)).status).toBe('authenticated');
  });

  it('does not let failures from another network lock the owner out', async () => {
    for (let i = 0; i < 10; i++) await attempt('wrong password!', ELSEWHERE);

    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
  });

  const seconds = (n: number) => new Date(T0.getTime() + n * 1000);

  it('spaces out account attempts after 10 failures, refusing early ones at the same cost', async () => {
    // One failure from each of ten networks: no network is paused.
    for (let n = 0; n < 10; n++) await attempt('wrong password!', `10.0.${n}.0/24`);
    const verifications = hasher.verifications;

    // Even the right password, too early: refused like a wrong one, after as long a wait as a
    // recent check took (no hashing), so the timing does not reveal that the account exists.
    expect(await attempt(PASSWORD, OFFICE)).toEqual({ status: 'invalid_credentials' });
    expect(hasher.verifications).toBe(verifications);
    expect(stopwatch.sleeps).toHaveLength(1);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.login_blocked',
      details: { reason: 'account_throttled' },
    });
    expect(warnings.at(-1)).toEqual({
      context: { userId, scope: 'account_throttle', failedAttempts: 10 },
      message: 'Panel sign-in attempts spaced out after repeated failures',
    });

    clock.set(seconds(1));
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
  });

  it('checks only one of several attempts arriving together when an interval ends', async () => {
    for (let n = 0; n < 10; n++) await attempt('wrong password!', `10.0.${n}.0/24`);
    clock.set(seconds(1));
    const checked: string[] = [];
    hasher.onVerify = (password) => {
      checked.push(password);
    };

    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => attempt(`wrong password ${n}`, `10.1.${n}.0/24`)),
    );

    expect(results.map((r) => r.status)).toEqual(Array<string>(4).fill('invalid_credentials'));
    expect(stopwatch.sleeps).toHaveLength(3);
    expect(users.rows.get(userId)).toMatchObject({ failedAttempts: 11 });
    expect(audit.events.filter((e) => e.details?.['reason'] === 'account_throttled')).toHaveLength(
      3,
    );
    expect(checked).toHaveLength(1);
  });

  it('gives a simultaneous burst from a known network at most its remaining budget of checks', async () => {
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const checked: string[] = [];
    hasher.onVerify = async (password) => {
      checked.push(password);
      await gate;
    };

    const burst = Array.from({ length: 8 }, (_, n) => attempt(`guess number ${n}`, OFFICE));
    await new Promise((resolve) => setTimeout(resolve, 10));
    open();
    const results = await Promise.all(burst);

    expect(results.map((r) => r.status)).toEqual(Array<string>(8).fill('invalid_credentials'));
    expect(checked).toHaveLength(5);
    expect(
      audit.events.filter((e) => e.details?.['reason'] === 'source_locked').map((e) => e.action),
    ).toEqual(Array<string>(3).fill('auth.login_blocked'));
    // The five checked failures paused the network; nothing is left in flight.
    expect(await sources.find(`${userId}|${OFFICE}`)).toMatchObject({ inFlight: 0 });
    expect(await attempt(PASSWORD, OFFICE)).toEqual({ status: 'invalid_credentials' });
  });

  it('gives back the reserved slot and the provisional place when the check is shed', async () => {
    for (let n = 0; n < 10; n++) await attempt('wrong password!', `10.0.${n}.0/24`);
    clock.set(seconds(1));
    hasher.onVerify = () => {
      hasher.onVerify = () => undefined;
      throw new PasswordHasherBusyError('queue_full');
    };

    await expect(attempt(PASSWORD, OFFICE)).rejects.toBeInstanceOf(PasswordHasherBusyError);
    expect(await sources.find(`${userId}|${OFFICE}`)).toMatchObject({ inFlight: 0 });

    // The shed request did not use the interval up: a retry right away is checked.
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
  });

  it('keeps other accounts signing in while a throttled account is flooded', async () => {
    // A real hasher with one slot and one waiting place: anything more is shed.
    const scrypt = new ScryptPasswordHasher({
      params: { logN: 10, r: 1, p: 1 },
      maxConcurrent: 1,
      maxQueued: 1,
    });
    auth = authWith(scrypt);
    const bob = await users.create({
      username: 'bob',
      displayName: 'Bob',
      role: 'supervisor',
      passwordHash: await scrypt.hash(PASSWORD),
    });
    const ana = users.rows.get(userId);
    if (ana === undefined || bob === null) throw new Error('missing users');
    Object.assign(ana, { failedAttempts: 16, windowFailures: 16, lastAttemptAt: T0 });
    stopwatch.holding = true;

    const flood = Array.from({ length: 20 }, (_, n) => attempt(PASSWORD, `10.2.${n}.0/24`));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const owner = await auth.login({ username: 'bob', password: PASSWORD, clientNetwork: OFFICE });
    stopwatch.release();

    expect(owner.status).toBe('authenticated');
    expect((await Promise.all(flood)).map((r) => r.status)).toEqual(
      Array<string>(20).fill('invalid_credentials'),
    );
    expect(stopwatch.sleeps).toHaveLength(20);
  });

  it('lets the owner sign in from a known network while an attacker keeps the interval running', async () => {
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
    for (let n = 0; n < 16; n++) {
      clock.set(minutes(n));
      await attempt('wrong password!', `10.0.${n}.0/24`);
    }

    // The attacker's network is throttled (the interval is 60 s now) ...
    expect(await attempt('another guess!', '10.9.9.0/24')).toEqual({
      status: 'invalid_credentials',
    });
    expect(audit.events.at(-1)?.details).toEqual({ reason: 'account_throttled' });
    // ... while the owner's known network is not, and signs in right away.
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
    // The owner's success ends the spacing but not the daily count.
    expect(users.rows.get(userId)).toMatchObject({ failedAttempts: 0, windowFailures: 16 });
  });

  it('forgets a known network 30 days after the last sign-in from it', async () => {
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
    clock.set(minutes(30 * 24 * 60 + 1));
    for (let n = 0; n < 10; n++) await attempt('wrong password!', `10.0.${n}.0/24`);

    expect(await attempt(PASSWORD, OFFICE)).toEqual({ status: 'invalid_credentials' });
    expect(audit.events.at(-1)?.details).toEqual({ reason: 'account_throttled' });
  });

  it('applies the per-network pause to known networks too', async () => {
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
    for (let i = 0; i < 5; i++) await attempt('wrong password!', OFFICE);

    expect(await attempt(PASSWORD, OFFICE)).toEqual({ status: 'invalid_credentials' });
    expect(audit.events.at(-1)?.details).toEqual({ reason: 'source_locked' });
  });

  it('remembers only networks of successful sign-ins, never without a client network', async () => {
    await attempt('wrong password!', ELSEWHERE);
    await auth.login({ username: 'ana', password: PASSWORD });
    expect(knownNetworks.lastSeen.size).toBe(0);

    await attempt(PASSWORD, OFFICE);
    expect([...knownNetworks.lastSeen.keys()]).toEqual([`${userId}|${OFFICE}`]);
  });

  it('pauses the whole account after 100 failures within 24 hours, until the window ends', async () => {
    for (let i = 0; i < 100; i++) {
      clock.set(minutes(i));
      await attempt('wrong password!', `10.${i}.0.0/24`);
    }
    expect(audit.events.at(-1)?.details).toEqual({ reason: 'wrong_password', scope: 'account' });

    clock.set(minutes(200));
    expect(await attempt(PASSWORD, OFFICE)).toEqual({ status: 'invalid_credentials' });
    expect(audit.events.at(-1)?.details).toEqual({ reason: 'account_locked' });
    clock.set(minutes(24 * 60));
    expect((await attempt(PASSWORD, OFFICE)).status).toBe('authenticated');
  });

  it('logs each pause without the username, the password or the client network', async () => {
    for (let i = 0; i < 5; i++) await attempt('wrong password!');

    expect(warnings).toEqual([
      {
        context: { userId, scope: 'source', lockoutMinutes: 15 },
        message: 'Panel sign-in paused after repeated failures',
      },
    ]);
    expect(JSON.stringify(warnings)).not.toMatch(/ana|wrong|190\.40/);
  });

  it('never answers differently for unknown usernames, however many attempts', async () => {
    const results = new Set<string>();
    for (let i = 0; i < 12; i++)
      results.add((await attempt('wrong password!', OFFICE, 'ghost')).status);

    expect([...results]).toEqual(['invalid_credentials']);
    expect(warnings).toEqual([]);
  });

  it('bounds oversized input: no lookup, a bounded dummy verification, a generic failure', async () => {
    const seen: string[] = [];
    hasher.onVerify = (password) => {
      seen.push(password);
    };

    const longName = await auth.login({ username: 'a'.repeat(100_000), password: PASSWORD });
    const longPassword = await auth.login({ username: 'ana', password: 'p'.repeat(100_000) });

    expect([longName, longPassword]).toEqual([
      { status: 'invalid_credentials' },
      { status: 'invalid_credentials' },
    ]);
    expect(seen.map((p) => p.length)).toEqual([PASSWORD.length, 512]);
    // An over-long password is never counted against the real account.
    expect(users.rows.get(userId)).toMatchObject({ failedAttempts: 0 });
  });

  it('refuses a correct password when a parallel attempt locked the account meanwhile', async () => {
    hasher.onVerify = () => {
      const row = users.rows.get(userId);
      if (row !== undefined) row.lockedUntil = minutes(15);
    };

    expect(await attempt(PASSWORD)).toEqual({ status: 'invalid_credentials' });
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.login_blocked',
      details: { reason: 'account_locked' },
    });
    expect(sessions.rows.size).toBe(0);
  });

  it('resets the failure counts after a successful login', async () => {
    for (let i = 0; i < 4; i++) await attempt('wrong password!');
    await attempt(PASSWORD);
    expect(users.rows.get(userId)).toMatchObject({ failedAttempts: 0, lockedUntil: null });

    // The network's count restarted too: four more failures do not pause it.
    for (let i = 0; i < 4; i++) await attempt('wrong password!');
    expect((await attempt(PASSWORD)).status).toBe('authenticated');
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
