/**
 * Username and password rules (OWASP ASVS L2: at least 12 characters, no composition rules, long
 * passphrases allowed). The upper bound only keeps hashing work bounded.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
/**
 * The same limit in UTF-16 code units (JavaScript string length): a code point takes at most two,
 * so this cheap check bounds the input before code points are counted or normalized.
 */
export const PASSWORD_MAX_UTF16_UNITS = PASSWORD_MAX_LENGTH * 2;
/** Raw username input accepted before trimming; a valid username has at most 32 characters. */
export const USERNAME_MAX_INPUT_LENGTH = 64;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/** Lower-case letters, digits, dot, dash and underscore (also enforced by the `users` table). */
const USERNAME = new RegExp(`^[a-z0-9._-]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`);

/** Usernames are case-insensitive: they are stored and compared in lower case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(normalized: string): boolean {
  return USERNAME.test(normalized);
}

/**
 * The normalized username of a login attempt, or null when it cannot be a valid username. The
 * length is checked before trimming or lower-casing, so oversized input costs nothing.
 */
export function loginUsername(raw: string): string | null {
  if (raw.length > USERNAME_MAX_INPUT_LENGTH) return null;
  const normalized = normalizeUsername(raw);
  return isValidUsername(normalized) ? normalized : null;
}

/**
 * The password of a login attempt, bounded before it reaches the hasher: `value` is never longer
 * than `PASSWORD_MAX_UTF16_UNITS`, and `withinLimit` is false when the input was cut or exceeds
 * the maximum length (such a password can never match a stored one).
 */
export function loginPassword(raw: string): {
  readonly value: string;
  readonly withinLimit: boolean;
} {
  if (raw.length > PASSWORD_MAX_UTF16_UNITS) {
    return { value: raw.slice(0, PASSWORD_MAX_UTF16_UNITS), withinLimit: false };
  }
  return { value: raw, withinLimit: [...raw].length <= PASSWORD_MAX_LENGTH };
}

export type PasswordProblem = 'too_short' | 'too_long';

/** Length is counted in Unicode code points, so a passphrase with accents is not penalized. */
export function passwordProblem(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  return null;
}
