import type { LoginState } from '../domain/lockout-policy.js';
import type { Role } from '../domain/role.js';
import type { SessionTimes, UserAgentClass } from '../domain/session-policy.js';

/** A panel user as the use cases see it; the password hash never leaves the store and hasher. */
export interface PanelUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
}

export interface UserCredentials extends LoginState {
  readonly user: PanelUser;
  readonly passwordHash: string;
}

export interface NewUser {
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly passwordHash: string;
}

export interface UserChanges {
  readonly displayName?: string;
  readonly role?: Role;
  readonly active?: boolean;
  readonly passwordHash?: string;
}

/** Port: the panel user registry. */
export interface UserStore {
  /** By normalized (lower-case) username. */
  findCredentials(username: string): Promise<UserCredentials | null>;
  findById(userId: string): Promise<PanelUser | null>;
  list(): Promise<PanelUser[]>;
  /** Null when the username is taken (case-insensitive). */
  create(user: NewUser): Promise<PanelUser | null>;
  /** Null when the user does not exist. */
  update(userId: string, changes: UserChanges): Promise<PanelUser | null>;
  /**
   * Read-modify-write of the login state under a row lock, so concurrent failures are all
   * counted. Returns what `change` returned.
   */
  modifyLoginState<T extends LoginState>(
    userId: string,
    change: (current: LoginState) => T,
  ): Promise<T>;
  recordLogin(userId: string, at: Date): Promise<void>;
}

export interface StoredSession extends SessionTimes {
  readonly id: string;
  readonly user: PanelUser;
}

/** Port: server-side sessions, looked up by the SHA-256 of their token. */
export interface SessionStore {
  create(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly times: SessionTimes;
    readonly userAgentClass: UserAgentClass | null;
  }): Promise<string>;
  findByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  touch(sessionId: string, at: Date): Promise<void>;
  /** Revokes one session; false when it was not active. */
  revoke(sessionId: string, at: Date): Promise<boolean>;
  revokeAllOf(userId: string, at: Date): Promise<number>;
  /** Deletes the user's sessions that ended before `before` (housekeeping at login). */
  purgeEndedOf(userId: string, before: Date): Promise<void>;
}

/** Port: password hashing (a slow, salted KDF). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
  /**
   * Burns the same work as `verify` against a throwaway hash, so a login of an unknown or
   * locked user takes as long as a real one (no user enumeration by timing).
   */
  verifyDummy(password: string): Promise<void>;
}

/** Port: session tokens. The raw token only ever travels in the cookie. */
export interface SessionTokens {
  generate(): { readonly token: string; readonly hash: string };
  hash(token: string): string;
}
