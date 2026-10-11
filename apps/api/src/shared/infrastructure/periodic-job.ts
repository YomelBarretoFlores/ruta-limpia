import type { Logger } from '../application/logger.js';

export interface PeriodicJobOptions {
  /** Used in the failure log, for example `Inactivity check` → "Inactivity check failed". */
  readonly name: string;
  readonly run: () => Promise<unknown>;
  readonly intervalMs: number;
  readonly logger: Logger;
}

/**
 * Runs work on a fixed interval. Runs never overlap, a failed run is logged and retried at the
 * next tick, and the timer does not keep the process alive.
 */
export class PeriodicJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: PeriodicJobOptions) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs);
    this.timer.unref();
  }

  /** Stops the timer and waits for a run in progress to finish. */
  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  runOnce(): Promise<void> {
    this.running ??= this.options
      .run()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.options.logger.error({ err: error }, `${this.options.name} failed`);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
