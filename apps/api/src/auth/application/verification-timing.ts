import type { Stopwatch } from '../../shared/application/stopwatch.js';

export interface VerificationTimingOptions {
  /** Recent verification durations kept. */
  readonly samples: number;
  /** The wait before any verification was measured. */
  readonly defaultMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * About one default-cost scrypt verification on the 2 GB host before anything was measured;
 * waits stay between a few milliseconds and a little more than the hasher's 5 s queue bound.
 */
export const DEFAULT_VERIFICATION_TIMING: VerificationTimingOptions = Object.freeze({
  samples: 32,
  defaultMs: 400,
  minMs: 5,
  maxMs: 6_000,
});

/**
 * Makes a refused sign-in take as long as a checked one without doing the hashing work.
 *
 * `measure` times each real password verification, as the caller sees it (queue wait included),
 * and keeps the most recent durations. `imitate` then waits one of them, picked at random, so a
 * refused attempt follows the same distribution of response times as a checked one, under load
 * too, while it costs no CPU, no memory and no place in the bounded hashing queue. A flood of
 * refused attempts therefore cannot make other accounts' sign-ins wait or be shed.
 */
export class VerificationTiming {
  private readonly durations: number[] = [];
  private next = 0;

  constructor(
    private readonly stopwatch: Stopwatch,
    private readonly options: VerificationTimingOptions = DEFAULT_VERIFICATION_TIMING,
    private readonly random: () => number = Math.random,
  ) {}

  /** Runs one real verification and records its duration when it completes. */
  async measure<T>(verification: () => Promise<T>): Promise<T> {
    const started = this.stopwatch.now();
    const result = await verification();
    this.record(this.stopwatch.now() - started);
    return result;
  }

  /** Waits as long as a recent verification took. */
  imitate(): Promise<void> {
    return this.stopwatch.sleep(this.typicalMs());
  }

  /** One of the recent durations, at random, within the bounds; the default before any. */
  typicalMs(): number {
    const { defaultMs, minMs, maxMs } = this.options;
    if (this.durations.length === 0) return defaultMs;
    const index = Math.min(
      Math.floor(this.random() * this.durations.length),
      this.durations.length - 1,
    );
    const picked = this.durations[index] ?? defaultMs;
    return Math.min(Math.max(picked, minMs), maxMs);
  }

  private record(durationMs: number): void {
    if (this.durations.length < this.options.samples) {
      this.durations.push(durationMs);
      return;
    }
    this.durations[this.next] = durationMs;
    this.next = (this.next + 1) % this.options.samples;
  }
}
