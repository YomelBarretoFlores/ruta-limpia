/** One received fix of a trip, as the trip history needs it. */
export interface TrackFix {
  readonly fixTime: Date;
  /** Null when the fix was not evaluated against the route (invalid or before the trip). */
  readonly offRoute: boolean | null;
}

export interface TrackSummary {
  readonly fixCount: number;
  /** Times the truck left the route (an off-route stretch counts once). */
  readonly offRouteCount: number;
  /** Longest time between two consecutive fixes, in whole seconds; null with fewer than two. */
  readonly maxGapSec: number | null;
}

/** Summarizes a trip's received fixes (any order) for the panel's trip history. */
export function summarizeTrack(fixes: readonly TrackFix[]): TrackSummary {
  const ordered = [...fixes].sort((a, b) => a.fixTime.getTime() - b.fixTime.getTime());
  let offRouteCount = 0;
  let wasOffRoute = false;
  let maxGapMs: number | null = null;
  for (const [index, fix] of ordered.entries()) {
    if (fix.offRoute !== null) {
      if (fix.offRoute && !wasOffRoute) offRouteCount += 1;
      wasOffRoute = fix.offRoute;
    }
    const previous = ordered[index - 1];
    if (previous !== undefined) {
      const gap = fix.fixTime.getTime() - previous.fixTime.getTime();
      maxGapMs = Math.max(maxGapMs ?? 0, gap);
    }
  }
  return {
    fixCount: ordered.length,
    offRouteCount,
    maxGapSec: maxGapMs === null ? null : Math.round(maxGapMs / 1000),
  };
}
