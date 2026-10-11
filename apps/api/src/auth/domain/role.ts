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
  /** The impact indicators (Tabla 16). */
  'indicators:read',
  /** Instrument 3, the household surveys (create, edit, import). */
  'surveys:read',
  'surveys:write',
  /** The CSV exports of the instruments, the indicators and the usage. */
  'exports:read',
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
  'indicators:read',
  'surveys:read',
  'surveys:write',
  'exports:read',
];

const OBSERVER: readonly Permission[] = [
  'live:read',
  'incidents:create',
  'field:read_own',
  'field:write_own',
  'indicators:read',
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
