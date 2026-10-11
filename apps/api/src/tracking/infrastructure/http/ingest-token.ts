import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares the shared ingest secret in constant time. Both values are hashed first so inputs of
 * different lengths are compared without leaking the expected length (timingSafeEqual needs equal
 * lengths).
 */
export function ingestTokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
