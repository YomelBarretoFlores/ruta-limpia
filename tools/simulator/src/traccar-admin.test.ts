import { describe, expect, it } from 'vitest';

import type { Fetch } from './osmand.js';
import { bootstrapTraccar } from './traccar-admin.js';

const OPTIONS = {
  baseUrl: 'http://traccar:8082',
  email: 'admin@example.org',
  password: 's3cret-pass',
  deviceUniqueId: 'ruta-limpia-unidad-a',
  deviceName: 'Unidad A',
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly body: string | null;
}

/** A fake Traccar: `users` and `devices` it already has, and the answers it gives. */
function fakeTraccar(state: { users: number; devices: { id: number; uniqueId: string }[] }) {
  const calls: Call[] = [];
  const expected = `Basic ${Buffer.from('admin@example.org:s3cret-pass').toString('base64')}`;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  const fetchImpl: Fetch = (input, init = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const call = {
      method: init.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);
    if (call.path === '/api/server') return json({ id: 1, newServer: state.users === 0 });
    if (call.method === 'POST' && call.path === '/api/users') {
      state.users += 1;
      return json({ id: state.users, administrator: state.users === 1 });
    }
    if (call.authorization !== expected) return Promise.resolve(new Response('', { status: 401 }));
    if (call.method === 'GET' && url.pathname === '/api/devices') {
      const uniqueId = url.searchParams.get('uniqueId');
      return json(state.devices.filter((d) => d.uniqueId === uniqueId));
    }
    if (call.method === 'POST' && call.path === '/api/devices') {
      const device = { id: 40 + state.devices.length, ...(JSON.parse(call.body!) as object) };
      state.devices.push(device as { id: number; uniqueId: string });
      return json(device);
    }
    return Promise.resolve(new Response('', { status: 404 }));
  };
  return { calls, fetchImpl };
}

describe('bootstrapTraccar', () => {
  it('creates the first administrator and the device on a new server', async () => {
    const traccar = fakeTraccar({ users: 0, devices: [] });

    const result = await bootstrapTraccar({ ...OPTIONS, fetch: traccar.fetchImpl });

    expect(result).toEqual({ adminCreated: true, deviceCreated: true, deviceId: 40 });
    expect(traccar.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/server',
      'POST /api/users',
      'GET /api/devices?uniqueId=ruta-limpia-unidad-a',
      'POST /api/devices',
    ]);
    expect(JSON.parse(traccar.calls[1]!.body!)).toEqual({
      name: 'Administrador',
      email: 'admin@example.org',
      password: 's3cret-pass',
    });
    expect(JSON.parse(traccar.calls[3]!.body!)).toEqual({
      name: 'Unidad A',
      uniqueId: 'ruta-limpia-unidad-a',
    });
  });

  it('changes nothing when run again', async () => {
    const traccar = fakeTraccar({
      users: 1,
      devices: [{ id: 7, uniqueId: 'ruta-limpia-unidad-a' }],
    });

    const result = await bootstrapTraccar({ ...OPTIONS, fetch: traccar.fetchImpl });

    expect(result).toEqual({ adminCreated: false, deviceCreated: false, deviceId: 7 });
    expect(traccar.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('refuses wrong credentials without creating anything or echoing the password', async () => {
    const traccar = fakeTraccar({ users: 1, devices: [] });

    const failure = bootstrapTraccar({ ...OPTIONS, password: 'wrong', fetch: traccar.fetchImpl });

    await expect(failure).rejects.toThrow(/TRACCAR_ADMIN_EMAIL.*TRACCAR_ADMIN_PASSWORD/);
    await failure.catch((error: Error) => expect(error.message).not.toContain('wrong'));
    expect(traccar.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('asks for both credentials', async () => {
    const traccar = fakeTraccar({ users: 0, devices: [] });

    await expect(
      bootstrapTraccar({ ...OPTIONS, password: '', fetch: traccar.fetchImpl }),
    ).rejects.toThrow(/TRACCAR_ADMIN_PASSWORD/);
    expect(traccar.calls).toEqual([]);
  });
});
