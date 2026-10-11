/** An HTTP answer outside 2xx, with the API's `error` code when the body carried one. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    /** The API's machine-readable `error` field (for example `household_route_mismatch`). */
    readonly code: string | null,
  ) {
    super(`HTTP ${status}${code === null ? '' : ` (${code})`}`);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Sends a request and parses the JSON answer. Throws `ApiError` for non-2xx answers and lets
 * network errors (`TypeError` from `fetch`) through. A 204 resolves to `undefined`.
 */
export async function requestJson<T>(fetchFn: FetchLike, url: string, init?: RequestInit) {
  const response = await fetchFn(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new ApiError(response.status, await errorCode(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}
