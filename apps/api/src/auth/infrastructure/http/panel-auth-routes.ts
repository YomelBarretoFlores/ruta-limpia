import type { FastifyError, FastifyInstance, FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { invalidRequest, iso, sendError } from '../../../shared/infrastructure/http/panel-http.js';
import { PasswordHasherBusyError, type PanelUser } from '../../application/auth-ports.js';
import type {
  AuthenticatedSession,
  LoginCommand,
  LoginResult,
} from '../../application/auth-service.js';
import type { LockoutPolicy } from '../../domain/lockout-policy.js';
import { permissionsOf } from '../../domain/role.js';
import { DEFAULT_MAX_HASH_WAIT_MS } from '../scrypt-password-hasher.js';
import { clientNetwork } from './client-network.js';
import {
  clearSessionCookie,
  panelRoute,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './panel-guard.js';

/** The authentication use cases the HTTP adapter needs. */
export interface PanelAuthUseCases {
  login(command: LoginCommand): Promise<LoginResult>;
  logout(session: AuthenticatedSession): Promise<void>;
}

export interface PanelAuthRoutesOptions {
  readonly auth: PanelAuthUseCases;
  readonly cookieSecure: boolean;
  /** Login attempts per client IP and minute. */
  readonly loginPerMinute: number;
  /** The lockout policy in force, quoted in the failure message. */
  readonly lockoutPolicy: LockoutPolicy;
}

/**
 * How long a client should wait after `503 auth_busy`: the longest a hash request waits in the
 * hasher's queue before it is shed, rounded up to whole seconds (linked to the hasher's bound).
 */
export const AUTH_BUSY_RETRY_AFTER_SEC = Math.ceil(DEFAULT_MAX_HASH_WAIT_MS / 1000);

/** Requests shed with `503 auth_busy` since the process started, by reason. */
export type AuthBusyCounts = Record<PasswordHasherBusyError['reason'], number>;

/**
 * Answers `503 auth_busy` with `Retry-After` when password hashing sheds load (login, user
 * creation, password reset); every other error goes to the parent handler. Install it on the
 * panel scope. Each shed request is counted and logged as a warning with its reason and the
 * running count (never the username, the password or the address), so operators can tell hasher
 * saturation from a client-side failure. Returns the live counts.
 */
export function installAuthBusyHandler(scope: FastifyInstance): Readonly<AuthBusyCounts> {
  const counts: AuthBusyCounts = { queue_full: 0, wait_timeout: 0 };
  scope.setErrorHandler((error: FastifyError, request, reply) => {
    if (!(error instanceof PasswordHasherBusyError)) throw error;
    counts[error.reason] += 1;
    request.log.warn(
      { reason: error.reason, shedSinceStart: counts[error.reason] },
      'Panel request shed: password hashing is busy',
    );
    return reply
      .code(503)
      .header('retry-after', String(AUTH_BUSY_RETRY_AFTER_SEC))
      .send({ error: 'auth_busy', message: 'Sign-in is busy; try again in a few seconds.' });
  });
  return counts;
}

const loginBodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

/** The JSON profile of a panel user (no password data, ever). */
export function userProfile(user: PanelUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    permissions: permissionsOf(user.role),
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: iso(user.lastLoginAt),
  };
}

/**
 * Panel authentication (registered under `/api/panel`):
 *
 * - `POST /auth/login` `{ username, password }` → 200 `{ user }` and the `rl_session` cookie;
 *   401 `invalid_credentials` (the same for unknown users, wrong passwords, inactive users and
 *   paused sign-in); 429 when the per-IP limit is exceeded; 503 `auth_busy` under overload;
 * - `POST /auth/logout` → 204, the session is revoked and the cookie cleared;
 * - `GET /auth/me` → 200 `{ user }` of the current session.
 */
export const panelAuthRoutes: FastifyPluginCallback<PanelAuthRoutesOptions> = (
  app,
  options,
  done,
) => {
  const pauseMinutes = Math.max(
    options.lockoutPolicy.perSource.lockoutMinutes,
    options.lockoutPolicy.perAccount.lockoutMinutes,
  );
  // One message for every failure: it may not say whether the account exists or is paused.
  const invalidCredentialsMessage =
    'Wrong username or password. After repeated failures, sign-in pauses for up to ' +
    `${pauseMinutes} minutes.`;

  app.post(
    '/auth/login',
    {
      config: {
        panel: 'public',
        rateLimit: { max: options.loginPerMinute, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const body = loginBodySchema.safeParse(request.body);
      if (!body.success) return invalidRequest(reply, body.error);
      const previousToken = request.cookies[SESSION_COOKIE];

      const result = await options.auth.login({
        username: body.data.username,
        password: body.data.password,
        ...(request.headers['user-agent'] === undefined
          ? {}
          : { userAgent: request.headers['user-agent'] }),
        ...(previousToken === undefined || previousToken === '' ? {} : { previousToken }),
        clientNetwork: clientNetwork(request.ip),
      });
      if (result.status === 'invalid_credentials') {
        return sendError(reply, 401, 'invalid_credentials', invalidCredentialsMessage);
      }
      reply.setCookie(
        SESSION_COOKIE,
        result.token,
        sessionCookieOptions(options.cookieSecure, result.maxAgeSec),
      );
      return reply.send({ user: userProfile(result.user) });
    },
  );

  app.post('/auth/logout', panelRoute('authenticated'), async (request, reply) => {
    const session = request.panelSession;
    if (session !== null) await options.auth.logout(session);
    clearSessionCookie(reply, options.cookieSecure);
    return reply.code(204).send();
  });

  app.get('/auth/me', panelRoute('authenticated'), (request, reply) => {
    const session = request.panelSession;
    if (session === null) return sendError(reply, 401, 'unauthenticated', 'Sign in.');
    return reply.send({ user: userProfile(session.user) });
  });

  done();
};
