import type { PanelUser, Permission, Role } from '../api/types';

/** Whether the user's role grants any of the permissions (the API decides; this only hides). */
export function canAny(user: Pick<PanelUser, 'permissions'>, permissions: readonly Permission[]) {
  return permissions.some((permission) => user.permissions.includes(permission));
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  observer: 'Observador',
};

/** The panel paths a sign-in may return to (never another site). */
export function safeReturnPath(value: string | null): string {
  return value !== null && /^\/panel(\/|$|\?)/.test(value) && !value.startsWith('//')
    ? value
    : '/panel';
}
