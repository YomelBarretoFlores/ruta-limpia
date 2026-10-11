/**
 * The QR sticker deep link: `/?r=RI-01&p=P08&h=H-001` preselects the route, the reference point
 * and the household code. Every part is optional; malformed values are ignored.
 */
export interface DeepLink {
  readonly routeCode: string | null;
  readonly pointCode: string | null;
  readonly householdCode: string | null;
}

/** Route and point codes as the API accepts them (it upper-cases them too). */
const CODE = /^[A-Za-z0-9-]{1,16}$/;
/** Household codes are printed on the sticker; the API accepts up to 20 characters. */
const HOUSEHOLD = /^[A-Za-z0-9-]{1,20}$/;

export function parseDeepLink(search: string | URLSearchParams): DeepLink {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return {
    routeCode: code(params.get('r'), CODE),
    pointCode: code(params.get('p'), CODE),
    householdCode: code(params.get('h'), HOUSEHOLD),
  };
}

function code(value: string | null, pattern: RegExp): string | null {
  const trimmed = value?.trim() ?? '';
  return pattern.test(trimmed) ? trimmed.toUpperCase() : null;
}
