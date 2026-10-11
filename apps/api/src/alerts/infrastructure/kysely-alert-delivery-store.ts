import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type {
  AlertDeliveryStore,
  DeliveryCounts,
  NewDelivery,
  PushTarget,
} from '../application/push-ports.js';
import type { RevokeReason } from '../application/subscription-ports.js';

/** Push targets and the delivery log in PostgreSQL (`push_subscriptions`, `alert_deliveries`). */
export class KyselyAlertDeliveryStore implements AlertDeliveryStore {
  constructor(private readonly db: AppDatabase) {}

  activeTargets(pointId: string): Promise<PushTarget[]> {
    return this.db
      .selectFrom('push_subscriptions')
      .select(['id as subscriptionId', 'endpoint', 'p256dh', 'auth'])
      .where('point_id', '=', pointId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at')
      .execute();
  }

  async recordDelivery(delivery: NewDelivery): Promise<void> {
    await this.db
      .insertInto('alert_deliveries')
      .values({
        alert_id: delivery.alertId,
        subscription_id: delivery.subscriptionId,
        status: delivery.status,
        http_status: delivery.httpStatus,
        sent_at: delivery.sentAt,
      })
      .onConflict((oc) => oc.columns(['alert_id', 'subscription_id']).doNothing())
      .execute();
  }

  async markSuccess(subscriptionId: string, at: Date): Promise<void> {
    await this.db
      .updateTable('push_subscriptions')
      .set({ last_success_at: at, consecutive_failures: 0 })
      .where('id', '=', subscriptionId)
      .execute();
  }

  async markFailure(
    subscriptionId: string,
    maxConsecutiveFailures: number,
    at: Date,
  ): Promise<boolean> {
    // One statement, so concurrent failures of the same subscription count correctly; the CTE keeps
    // the previous revocation to tell "revoked now" from "already revoked".
    const revokeNow = sql`s.revoked_at IS NULL AND s.consecutive_failures + 1 >= ${maxConsecutiveFailures}`;
    const result = await sql<{ revoked_now: boolean }>`
      WITH previous AS (
        SELECT id, revoked_at FROM push_subscriptions WHERE id = ${subscriptionId} FOR UPDATE
      )
      UPDATE push_subscriptions AS s SET
        consecutive_failures = s.consecutive_failures + 1,
        revoked_at = CASE WHEN ${revokeNow} THEN ${at}::timestamptz ELSE s.revoked_at END,
        revoke_reason = CASE WHEN ${revokeNow} THEN 'too_many_failures' ELSE s.revoke_reason END
      FROM previous
      WHERE s.id = previous.id
      RETURNING (previous.revoked_at IS NULL AND s.revoked_at IS NOT NULL) AS revoked_now`.execute(
      this.db,
    );
    return result.rows[0]?.revoked_now === true;
  }

  async revoke(subscriptionId: string, reason: RevokeReason, at: Date): Promise<void> {
    await this.db
      .updateTable('push_subscriptions')
      .set({ revoked_at: at, revoke_reason: reason })
      .where('id', '=', subscriptionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async refreshAlertCounts(alertId: string): Promise<DeliveryCounts> {
    const row = await this.db
      .updateTable('alerts')
      .set((eb) => {
        const count = (statuses: readonly ('sent' | 'failed' | 'expired')[]) =>
          eb
            .selectFrom('alert_deliveries')
            .select((s) => s.fn.countAll<number>().as('n'))
            .where('alert_id', '=', alertId)
            .where('status', 'in', statuses);
        return {
          recipients_count: count(['sent', 'failed', 'expired']),
          delivered_count: count(['sent']),
          failed_count: count(['failed', 'expired']),
        };
      })
      .where('id', '=', alertId)
      .returning(['recipients_count', 'delivered_count', 'failed_count'])
      .executeTakeFirst();
    return {
      recipients: row?.recipients_count ?? 0,
      delivered: row?.delivered_count ?? 0,
      failed: row?.failed_count ?? 0,
    };
  }
}
