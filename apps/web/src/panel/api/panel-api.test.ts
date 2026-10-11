import { describe, expect, it, vi } from 'vitest';

import { createPanelApi, PanelApiError, queryString } from './panel-api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(answer: Response = json(200, { user: { id: 'u-1' } })) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(answer.clone()));
  const onUnauthorized = vi.fn();
  const api = createPanelApi({ fetch, onUnauthorized });
  const sent = (call = 0) => {
    const [url, init] = fetch.mock.calls[call]!;
    return { url, init: init!, headers: new Headers(init!.headers) };
  };
  return { api, fetch, onUnauthorized, sent };
}

describe('createPanelApi', () => {
  it('sends the session cookie and the CSRF header on every mutating request', async () => {
    const { api, sent } = client(json(201, { incident: { id: 'i-1' } }));

    await api.createIncident({ kind: 'weather', routeCode: 'RI-01' });

    const { url, init, headers } = sent();
    expect(url).toBe('/api/panel/incidents');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(headers.get('X-Requested-With')).toBe('ruta-limpia');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'weather', routeCode: 'RI-01' });
  });

  it('sends the CSRF header on the login too, and no CSRF header on reads', async () => {
    const { api, sent } = client();

    await api.login('ana', 'a long passphrase');
    await api.me();

    expect(sent(0).headers.get('X-Requested-With')).toBe('ruta-limpia');
    expect(sent(1).headers.has('X-Requested-With')).toBe(false);
    expect(sent(1).init.credentials).toBe('include');
  });

  it('reports a lost session from any call, but not a failed login', async () => {
    const { api, onUnauthorized } = client(json(401, { error: 'unauthenticated' }));

    await expect(api.listUsers()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(onUnauthorized).toHaveBeenCalledOnce();

    await expect(api.login('ana', 'nope')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('keeps the busy code of a shed login and the problems of an inconsistent sheet', async () => {
    const busy = client(json(503, { error: 'auth_busy', message: 'Sign-in is busy' }));
    await expect(busy.api.login('ana', 'x')).rejects.toMatchObject({ code: 'auth_busy' });

    const invalid = client(
      json(422, { error: 'invalid_observation', problems: ['broken_bags_exceed_bags'] }),
    );
    const error = await invalid.api.deleteObservation('o-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PanelApiError);
    expect(error).toMatchObject({ problems: ['broken_bags_exceed_bags'] });

    const unreadable = client(new Response('<html>', { status: 502 }));
    await expect(unreadable.api.me()).rejects.toMatchObject({ status: 502, code: null });
  });

  it('builds list queries from the defined filters only', async () => {
    const { api, sent } = client(json(200, { items: [], page: 1, pageSize: 20, total: 0 }));

    await api.listTrips({ route: 'RI-01', status: undefined, from: '', page: 2 });

    expect(sent().url).toBe('/api/panel/trips?route=RI-01&page=2');
    expect(queryString({})).toBe('');
    expect(queryString({ active: false })).toBe('?active=false');
  });
});
