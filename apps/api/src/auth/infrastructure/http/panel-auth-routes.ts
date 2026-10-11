import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { invalidRequest, iso, sendError } from '../../../shared/infrastructure/http/panel-http.js';
import type { PanelUser } from '../../application/auth-ports.js';
import type {
  AuthenticatedSession,
  LoginCommand,
  LoginResult,
} from '../../application/auth-service.js';
import { permissionsOf } from '../../domain/role.js';
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
 *   401 `invalid_credentials` (the same for unknown users, wrong passwords and inactive users);
 *   423 `account_locked`; 429 when the per-IP limit is exceeded;
 * - `POST /auth/logout` → 204, the session is revoked and the cookie cleared;
 * - `GET /auth/me` → 200 `{ user }` of the current session.
 */
export const panelAuthRoutes: FastifyPluginCallback<PanelAuthRoutesOptions> = (
  app,
  options,
  done,
) => {
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
      });
      if (result.status === 'invalid_credentials') {
        return sendError(reply, 401, 'invalid_credentials', 'Wrong username or password.');
      }
      if (result.status === 'account_locked') {
        return sendError(
          reply,
          423,
          'account_locked',
          'Too many failed attempts; try again in 15 minutes.',
        );
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
