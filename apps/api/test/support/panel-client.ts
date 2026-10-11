import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

import type { Role } from '../../src/auth/domain/role.js';
import { ScryptPasswordHasher } from '../../src/auth/infrastructure/scrypt-password-hasher.js';
import type { Api } from '../../src/composition-root.js';

/** Cheap scrypt parameters for integration tests (the defaults are covered by unit tests). */
export const TEST_PASSWORD_HASHER = new ScryptPasswordHasher({ params: { logN: 10, r: 8, p: 1 } });

export const TEST_PASSWORD = 'correct horse battery staple';

/** The headers a same-origin panel request sends on mutations. */
export const PANEL_HEADERS = {
  'x-requested-with': 'ruta-limpia',
  origin: 'https://rutalimpia.example.org',
};

/** Creates an active user through the administration use case and returns its id. */
export async function createPanelUser(api: Api, username: string, role: Role): Promise<string> {
  const result = await api.userAdmin.create(
    { username, displayName: username, role, password: TEST_PASSWORD },
    null,
  );
  if (result.status !== 'ok') throw new Error(`createPanelUser: ${result.status}`);
  return result.user.id;
}

/** `rl_session=<token>` from a response's Set-Cookie, for the next requests. */
export function sessionCookieOf(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === 'rl_session');
  if (cookie === undefined) throw new Error(`No session cookie (status ${response.statusCode})`);
  return `rl_session=${cookie.value}`;
}

export function login(
  app: FastifyInstance,
  username: string,
  password = TEST_PASSWORD,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/panel/auth/login',
    headers: PANEL_HEADERS,
    payload: { username, password },
  });
}

/** Logs in and returns a client that sends the session cookie and the CSRF headers. */
export async function panelClient(app: FastifyInstance, username: string) {
  const cookie = sessionCookieOf(await login(app, username));
  const request = (options: InjectOptions) =>
    app.inject({
      ...options,
      headers: { ...PANEL_HEADERS, cookie, ...(options.headers ?? {}) },
    });
  return {
    cookie,
    get: (url: string) => request({ method: 'GET', url }),
    post: (url: string, payload?: object) =>
      request({ method: 'POST', url, payload: payload ?? {} }),
    patch: (url: string, payload: object) => request({ method: 'PATCH', url, payload }),
    delete: (url: string) => request({ method: 'DELETE', url }),
  };
}

export type PanelClient = Awaited<ReturnType<typeof panelClient>>;
