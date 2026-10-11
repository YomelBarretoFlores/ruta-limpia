import type { PanelUser, Permission } from '../api/types';
import { canAny } from '../session/permissions';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  /** Shown when the user's role has any of these permissions. */
  readonly anyOf: readonly Permission[];
}

/** The panel's sections, in navigation order (each arrives with its screen). */
export const NAV_ITEMS: readonly NavItem[] = [];

/** The sections the user's role may open; the others are not shown at all. */
export function visibleNavItems(
  user: Pick<PanelUser, 'permissions'>,
  items: readonly NavItem[] = NAV_ITEMS,
): readonly NavItem[] {
  return items.filter((item) => canAny(user, item.anyOf));
}
