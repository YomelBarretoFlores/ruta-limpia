/** Trip progress (meters along the route) observed at a point in time. */
export interface ProgressSample {
  readonly chainage: number;
  readonly at: Date;
}
