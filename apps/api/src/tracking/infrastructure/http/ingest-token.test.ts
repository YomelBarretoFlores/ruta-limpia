import { describe, expect, it } from 'vitest';

import { ingestTokenMatches } from './ingest-token.js';

const expected = 'f'.repeat(64);

describe('ingestTokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(ingestTokenMatches(expected, expected)).toBe(true);
    expect(ingestTokenMatches(`${expected}0`, expected)).toBe(false);
    expect(ingestTokenMatches('f'.repeat(63), expected)).toBe(false);
    expect(ingestTokenMatches('short', expected)).toBe(false);
  });

  it('rejects missing, empty and repeated headers', () => {
    expect(ingestTokenMatches(undefined, expected)).toBe(false);
    expect(ingestTokenMatches('', expected)).toBe(false);
    expect(ingestTokenMatches([expected, expected], expected)).toBe(false);
  });
});
