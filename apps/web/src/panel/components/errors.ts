import { ApiError } from '../../shared/http';

/** Messages for API error codes; each screen adds its own. */
export type ErrorMessages = Readonly<Record<string, string>>;

/**
 * A failed panel request in words: what happened and what to do. The screen's own messages for
 * API codes come first, then the general ones by status.
 */
export function errorMessage(error: unknown, messages: ErrorMessages = {}): string {
  if (!(error instanceof ApiError)) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  }
  if (error.code !== null && messages[error.code] !== undefined) return messages[error.code]!;
  switch (error.status) {
    case 400:
      return 'Algunos datos no son válidos. Revisa el formulario e intenta de nuevo.';
    case 401:
      return 'Tu sesión terminó. Ingresa de nuevo para continuar.';
    case 403:
      return 'Tu rol no permite esta acción.';
    case 404:
      return 'No se encontró el registro. Es posible que otra persona lo haya eliminado.';
    case 409:
      return 'El registro cambió mientras lo editabas. Vuelve a cargar la página.';
    case 503:
      return 'El servicio está ocupado. Intenta de nuevo en unos segundos.';
    default:
      return 'Ocurrió un error en el servidor. Intenta de nuevo en unos minutos.';
  }
}
