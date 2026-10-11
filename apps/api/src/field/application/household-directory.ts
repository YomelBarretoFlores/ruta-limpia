/**
 * An enrolled household: a public code from its sticker and the reference point it uses. No
 * address, name or phone number is ever stored.
 */
export interface Household {
  readonly id: string;
  readonly code: string;
  readonly routeId: string;
  readonly pointId: string;
  readonly active: boolean;
}

/** Port: read access to the household registry (the panel manages it). */
export interface HouseholdDirectory {
  findByCode(code: string): Promise<Household | null>;
}
