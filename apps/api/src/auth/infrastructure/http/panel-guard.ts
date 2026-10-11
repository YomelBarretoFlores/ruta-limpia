import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthenticatedSession } from '../../application/auth-service.js';
import type { PanelActor } from '../../application/panel-actor.js';
import { checkCsrf } from '../../domain/csrf-policy.js';
import { can, type Permission, type Role } from '../../domain/role.js';

/**
 * Who may call a panel route:
 * - `public`: anyone (only the login);
 * - `authenticated`: any signed-in user;
 * - a permission, or `{ anyOf }` permissions, of the role matrix.
 * Routes without a rule require a session (fail closed).
 */
export type PanelAccess =
  'public' | 'authenticated' | Permission | { readonly anyOf: Permission[] };

declare module 'fastify' {
  interface FastifyContextConfig {
    panel?: PanelAccess;
  }
  interface FastifyRequest {
    /** The signed-in panel session; null on public routes and outside the panel. */
    panelSession: AuthenticatedSession | null;
  }
}

export const SESSION_COOKIE = 'rl_session';
export const PANEL_PREFIX = '/api/panel';

/** The use case the guard needs to resolve a cookie to a session. */
export interface SessionAuthenticator {
  authenticate(token: string): Promise<AuthenticatedSession | null>;
}

export interface PanelGuardOptions {
  readonly sessions: SessionAuthenticator;
  /** `Secure` flag of the session cookie (false only for plain-HTTP development). */
  readonly cookieSecure: boolean;
  /** Expected `Origin` of mutating requests; null accepts the requested host (development). */
  readonly publicOrigin: string | null;
}

/** Route options granting `access` (`app.get(url, panelRoute('trips:read'), handler)`). */
export function panelRoute(access: PanelAccess) {
  return { config: { panel: access } };
}

export function actorOf(request: FastifyRequest): PanelActor {
  const session = request.panelSession;
  if (session === null) throw new Error('Panel route reached without a session');
  return { userId: session.user.id, role: session.user.role };
}

export function sessionCookieOptions(secure: boolean, maxAgeSec: number) {
  return {
    path: PANEL_PREFIX,
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    maxAge: maxAgeSec,
  };
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(secure, 0), maxAge: undefined });
}

function allows(role: Role, access: PanelAccess): boolean {
  if (access === 'public' || access === 'authenticated') return true;
  if (typeof access === 'string') return can(role, access);
  return access.anyOf.some((permission) => can(role, permission));
}

/**
 * Installs the panel's security hooks on its (prefixed) scope, before any route of it:
 *
 * 1. every answer is `Cache-Control: no-store`;
 * 2. mutating requests pass the CSRF check (header `X-Requested-With: ruta-limpia`, and a
 *    present `Origin` must be the public origin) or get `403 csrf_rejected`;
 * 3. non-public routes need a valid session cookie (`401 unauthenticated`, and the stale cookie is
 *    cleared) and a role that holds the route's permission (`403 forbidden`).
 */
export async function installPanelGuard(
  scope: FastifyInstance,
  options: PanelGuardOptions,
): Promise<void> {
  await scope.register(cookie);
  scope.decorateRequest('panelSession', null);

  scope.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  scope.addHook('onRequest', async (request, reply) => {
    const verdict = checkCsrf({
      method: request.method,
      requestedWith: request.headers['x-requested-with'] as string | undefined,
      origin: request.headers.origin,
      host: request.headers.host,
      publicOrigin: options.publicOrigin,
    });
    if (!verdict.allowed) {
      request.log.warn(
        { reason: verdict.reason, url: request.url },
        'Panel request rejected (CSRF)',
      );
      return reply.code(403).send({
        error: 'csrf_rejected',
        message: 'Missing X-Requested-With header or foreign Origin.',
      });
    }

    const access = request.routeOptions.config.panel ?? 'authenticated';
    if (access === 'public') return;

    const token = request.cookies[SESSION_COOKIE];
    const session =
      token === undefined || token === '' ? null : await options.sessions.authenticate(token);
    if (session === null) {
      if (token !== undefined) clearSessionCookie(reply, options.cookieSecure);
      return reply
        .code(401)
        .send({ error: 'unauthenticated', message: 'Sign in to use the panel.' });
    }
    if (!allows(session.user.role, access)) {
      return reply
        .code(403)
        .send({ error: 'forbidden', message: 'Your role does not allow this action.' });
    }
    request.panelSession = session;
  });
}
