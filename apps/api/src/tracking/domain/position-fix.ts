/** One GPS position reported by a vehicle tracker (normalized from Traccar). */
export interface PositionFix {
  readonly vehicleId: string;
  /** Time the device took the fix (not the time the server received it). */
  readonly fixTime: Date;
  readonly lat: number;
  readonly lon: number;
  readonly speedKmh: number;
  /** False when the device reports no valid GNSS solution. */
  readonly valid: boolean;
}

const KMH_PER_KNOT = 1.852;

/** Traccar reports speed in knots. */
export function knotsToKmh(knots: number): number {
  return knots * KMH_PER_KNOT;
}
