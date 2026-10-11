/**
 * Household codes printed on the enrollment stickers: `H-001`, `H-002`, … (at least three digits;
 * `H-1000` follows `H-999`). A code identifies a household without any personal data.
 */
const GENERATED_CODE = /^H-(\d{3,})$/;

export function formatHouseholdCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Invalid household sequence ${sequence}`);
  }
  return `H-${String(sequence).padStart(3, '0')}`;
}

/** The sequence number of a generated code (`H-042` → 42); null for other codes. */
export function householdCodeSequence(code: string): number | null {
  const match = GENERATED_CODE.exec(code);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The code after the highest generated sequence so far (null when there is none). */
export function nextHouseholdCode(highestSequence: number | null): string {
  return formatHouseholdCode((highestSequence ?? 0) + 1);
}

/**
 * The link printed as a QR code on the sticker: it opens the citizen app with the household's
 * route, reference point and code preselected.
 */
export function householdStickerUrl(
  origin: string,
  household: { readonly code: string; readonly routeCode: string; readonly pointCode: string },
): string {
  const query = new URLSearchParams({
    r: household.routeCode,
    p: household.pointCode,
    h: household.code,
  });
  return `${origin.replace(/\/+$/, '')}/?${query.toString()}`;
}
