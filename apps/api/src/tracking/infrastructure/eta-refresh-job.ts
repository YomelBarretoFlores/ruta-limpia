import type { Logger } from '../../shared/application/logger.js';
import { PeriodicJob } from '../../shared/infrastructure/periodic-job.js';

export interface EtaRefreshJobOptions {
  readonly refreshAll: () => Promise<unknown>;
  readonly intervalMs: number;
  readonly logger: Logger;
}

/**
 * Periodically republishes the ETAs of every active trip, so the live views count down and turn
 * stale between fixes (see `EtaRefreshService`).
 */
export class EtaRefreshJob extends PeriodicJob {
  constructor(options: EtaRefreshJobOptions) {
    super({
      name: 'ETA refresh',
      run: options.refreshAll,
      intervalMs: options.intervalMs,
      logger: options.logger,
    });
  }
}
