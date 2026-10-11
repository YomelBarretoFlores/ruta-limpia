/**
 * Panel roles and what each may do. The matrix is the single source of truth: HTTP guards and use
 * cases ask `can(role, permission)`, never compare role names.
 */
export const ROLES = ['admin', 'supervisor', 'observer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'live:read',
  'vehicles:read',
  'trips:read',
  'trips:write',
  'incidents:read',
  'incidents:create',
  'incidents:update',
  'households:read',
  'households:write',
  'households:delete',
  /** Field instruments (observations, baseline logs) the user created. */
  'field:read_own',
  'field:write_own',
  /** Field instruments of anyone. */
  'field:read_all',
  'field:write_all',
  'users:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const SUPERVISOR: readonly Permission[] = [
  'live:read',
  'vehicles:read',
  'trips:read',
  'trips:write',
  'incidents:read',
  'incidents:create',
  'incidents:update',
  'households:read',
  'households:write',
  'field:read_own',
  'field:write_own',
  'field:read_all',
  'field:write_all',
];

const OBSERVER: readonly Permission[] = [
  'live:read',
  'incidents:create',
  'field:read_own',
  'field:write_own',
];

const MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  admin: new Set(PERMISSIONS),
  supervisor: new Set(SUPERVISOR),
  observer: new Set(OBSERVER),
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

/** Every permission of a role, in matrix order (the panel UI shows or hides features with it). */
export function permissionsOf(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => can(role, permission));
}
