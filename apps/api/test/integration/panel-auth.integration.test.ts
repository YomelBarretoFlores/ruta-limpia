import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import {
  createPanelUser,
  login,
  PANEL_HEADERS,
  panelClient,
  sessionCookieOf,
  type PanelClient,
  TEST_PASSWORD,
  TEST_PASSWORD_HASHER,
} from '../support/panel-client.js';
import { PasswordHasherBusyError } from '../../src/auth/application/auth-ports.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { connectTestDatabase, failAuditWritesOf, resetData } from './database.js';

const NOW = new Date('2026-10-20T12:00:00Z');

let db: AppDatabase;
let clock: ManualClock;
let api: Api;

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  clock = new ManualClock(NOW);
  if (api !== undefined) await api.app.close();
  // A fresh API per test: the per-network login failures live in memory.
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: 'silent' }),
    passwordHasher: TEST_PASSWORD_HASHER,
  });
  await createPanelUser(api, 'ana.admin', 'admin');
  await createPanelUser(api, 'sara.super', 'supervisor');
  await createPanelUser(api, 'omar.obs', 'observer');
});

const auditActions = async () =>
  (await db.selectFrom('audit_events').select('action').orderBy('id').execute()).map(
    (e) => e.action,
  );

describe('panel login (PostGIS)', () => {
  it('signs in with a hardened session cookie and returns the profile', async () => {
    const response = await login(api.app, 'Ana.Admin');

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      user: { username: string; role: string; permissions: string[] };
    }>();
    expect(body.user).toMatchObject({ username: 'ana.admin', role: 'admin' });
    expect(body.user.permissions).toContain('users:manage');
    expect(JSON.stringify(response.json())).not.toMatch(/hash|scrypt/i);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^rl_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('Path=/api/panel');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain(`Max-Age=${168 * 3600}`);
    expect(response.headers['cache-control']).toBe('no-store');

    const stored = await db.selectFrom('sessions').select('token_hash').execute();
    const token = /^rl_session=([^;]+)/.exec(setCookie)?.[1] ?? '';
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]?.token_hash).not.toBe(token);
    expect(await auditActions()).toContain('auth.login_succeeded');
  });

  it('answers the same 401 for an unknown user and a wrong password, and audits both', async () => {
    const unknown = await login(api.app, 'nobody.here');
    const wrong = await login(api.app, 'ana.admin', 'not the right password');

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(unknown.json()).toEqual({
      error: 'invalid_credentials',
      message:
        'Wrong username or password. After repeated failures, sign-in pauses for up to 15 minutes.',
    });
    expect(unknown.headers['set-cookie']).toBeUndefined();
    const events = await db
      .selectFrom('audit_events')
      .select(['action', 'user_id', 'details'])
      .orderBy('id')
      .execute();
    expect(events.slice(-2).map((e) => [e.action, e.details])).toEqual([
      ['auth.login_failed', { reason: 'unknown_user' }],
      ['auth.login_failed', { reason: 'wrong_password' }],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/nobody|not the right/);
  });

  const loginFrom = (remoteAddress: string, username: string, password = TEST_PASSWORD) =>
    api.app.inject({
      method: 'POST',
      url: '/api/panel/auth/login',
      headers: PANEL_HEADERS,
      payload: { username, password },
      remoteAddress,
    });

  it('pauses sign-in from a network after five failures, with the generic 401', async () => {
    const failures: number[] = [];
    for (let i = 0; i < 5; i++) {
      failures.push((await loginFrom('190.40.12.7', 'sara.super', 'wrong password!!')).statusCode);
    }
    expect(failures).toEqual([401, 401, 401, 401, 401]);

    // Paused for that network (another address of the same /24), even with the right password.
    const paused = await loginFrom('190.40.12.99', 'sara.super');
    expect(paused.statusCode).toBe(401);
    expect(paused.json()).toMatchObject({ error: 'invalid_credentials' });
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['auth.account_locked', 'auth.login_blocked']),
    );
    // The owner, on another network, still signs in.
    expect((await loginFrom('200.48.7.1', 'sara.super')).statusCode).toBe(200);

    clock.set(new Date(NOW.getTime() + 15 * 60_000));
    expect((await loginFrom('190.40.12.7', 'sara.super')).statusCode).toBe(200);
  });

  it('answers unknown usernames exactly like real ones, however many attempts', async () => {
    const answers = new Set<string>();
    for (let i = 0; i < 7; i++) {
      for (const username of ['ghost.user', 'sara.super']) {
        const response = await loginFrom('10.1.1.1', username, 'wrong password!!');
        answers.add(`${response.statusCode} ${response.body}`);
      }
    }

    expect(answers.size).toBe(1);
    expect([...answers][0]).toMatch(/^401 .*invalid_credentials/);
  });

  it('answers 503 auth_busy with Retry-After when password hashing sheds load', async () => {
    await api.app.close();
    const busy = () => Promise.reject(new PasswordHasherBusyError('queue_full'));
    api = await composeApi({
      config: TEST_API_CONFIG,
      db,
      clock,
      logger: pino({ level: 'silent' }),
      passwordHasher: { hash: busy, verify: busy, verifyDummy: busy },
    });

    const response = await login(api.app, 'ana.admin');

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toMatchObject({ error: 'auth_busy' });
  });

  it('rate-limits login attempts per client IP', async () => {
    await api.app.close();
    api = await composeApi({
      config: { ...TEST_API_CONFIG, loginRateLimitPerMinute: 2 },
      db,
      clock,
      logger: pino({ level: 'silent' }),
      passwordHasher: TEST_PASSWORD_HASHER,
    });

    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await login(api.app, 'ana.admin', 'nope')).statusCode);

    expect(statuses).toEqual([401, 401, 429]);
  });
});

