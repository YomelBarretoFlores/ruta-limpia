/**
 * Username and password rules (OWASP ASVS L2: at least 12 characters, no composition rules, long
 * passphrases allowed). The upper bound only keeps hashing work bounded.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

const USERNAME = /^[a-z0-9._-]{3,32}$/;

/** Usernames are case-insensitive: they are stored and compared in lower case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(normalized: string): boolean {
  return USERNAME.test(normalized);
}

export type PasswordProblem = 'too_short' | 'too_long';

/** Length is counted in Unicode code points, so a passphrase with accents is not penalized. */
export function passwordProblem(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  return null;
}
