import type { Logger } from '../../shared/application/logger.js';
import { PeriodicJob } from '../../shared/infrastructure/periodic-job.js';

export interface InactivityJobOptions {
  readonly closeInactiveTrips: () => Promise<unknown>;
  readonly intervalMs: number;
  readonly logger: Logger;
}

/** Periodically aborts trips without fixes for too long (see `PeriodicJob` for the run rules). */
export class InactivityJob extends PeriodicJob {
  constructor(options: InactivityJobOptions) {
    super({
      name: 'Inactivity check',
      run: options.closeInactiveTrips,
      intervalMs: options.intervalMs,
      logger: options.logger,
    });
  }
}
