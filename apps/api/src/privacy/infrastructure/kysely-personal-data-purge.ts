import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';

/** What a purge removed (or, in a dry run, would remove). Rows are counted once, in one field. */
export interface PurgeSummary {
  /** Inactive households (last changed before the cutoff) given an anonymous code. */
  readonly householdsAnonymized: number;
  /** Views before the cutoff unlinked from their household and subscription (any household). */
  readonly viewsUnlinked: number;
  /**
   * Rows that still pointed to an anonymized household and lost that link: its subscriptions (any
   * date) and its views from the cutoff on (earlier views are counted in `viewsUnlinked`).
   */
  readonly householdLinksCleared: number;
  /**
   * Views from the cutoff on unlinked from a subscription this purge deletes, unless already
   * counted in `householdLinksCleared` (a view of an anonymized household loses both links there).
   */
  readonly viewsOfDeletedSubscriptions: number;
  /** Deliveries sent before the cutoff, or of a deleted subscription. */
  readonly deliveriesDeleted: number;
  /** Subscriptions (push endpoint and keys) whose last activity is before the cutoff. */
  readonly subscriptionsDeleted: number;
}

export interface PurgeOptions {
  readonly cutoff: Date;
  /** The time recorded in the audit event. */
  readonly now: Date;
  /** Count only: the changes run and are rolled back. */
  readonly dryRun: boolean;
}

/** Anonymous household codes: never a code the registry generates (`H-###`), never reused. */
const ANONYMOUS_PREFIX = 'ANON-';

class DryRunRollback extends Error {
  constructor(readonly summary: PurgeSummary) {
    super('dry run');
  }
}

/**
 * Purges the households' personal data older than `cutoff`, in one transaction (see
 * `docs/ops/data-retention.md`). Kept: trips, positions, passes, alerts (emission time,
 * communicated ETA, recipient/delivered/failed counts), incidents, field records, households
 * (route, point, dates, consent version) under anonymous codes, surveys, and views (point and
 * time). Running it again changes nothing more.
 */
export async function purgePersonalData(
  db: AppDatabase,
  options: PurgeOptions,
): Promise<PurgeSummary> {
  const { cutoff, now, dryRun } = options;
  try {
    return await db.transaction().execute(async (trx) => {
      // 1. Inactive households: an anonymous code, no free-text notes.
      const anonymized = await trx
        .updateTable('households')
        .set({
          code: sql<string>`${ANONYMOUS_PREFIX} || upper(substr(md5(gen_random_uuid()::text), 1, 10))`,
          notes: null,
        })
        .where('active', '=', false)
        .where('updated_at', '<', cutoff)
        .where('code', 'not like', `${ANONYMOUS_PREFIX}%`)
        .returning('id')
        .execute();
      const householdIds = anonymized.map((row) => row.id);

      // 2. Views before the cutoff keep their point and time only.
      const earlyViews = await trx
        .updateTable('app_views')
        .set({ household_id: null, subscription_id: null })
        .where('viewed_at', '<', cutoff)
        .where((eb) =>
          eb.or([eb('household_id', 'is not', null), eb('subscription_id', 'is not', null)]),
        )
        .executeTakeFirst();

      // Subscriptions whose last activity (revocation, else last push, else creation) is before
      // the cutoff: deleted in step 4.
      const ended = trx
        .selectFrom('push_subscriptions')
        .select('id')
        .where(sql<Date>`coalesce(revoked_at, last_success_at, created_at)`, '<', cutoff);

      // 3. Nothing later still points to the anonymized households. A later view of one also
      //    drops its link to an ended subscription here, so it is counted once.
      let householdLinksCleared = 0;
      if (householdIds.length > 0) {
        const subscriptionLinks = await trx
          .updateTable('push_subscriptions')
          .set({ household_id: null })
          .where('household_id', 'in', householdIds)
          .executeTakeFirst();
        const laterViewLinks = await trx
          .updateTable('app_views')
          .set((eb) => ({
            household_id: null,
            subscription_id: eb
              .case()
              .when('subscription_id', 'in', ended)
              .then(null)
              .else(eb.ref('subscription_id'))
              .end(),
          }))
          .where('household_id', 'in', householdIds)
          .executeTakeFirst();
        householdLinksCleared =
          Number(subscriptionLinks.numUpdatedRows) + Number(laterViewLinks.numUpdatedRows);
      }

      // 4. Ended subscriptions: every remaining reference to them (later views, deliveries),
      //    then the endpoint and keys themselves. References are cleared explicitly, whatever
      //    the foreign keys' ON DELETE action says.
      const viewsOfDeleted = await trx
        .updateTable('app_views')
        .set({ subscription_id: null })
        .where('subscription_id', 'in', ended)
        .executeTakeFirst();
      const deletedDeliveries = await trx
        .deleteFrom('alert_deliveries')
        .where((eb) => eb.or([eb('sent_at', '<', cutoff), eb('subscription_id', 'in', ended)]))
        .executeTakeFirst();
      const deletedSubscriptions = await trx
        .deleteFrom('push_subscriptions')
        .where('id', 'in', ended)
        .executeTakeFirst();

      const summary: PurgeSummary = {
        householdsAnonymized: householdIds.length,
        viewsUnlinked: Number(earlyViews.numUpdatedRows),
        householdLinksCleared,
        viewsOfDeletedSubscriptions: Number(viewsOfDeleted.numUpdatedRows),
        deliveriesDeleted: Number(deletedDeliveries.numDeletedRows),
        subscriptionsDeleted: Number(deletedSubscriptions.numDeletedRows),
      };
      if (dryRun) throw new DryRunRollback(summary);

      // Counts and the cutoff only: never a code, an endpoint or a note.
      await trx
        .insertInto('audit_events')
        .values({
          user_id: null,
          action: 'privacy.purge',
          entity: 'personal_data',
          entity_id: cutoff.toISOString(),
          at: now,
          details: JSON.stringify(summary),
        })
        .execute();
      return summary;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.summary;
    throw error;
  }
}
