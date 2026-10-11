import { describe, expect, it } from 'vitest';

import { summarizeTrack } from './track-summary.js';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 12, 0, seconds));

describe('summarizeTrack', () => {
  it('reports no gap and no off-route stretch without fixes', () => {
    expect(summarizeTrack([])).toEqual({ fixCount: 0, offRouteCount: 0, maxGapSec: null });
    expect(summarizeTrack([{ fixTime: at(0), offRoute: false }]).maxGapSec).toBeNull();
  });

  it('measures the longest gap between consecutive fixes, whatever their order', () => {
    const fixes = [0, 15, 30, 125, 140].map((s) => ({ fixTime: at(s), offRoute: false }));

    expect(summarizeTrack([...fixes].reverse())).toEqual({
      fixCount: 5,
      offRouteCount: 0,
      maxGapSec: 95,
    });
  });

  it('counts each off-route stretch once and ignores fixes not evaluated on the route', () => {
    const flags = [false, true, true, null, true, false, true, false];
    const fixes = flags.map((offRoute, i) => ({ fixTime: at(i * 15), offRoute }));

    expect(summarizeTrack(fixes).offRouteCount).toBe(2);
  });
});
