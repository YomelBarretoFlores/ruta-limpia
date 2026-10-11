const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID. Lookups skip the query otherwise (PostgreSQL would raise an error). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
