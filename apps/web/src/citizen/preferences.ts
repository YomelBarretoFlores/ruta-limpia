import type { DeepLink } from './deep-link';

/** The household's choices, kept on this device only (never sent anywhere by themselves). */
export interface CitizenPreferences {
  readonly routeCode: string | null;
  readonly pointCode: string | null;
  readonly householdCode: string | null;
}

export const EMPTY_PREFERENCES: CitizenPreferences = {
  routeCode: null,
  pointCode: null,
  householdCode: null,
};

const KEY = 'ruta-limpia:preferences';

/** Reads the saved preferences; storage errors (private mode, quota) read as empty. */
export function loadPreferences(storage: Pick<Storage, 'getItem'>): CitizenPreferences {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return EMPTY_PREFERENCES;
    const value = JSON.parse(raw) as Partial<Record<keyof CitizenPreferences, unknown>>;
    return {
      routeCode: stringOrNull(value.routeCode),
      pointCode: stringOrNull(value.pointCode),
      householdCode: stringOrNull(value.householdCode),
    };
  } catch {
    return EMPTY_PREFERENCES;
  }
}

export function savePreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: CitizenPreferences,
): void {
  try {
    storage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Not persisting is acceptable: the QR link or a new choice sets them again.
  }
}

/** The deep link wins over the saved choices, part by part. */
export function mergeDeepLink(saved: CitizenPreferences, link: DeepLink): CitizenPreferences {
  const routeChanged = link.routeCode !== null && link.routeCode !== saved.routeCode;
  return {
    routeCode: link.routeCode ?? saved.routeCode,
    // A point belongs to its route: a new route without a point drops the saved point.
    pointCode: link.pointCode ?? (routeChanged ? null : saved.pointCode),
    householdCode: link.householdCode ?? saved.householdCode,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
