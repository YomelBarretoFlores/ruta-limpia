import type { Logger } from '../../shared/application/logger.js';
import type { AlertNotifier, EmittedAlert } from '../application/alert-notifier.js';

/** Placeholder notifier until Web Push is wired in: it only logs the alert. */
export class LoggingAlertNotifier implements AlertNotifier {
  constructor(private readonly logger: Logger) {}

  notify(alert: EmittedAlert): Promise<void> {
    this.logger.info(
      {
        alertId: alert.alertId,
        tripId: alert.tripId,
        pointId: alert.pointId,
        communicatedPredictedPassAt: alert.communicatedPredictedPassAt.toISOString(),
        secondsRemaining: Math.round(alert.secondsRemainingAtEmission),
        insideTargetWindow: alert.insideTargetWindow,
      },
      'Proximity alert emitted (no delivery channel configured)',
    );
    return Promise.resolve();
  }
}
