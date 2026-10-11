/**
 * Cross-site request forgery defense for the mutating panel routes, layered on top of the
 * `SameSite=Strict` session cookie:
 *
 * 1. the custom header `X-Requested-With: ruta-limpia` is required. A cross-site form cannot set it,
 *    and a cross-site `fetch` that sets it needs a CORS preflight, which the API never grants;
 * 2. when the browser sends `Origin`, it must be the panel's public origin (or, when no public
 *    origin is configured, the origin of the requested host).
 */
export const CSRF_HEADER_VALUE = 'ruta-limpia';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  readonly method: string;
  /** The `X-Requested-With` header. */
  readonly requestedWith: string | undefined;
  /** The `Origin` header. */
  readonly origin: string | undefined;
  /** The `Host` header (`host[:port]`). */
  readonly host: string | undefined;
  /** The configured public origin (`https://panel.example.org`); null in development. */
  readonly publicOrigin: string | null;
}

export type CsrfVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'missing_header' | 'foreign_origin' };

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function checkCsrf(input: CsrfInput): CsrfVerdict {
  if (!isMutatingMethod(input.method)) return { allowed: true };
  if (input.requestedWith !== CSRF_HEADER_VALUE) {
    return { allowed: false, reason: 'missing_header' };
  }
  if (input.origin === undefined) return { allowed: true };
  return originMatches(input.origin, input.publicOrigin, input.host)
    ? { allowed: true }
    : { allowed: false, reason: 'foreign_origin' };
}

function originMatches(origin: string, publicOrigin: string | null, host: string | undefined) {
  const actual = parseOrigin(origin);
  // `Origin: null` (sandboxed frames, some redirects) is never trusted.
  if (actual === null) return false;
  if (publicOrigin !== null) return actual.origin === parseOrigin(publicOrigin)?.origin;
  return host !== undefined && actual.host === host.toLowerCase();
}

function parseOrigin(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}
