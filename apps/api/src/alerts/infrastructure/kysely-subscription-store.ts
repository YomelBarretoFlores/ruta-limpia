import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  ManagedSubscription,
  NewSubscription,
  RevokeReason,
  SubscriptionStore,
} from '../application/subscription-ports.js';

/** Web Push subscriptions in PostgreSQL (`push_subscriptions`). */
export class KyselySubscriptionStore implements SubscriptionStore {
  constructor(private readonly db: AppDatabase) {}

  async upsert(subscription: NewSubscription): Promise<{ id: string }> {
    const values = {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      point_id: subscription.pointId,
      household_id: subscription.householdId,
      consent_at: subscription.consentAt,
      consent_version: subscription.consentVersion,
      management_token_hash: subscription.managementTokenHash,
    };
    return this.db
      .insertInto('push_subscriptions')
      .values({ endpoint: subscription.endpoint, ...values })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          ...values,
          revoked_at: null,
          revoke_reason: null,
          consecutive_failures: 0,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async findManaged(subscriptionId: string): Promise<ManagedSubscription | null> {
    if (!isUuid(subscriptionId)) return null;
    const row = await this.db
      .selectFrom('push_subscriptions')
      .select(['id', 'management_token_hash', 'revoked_at'])
      .where('id', '=', subscriptionId)
      .executeTakeFirst();
    return row === undefined
      ? null
      : { id: row.id, managementTokenHash: row.management_token_hash, revokedAt: row.revoked_at };
  }

  async revokeWithToken(
    subscriptionId: string,
    managementTokenHash: string,
    reason: RevokeReason,
    at: Date,
  ): Promise<boolean> {
    if (!isUuid(subscriptionId)) return false;
    // One statement: the row lock taken by the UPDATE orders it with a concurrent upsert, and the
    // hash condition is re-checked on the latest row version.
    const result = await this.db
      .updateTable('push_subscriptions')
      .set((eb) => ({
        revoked_at: eb.fn.coalesce('revoked_at', eb.val(at)),
        revoke_reason: eb.fn.coalesce('revoke_reason', eb.val(reason)),
      }))
      .where('id', '=', subscriptionId)
      .where('management_token_hash', '=', managementTokenHash)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async confirmReceipt(alertId: string, subscriptionId: string, at: Date): Promise<boolean> {
    if (!isUuid(alertId) || !isUuid(subscriptionId)) return false;
    const result = await this.db
      .updateTable('alert_deliveries')
      .set((eb) => ({ received_at: eb.fn.coalesce('received_at', eb.val(at)) }))
      .where('alert_id', '=', alertId)
      .where('subscription_id', '=', subscriptionId)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
