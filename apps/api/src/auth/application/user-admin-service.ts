import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import {
  isValidUsername,
  normalizeUsername,
  passwordProblem,
  type PasswordProblem,
} from '../domain/credentials.js';
import type { Role } from '../domain/role.js';
import type {
  PanelUser,
  PasswordHasher,
  SessionStore,
  UserChanges,
  UserStore,
} from './auth-ports.js';

export interface UserAdminDependencies {
  readonly users: UserStore;
  readonly sessions: SessionStore;
  readonly hasher: PasswordHasher;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface CreateUserCommand {
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly password: string;
}

export interface UpdateUserCommand {
  readonly displayName?: string;
  readonly role?: Role;
  readonly active?: boolean;
  /** A new password set by the administrator (reset). */
  readonly password?: string;
}

export type UserCommandFailure =
  | { readonly status: 'invalid_username' }
  | { readonly status: 'weak_password'; readonly problem: PasswordProblem }
  | { readonly status: 'username_taken' }
  | { readonly status: 'not_found' }
  /** Administrators cannot demote or deactivate themselves (the panel would lose its admin). */
  | { readonly status: 'cannot_modify_self' };

export type UserCommandResult =
  { readonly status: 'ok'; readonly user: PanelUser } | UserCommandFailure;

/** Who performs an administrative action: a panel user, or the command line (null). */
export type AdminActor = { readonly userId: string } | null;

/** Panel user management (administrators) and the `user:create` command line. */
export class UserAdminService {
  constructor(private readonly deps: UserAdminDependencies) {}

  list(): Promise<PanelUser[]> {
    return this.deps.users.list();
  }

  async create(command: CreateUserCommand, actor: AdminActor): Promise<UserCommandResult> {
    const username = normalizeUsername(command.username);
    if (!isValidUsername(username)) return { status: 'invalid_username' };
    const problem = passwordProblem(command.password);
    if (problem !== null) return { status: 'weak_password', problem };

    const user = await this.deps.users.create({
      username,
      displayName: command.displayName.trim(),
      role: command.role,
      passwordHash: await this.deps.hasher.hash(command.password),
    });
    if (user === null) return { status: 'username_taken' };
    await this.record('user.created', actor, user.id, { role: user.role });
    return { status: 'ok', user };
  }

  async update(
    userId: string,
    command: UpdateUserCommand,
    actor: AdminActor,
  ): Promise<UserCommandResult> {
    if (command.password !== undefined) {
      const problem = passwordProblem(command.password);
      if (problem !== null) return { status: 'weak_password', problem };
    }
    const current = await this.deps.users.findById(userId);
    if (current === null) return { status: 'not_found' };
    const demotesSelf =
      actor?.userId === userId &&
      ((command.role !== undefined && command.role !== current.role) || command.active === false);
    if (demotesSelf) return { status: 'cannot_modify_self' };

    const changes: UserChanges = {
      ...(command.displayName === undefined ? {} : { displayName: command.displayName.trim() }),
      ...(command.role === undefined ? {} : { role: command.role }),
      ...(command.active === undefined ? {} : { active: command.active }),
      ...(command.password === undefined
        ? {}
        : { passwordHash: await this.deps.hasher.hash(command.password) }),
    };
    const user = await this.deps.users.update(userId, changes);
    if (user === null) return { status: 'not_found' };

    // A changed role, a deactivation or a password reset ends every open session of the user.
    const endsSessions =
      (changes.role !== undefined && changes.role !== current.role) ||
      changes.active === false ||
      changes.passwordHash !== undefined;
    if (endsSessions) await this.deps.sessions.revokeAllOf(userId, this.deps.clock.now());

    const fields = Object.keys(command).filter((key) => key !== 'password');
    await this.record('user.updated', actor, userId, {
      fields,
      passwordReset: command.password !== undefined,
      ...(changes.role === undefined ? {} : { role: changes.role }),
      ...(changes.active === undefined ? {} : { active: changes.active }),
    });
    return { status: 'ok', user };
  }

  private async record(
    action: string,
    actor: AdminActor,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({
      userId: actor?.userId ?? null,
      action,
      entity: 'user',
      entityId,
      at: this.deps.clock.now(),
      details: actor === null ? { ...details, via: 'cli' } : details,
    });
  }
}
