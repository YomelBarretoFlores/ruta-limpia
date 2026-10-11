export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_HINT =
  'Al menos 12 caracteres, sin otras reglas: una frase larga es más segura que una palabra con símbolos.';

/** The rule of the API (counted in characters, not bytes); null when the password follows it. */
export function passwordError(password: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres (tiene ${length}).`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `La contraseña puede tener como máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  return null;
}
