/** Source of the current time. Injected so use cases and jobs stay deterministic under test. */
export interface Clock {
  now(): Date;
}
