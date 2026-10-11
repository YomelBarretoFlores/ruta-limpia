import type { RouteCatalog } from '../../routes/application/route-catalog.js';
import type { LocatedReferencePoint } from '../../routes/domain/route.js';
import type { Clock } from '../../shared/application/clock.js';
import type { Logger } from '../../shared/application/logger.js';
import { runWithConcurrency } from '../../shared/application/run-with-concurrency.js';
import { buildProximityAlertMessage } from '../domain/proximity-alert-message.js';
import {
  classifyPushResponse,
  pushTopic,
  pushTtlSeconds,
  type PushDeliverySettings,
} from '../domain/push-delivery.js';
import type { AlertNotifier, EmittedAlert } from './alert-notifier.js';
import type { AlertDeliveryStore, PushGateway, PushTarget } from './push-ports.js';

export interface PushAlertNotifierDependencies {
  readonly deliveries: AlertDeliveryStore;
  readonly gateway: PushGateway;
  /** Point code and name for the message. */
  readonly routes: RouteCatalog;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly settings: PushDeliverySettings;
}

/**
 * Delivers an emitted alert as Web Push to every active subscription of its point, a few at a time.
 * Each push is logged in `alert_deliveries`. A gone subscription (404/410) is revoked as `expired`;
 * one that keeps failing is revoked after `maxConsecutiveFailures`. The alert's counts are
 * recomputed at the end. Errors are logged per subscription and never thrown to the caller.
 */
export class PushAlertNotifier implements AlertNotifier {
  constructor(private readonly deps: PushAlertNotifierDependencies) {}

  async notify(alert: EmittedAlert): Promise<void> {
    const route = await this.deps.routes.get(alert.routeId);
    const point = route?.points.find((p) => p.id === alert.pointId);
    if (point === undefined) {
      this.deps.logger.error(
        { alertId: alert.alertId, routeId: alert.routeId, pointId: alert.pointId },
        'Alert point not found; no push sent',
      );
      return;
    }

    const targets = await this.deps.deliveries.activeTargets(alert.pointId);
    await runWithConcurrency(targets, this.deps.settings.concurrency, (target) =>
      this.deliver(alert, point, target),
    );
    const counts = await this.deps.deliveries.refreshAlertCounts(alert.alertId);
    this.deps.logger.info(
      { alertId: alert.alertId, pointCode: point.code, ...counts },
      'Proximity alert dispatched',
    );
  }

  private async deliver(
    alert: EmittedAlert,
    point: LocatedReferencePoint,
    target: PushTarget,
  ): Promise<void> {
    const { deliveries, clock, logger, settings } = this.deps;
    const now = clock.now();
    const message = buildProximityAlertMessage({
      alertId: alert.alertId,
      subscriptionId: target.subscriptionId,
      pointCode: point.code,
      pointName: point.name,
      predictedPassAt: alert.communicatedPredictedPassAt,
      now,
    });
    const context = { alertId: alert.alertId, subscriptionId: target.subscriptionId };

    let httpStatus: number | null = null;
    try {
      ({ httpStatus } = await this.deps.gateway.send(target, JSON.stringify(message), {
        ttlSeconds: pushTtlSeconds(message.secondsRemaining, settings.minTtlSeconds),
        urgency: 'high',
        topic: pushTopic(point.code),
      }));
    } catch (error) {
      logger.warn({ ...context, err: error }, 'Push service unreachable');
    }

    try {
      const status = classifyPushResponse(httpStatus);
      await deliveries.recordDelivery({ ...context, status, httpStatus, sentAt: now });
      if (status === 'sent') {
        await deliveries.markSuccess(target.subscriptionId, now);
      } else if (status === 'expired') {
        await deliveries.revoke(target.subscriptionId, 'expired', now);
        logger.info({ ...context, httpStatus }, 'Push subscription expired and revoked');
      } else {
        const revoked = await deliveries.markFailure(
          target.subscriptionId,
          settings.maxConsecutiveFailures,
          now,
        );
        logger.warn({ ...context, httpStatus, revoked }, 'Push delivery failed');
      }
    } catch (error) {
      logger.error({ ...context, err: error }, 'Push delivery could not be recorded');
    }
  }
}
