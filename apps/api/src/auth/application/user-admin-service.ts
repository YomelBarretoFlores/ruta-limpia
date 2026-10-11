import type { AuditLog } from '../../shared/application/audit-log.js';
import type { Clock } from '../../shared/application/clock.js';
import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
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

/** The ports a user change writes through, in one transaction with its audit event. */
export interface UserAdminTransaction {
  readonly users: UserStore;
  readonly sessions: SessionStore;
  readonly audit: AuditLog;
}

export interface UserAdminDependencies {
  /** Reads outside any transaction. */
  readonly users: UserStore;
  readonly transactions: UnitOfWork<UserAdminTransaction>;
  readonly hasher: PasswordHasher;
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

/**
 * Panel user management (administrators) and the `user:create` command line. Each change, the
 * sessions it ends and its audit event commit together; passwords are hashed before the
 * transaction opens, so no transaction waits for scrypt.
 */
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
    const passwordHash = await this.deps.hasher.hash(command.password);

    return this.deps.transactions.run(async ({ users, audit }) => {
      const user = await users.create({
        username,
        displayName: command.displayName.trim(),
        role: command.role,
        passwordHash,
      });
      if (user === null) return { status: 'username_taken' };
      await this.record(audit, 'user.created', actor, user.id, { role: user.role });
      return { status: 'ok', user };
    });
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
    if ((await this.deps.users.findById(userId)) === null) return { status: 'not_found' };
    const passwordHash =
      command.password === undefined ? undefined : await this.deps.hasher.hash(command.password);

    return this.deps.transactions.run(async ({ users, sessions, audit }) => {
      const current = await users.findById(userId);
      if (current === null) return { status: 'not_found' };
      const changes = changesOf(current, command, passwordHash);
      const demotesSelf =
        actor?.userId === userId && (changes.role !== undefined || changes.active === false);
      if (demotesSelf) return { status: 'cannot_modify_self' };

      const fields = (['displayName', 'role', 'active'] as const).filter(
        (field) => changes[field] !== undefined,
      );
      if (fields.length === 0 && passwordHash === undefined) return { status: 'ok', user: current };
      const user = await users.update(userId, changes);
      if (user === null) return { status: 'not_found' };

      // A changed role, a deactivation or a password reset ends every open session of the user.
      const endsSessions =
        changes.role !== undefined || changes.active === false || passwordHash !== undefined;
      if (endsSessions) await sessions.revokeAllOf(userId, this.deps.clock.now());

      await this.record(audit, 'user.updated', actor, userId, {
        fields,
        passwordReset: passwordHash !== undefined,
        ...(changes.role === undefined ? {} : { role: changes.role }),
        ...(changes.active === undefined ? {} : { active: changes.active }),
      });
      return { status: 'ok', user };
    });
  }

  private async record(
    audit: AuditLog,
    action: string,
    actor: AdminActor,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await audit.record({
      userId: actor?.userId ?? null,
      action,
      entity: 'user',
      entityId,
      at: this.deps.clock.now(),
      details: actor === null ? { ...details, via: 'cli' } : details,
    });
  }
}

/** The fields of `command` that differ from `current` (a real diff), plus a new password hash. */
function changesOf(
  current: PanelUser,
  command: UpdateUserCommand,
  passwordHash: string | undefined,
): UserChanges {
  const displayName = command.displayName?.trim();
  return {
    ...(displayName === undefined || displayName === current.displayName ? {} : { displayName }),
    ...(command.role === undefined || command.role === current.role ? {} : { role: command.role }),
    ...(command.active === undefined || command.active === current.active
      ? {}
      : { active: command.active }),
    ...(passwordHash === undefined ? {} : { passwordHash }),
  };
}
