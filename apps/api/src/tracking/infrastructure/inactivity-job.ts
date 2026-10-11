import type { Logger } from '../../shared/application/logger.js';

export interface InactivityJobOptions {
  readonly closeInactiveTrips: () => Promise<unknown>;
  readonly intervalMs: number;
  readonly logger: Logger;
}

/**
 * Periodically aborts trips without fixes for too long. Runs never overlap, a failed run is logged
 * and retried at the next tick, and the timer does not keep the process alive.
 */
export class InactivityJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: InactivityJobOptions) {}

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
      .closeInactiveTrips()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'Inactivity check failed');
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
