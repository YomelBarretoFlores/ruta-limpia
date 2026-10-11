import { ApiError } from '../../shared/http';

export const INVALID_CREDENTIALS_MESSAGE =
  'Usuario o contraseña incorrectos. Si fallas varias veces, el ingreso se pausa por unos minutos.';
export const AUTH_BUSY_MESSAGE = 'El servicio está ocupado. Intenta de nuevo en unos segundos.';

/** The sign-in failure in words: never says whether the user exists or is paused. */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return AUTH_BUSY_MESSAGE;
    if (error.status === 429) {
      return 'Hubo demasiados intentos desde esta red. Espera un minuto e intenta de nuevo.';
    }
    if (error.status === 401) return INVALID_CREDENTIALS_MESSAGE;
    return 'No se pudo ingresar por un error del servidor. Intenta de nuevo en unos minutos.';
  }
  return 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
}
