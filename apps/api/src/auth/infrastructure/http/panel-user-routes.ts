import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AuditTrail } from '../../../shared/application/audit-log.js';
import {
  invalidRequest,
  pageQuerySchema,
  pageWindow,
  paged,
  sendError,
  uuidParamsSchema,
} from '../../../shared/infrastructure/http/panel-http.js';
import type { PanelUser } from '../../application/auth-ports.js';
import type {
  AdminActor,
  CreateUserCommand,
  UpdateUserCommand,
  UserCommandResult,
} from '../../application/user-admin-service.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_UTF16_UNITS,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  type PasswordProblem,
} from '../../domain/credentials.js';
import { ROLES } from '../../domain/role.js';
import { userProfile } from './panel-auth-routes.js';
import { actorOf, panelRoute } from './panel-guard.js';

/** The user administration use cases the HTTP adapter needs. */
export interface UserAdminUseCases {
  list(): Promise<PanelUser[]>;
  create(command: CreateUserCommand, actor: AdminActor): Promise<UserCommandResult>;
  update(userId: string, command: UpdateUserCommand, actor: AdminActor): Promise<UserCommandResult>;
}

export interface PanelUserRoutesOptions {
  readonly users: UserAdminUseCases;
  readonly audit: AuditTrail;
}

const displayName = z.string().trim().min(1).max(80);
// The length rules (in code points) are checked by the use case, which names the problem; this
// transport bound is the same maximum in UTF-16 units, so longer input is refused before hashing.
const password = z.string().min(1).max(PASSWORD_MAX_UTF16_UNITS);

const createBodySchema = z.object({
  username: z.string().min(1).max(64),
  displayName,
  role: z.enum(ROLES),
  password,
});

const updateBodySchema = z
  .strictObject({
    displayName: displayName.optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

const auditQuerySchema = pageQuerySchema.extend({
  entity: z.string().min(1).max(40).optional(),
  entityId: z.string().min(1).max(64).optional(),
});

const WEAK_PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Passwords have at most ${PASSWORD_MAX_LENGTH} characters.`,
};

const FAILURES = {
  invalid_username: [
    400,
    `Usernames have ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters: a-z, 0-9, dot, ` +
      'dash, underscore.',
  ],
  weak_password: [400, ''],
  username_taken: [409, 'This username is already taken.'],
  not_found: [404, 'There is no such user.'],
  cannot_modify_self: [409, 'You cannot change your own role or deactivate yourself.'],
} as const;

function sendUserResult(reply: FastifyReply, result: UserCommandResult, okStatus: number) {
  if (result.status === 'ok') return reply.code(okStatus).send({ user: userProfile(result.user) });
  const [status, generic] = FAILURES[result.status];
  const message =
    result.status === 'weak_password' ? WEAK_PASSWORD_MESSAGES[result.problem] : generic;
  return reply.code(status).send({
    error: result.status,
    message,
    ...(result.status === 'weak_password' ? { problem: result.problem } : {}),
  });
}

/**
 * User administration and the audit trail (registered under `/api/panel`, `users:manage`):
 *
 * - `GET /users` → `{ users }`;
 * - `POST /users` `{ username, displayName, role, password }` → 201 `{ user }`;
 * - `PATCH /users/:id` `{ displayName?, role?, active?, password? }` → 200 `{ user }`; a role
 *   change, a deactivation or a password reset ends the user's sessions;
 * - `GET /audit-events?entity=&entityId=&page=&pageSize=` → paged audit events, newest first.
 */
export const panelUserRoutes: FastifyPluginCallback<PanelUserRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.get('/users', panelRoute('users:manage'), async (_request, reply) => {
    const users = await options.users.list();
    return reply.send({ users: users.map(userProfile) });
  });

  app.post('/users', panelRoute('users:manage'), async (request, reply) => {
    const body = createBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const result = await options.users.create(body.data, { userId: actorOf(request).userId });
    return sendUserResult(reply, result, 201);
  });

  app.patch('/users/:id', panelRoute('users:manage'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 404, 'not_found', 'There is no such user.');
    const body = updateBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const result = await options.users.update(params.data.id, body.data, {
      userId: actorOf(request).userId,
    });
    return sendUserResult(reply, result, 200);
  });

  app.get('/audit-events', panelRoute('users:manage'), async (request, reply) => {
    const query = auditQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { items, total } = await options.audit.list({
      ...pageWindow(query.data),
      ...(query.data.entity === undefined ? {} : { entity: query.data.entity }),
      ...(query.data.entityId === undefined ? {} : { entityId: query.data.entityId }),
    });
    return reply.send(
      paged(
        items.map((event) => ({
          id: event.id,
          at: event.at.toISOString(),
          userId: event.userId,
          username: event.username,
          action: event.action,
          entity: event.entity,
          entityId: event.entityId,
          details: event.details ?? {},
        })),
        total,
        query.data,
      ),
    );
  });

  done();
};