describe('panel sessions and CSRF (PostGIS)', () => {
  it('serves the profile with the cookie, and 401 without it', async () => {
    const client = await panelClient(api.app, 'omar.obs');

    const me = await client.get('/api/panel/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        username: 'omar.obs',
        role: 'observer',
        permissions: ['live:read', 'incidents:create', 'field:read_own', 'field:write_own'],
      },
    });
    const anonymous = await api.app.inject({ method: 'GET', url: '/api/panel/auth/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('rejects a mutation without the X-Requested-With header, even with a valid cookie', async () => {
    const client = await panelClient(api.app, 'ana.admin');

    const response = await api.app.inject({
      method: 'POST',
      url: '/api/panel/auth/logout',
      headers: { cookie: client.cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'csrf_rejected' });
    expect((await client.get('/api/panel/auth/me')).statusCode).toBe(200);
  });

  it('rejects a mutation from a foreign Origin, and a login without the header', async () => {
    const client = await panelClient(api.app, 'ana.admin');

    const foreign = await api.app.inject({
      method: 'POST',
      url: '/api/panel/auth/logout',
      headers: { ...PANEL_HEADERS, origin: 'https://evil.example', cookie: client.cookie },
      payload: {},
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ error: 'csrf_rejected' });

    const bareLogin = await api.app.inject({
      method: 'POST',
      url: '/api/panel/auth/login',
      payload: { username: 'ana.admin', password: TEST_PASSWORD },
    });
    expect(bareLogin.statusCode).toBe(403);
  });

  it('revokes the session on logout and clears the cookie', async () => {
    const client = await panelClient(api.app, 'ana.admin');

    const logout = await client.post('/api/panel/auth/logout');

    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toMatch(/rl_session=;.*Expires=Thu, 01 Jan 1970/);
    expect((await client.get('/api/panel/auth/me')).statusCode).toBe(401);
    expect(await auditActions()).toContain('auth.logout');
  });

  it('rotates the session at login: the previous cookie stops working', async () => {
    const first = await panelClient(api.app, 'ana.admin');
    const again = await api.app.inject({
      method: 'POST',
      url: '/api/panel/auth/login',
      headers: { ...PANEL_HEADERS, cookie: first.cookie },
      payload: { username: 'ana.admin', password: TEST_PASSWORD },
    });

    expect(sessionCookieOf(again)).not.toBe(first.cookie);
    expect((await first.get('/api/panel/auth/me')).statusCode).toBe(401);
  });

  it('expires a session after the idle timeout', async () => {
    const client = await panelClient(api.app, 'ana.admin');

    clock.set(new Date(NOW.getTime() + 479 * 60_000));
    expect((await client.get('/api/panel/auth/me')).statusCode).toBe(200);
    clock.set(new Date(NOW.getTime() + (479 + 480) * 60_000));
    const expired = await client.get('/api/panel/auth/me');
    expect(expired.statusCode).toBe(401);
    expect(String(expired.headers['set-cookie'])).toMatch(/^rl_session=;/);
  });
});

describe('panel user administration (PostGIS)', () => {
  it('lets an administrator create, list and update users', async () => {
    const admin = await panelClient(api.app, 'ana.admin');

    const created = await admin.post('/api/panel/users', {
      username: 'Nuevo.Observador',
      displayName: 'Nuevo Observador',
      role: 'observer',
      password: 'a long enough passphrase',
    });
    expect(created.statusCode).toBe(201);
    const user = created.json<{ user: { id: string; username: string } }>().user;
    expect(user.username).toBe('nuevo.observador');

    const list = await admin.get('/api/panel/users');
    expect(list.json<{ users: { username: string }[] }>().users.map((u) => u.username)).toEqual([
      'ana.admin',
      'nuevo.observador',
      'omar.obs',
      'sara.super',
    ]);

    const updated = await admin.patch(`/api/panel/users/${user.id}`, { role: 'supervisor' });
    expect(updated.json()).toMatchObject({ user: { role: 'supervisor' } });
    expect(await auditActions()).toEqual(expect.arrayContaining(['user.created', 'user.updated']));
  });

  it('validates new users and refuses duplicates and self-demotion', async () => {
    const admin = await panelClient(api.app, 'ana.admin');
    const me = (await admin.get('/api/panel/auth/me')).json<{ user: { id: string } }>().user;
    const body = { username: 'x.user', displayName: 'X', role: 'observer', password: 'short' };

    expect((await admin.post('/api/panel/users', body)).json()).toMatchObject({
      error: 'weak_password',
      problem: 'too_short',
    });
    expect(
      (
        await admin.post('/api/panel/users', {
          ...body,
          username: 'OMAR.OBS',
          password: TEST_PASSWORD,
        })
      ).statusCode,
    ).toBe(409);
    expect((await admin.post('/api/panel/users', { ...body, role: 'root' })).statusCode).toBe(400);
    expect((await admin.patch(`/api/panel/users/${me.id}`, { active: false })).statusCode).toBe(
      409,
    );
  });

  it('ends the sessions of a deactivated user and refuses their next login', async () => {
    const admin = await panelClient(api.app, 'ana.admin');
    const observer = await panelClient(api.app, 'omar.obs');
    const users = (await admin.get('/api/panel/users')).json<{
      users: { id: string; username: string }[];
    }>();
    const omar = users.users.find((u) => u.username === 'omar.obs');

    await admin.patch(`/api/panel/users/${omar?.id ?? ''}`, { active: false });

    expect((await observer.get('/api/panel/auth/me')).statusCode).toBe(401);
    expect((await login(api.app, 'omar.obs')).statusCode).toBe(401);
  });

  async function userIdOf(admin: PanelClient, username: string): Promise<string> {
    const { users } = (await admin.get('/api/panel/users')).json<{
      users: { id: string; username: string }[];
    }>();
    return users.find((u) => u.username === username)?.id ?? '';
  }

  it('ends the sessions of a user whose role changes or whose password is reset', async () => {
    const admin = await panelClient(api.app, 'ana.admin');
    const supervisor = await panelClient(api.app, 'sara.super');
    const sara = await userIdOf(admin, 'sara.super');

    await admin.patch(`/api/panel/users/${sara}`, { role: 'observer' });
    expect((await supervisor.get('/api/panel/auth/me')).statusCode).toBe(401);

    const observer = await panelClient(api.app, 'sara.super');
    expect((await observer.get('/api/panel/auth/me')).statusCode).toBe(200);
    await admin.patch(`/api/panel/users/${sara}`, { password: 'a brand new passphrase' });
    expect((await observer.get('/api/panel/auth/me')).statusCode).toBe(401);
    expect((await login(api.app, 'sara.super')).statusCode).toBe(401);
    expect((await login(api.app, 'sara.super', 'a brand new passphrase')).statusCode).toBe(200);
  });

  it('rolls back a password reset, and keeps the sessions, when its audit event fails', async () => {
    const admin = await panelClient(api.app, 'ana.admin');
    const supervisor = await panelClient(api.app, 'sara.super');
    const sara = await userIdOf(admin, 'sara.super');

    const restore = await failAuditWritesOf(db, 'user.updated');
    try {
      const reset = await admin.patch(`/api/panel/users/${sara}`, {
        password: 'a brand new passphrase',
        role: 'observer',
      });
      expect(reset.statusCode).toBe(500);
    } finally {
      await restore();
    }

    expect((await supervisor.get('/api/panel/auth/me')).json()).toMatchObject({
      user: { role: 'supervisor' },
    });
    expect((await login(api.app, 'sara.super')).statusCode).toBe(200);
    expect(await auditActions()).not.toContain('user.updated');
  });

  it('forbids user management to supervisors and observers', async () => {
    for (const username of ['sara.super', 'omar.obs']) {
      const client = await panelClient(api.app, username);
      expect((await client.get('/api/panel/users')).statusCode).toBe(403);
      expect(
        (
          await client.post('/api/panel/users', {
            username: 'z.user',
            displayName: 'Z',
            role: 'admin',
            password: TEST_PASSWORD,
          })
        ).json(),
      ).toMatchObject({ error: 'forbidden' });
    }
  });

  it('lists the audit trail for administrators, newest first', async () => {
    const admin = await panelClient(api.app, 'ana.admin');

    const page = await admin.get('/api/panel/audit-events?entity=user&pageSize=2');

    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      page: 1,
      pageSize: 2,
      items: [{ action: 'auth.login_succeeded', username: 'ana.admin', entity: 'user' }, {}],
    });
    expect(page.json<{ total: number }>().total).toBeGreaterThanOrEqual(4);
  });
});
