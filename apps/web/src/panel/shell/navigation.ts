import type { PanelUser, Permission } from '../api/types';
import { canAny } from '../session/permissions';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  /** Shown when the user's role has any of these permissions. */
  readonly anyOf: readonly Permission[];
}

const FIELD_READ: readonly Permission[] = ['field:read_own', 'field:read_all'];

/** The panel's sections, in navigation order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/panel/en-vivo', label: 'En vivo', anyOf: ['live:read'] },
  { to: '/panel/viajes', label: 'Viajes', anyOf: ['trips:read'] },
  { to: '/panel/incidencias', label: 'Incidencias', anyOf: ['incidents:read'] },
  { to: '/panel/hogares', label: 'Hogares', anyOf: ['households:read'] },
  { to: '/panel/fichas', label: 'Fichas de campo', anyOf: FIELD_READ },
  { to: '/panel/linea-base', label: 'Línea base', anyOf: FIELD_READ },
  { to: '/panel/encuestas', label: 'Encuestas', anyOf: ['surveys:read'] },
  { to: '/panel/indicadores', label: 'Indicadores', anyOf: ['indicators:read'] },
  { to: '/panel/exportaciones', label: 'Exportaciones', anyOf: ['exports:read'] },
  { to: '/panel/usuarios', label: 'Usuarios', anyOf: ['users:manage'] },
];

/** The sections the user's role may open; the others are not shown at all. */
export function visibleNavItems(
  user: Pick<PanelUser, 'permissions'>,
  items: readonly NavItem[] = NAV_ITEMS,
): readonly NavItem[] {
  return items.filter((item) => canAny(user, item.anyOf));
}
