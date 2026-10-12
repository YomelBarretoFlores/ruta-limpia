import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { purgePersonalData } from '../../src/privacy/infrastructure/kysely-personal-data-purge.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { sql } from 'kysely';

import { connectTestDatabase, resetData } from './database.js';

const at = (iso: string) => new Date(iso);
/** The purge cutoff: 2026-11-20 at Lima midnight. */
const CUTOFF = at('2026-11-20T05:00:00Z');
const NOW = at('2028-01-10T12:00:00Z');

let db: AppDatabase;
let ids: Awaited<ReturnType<typeof seedPilot>>;

/**
 * A small pilot with records on both sides of the cutoff:
 * - H-001 active; H-002 inactive since 2026-11-05 (with notes); H-003 inactive since 2026-11-25.
 * - Subscriptions: `cancelled` (H-001, revoked 2026-11-12), `active` (H-001, last push
 *   2026-11-25), `dead` (never delivered, created 2026-11-01), `ofH2` (H-002, last push
 *   2026-11-22).
 * - Alerts A1 (2026-11-10, delivered to `cancelled` and `active`) and A2 (2026-11-25, to `active`).
 * - Views: H-001 before and after the cutoff, H-002 before and after it, one anonymous before it,
 *   and one after it from the `dead` subscription's device (opened after the cutoff, never pushed).
 */
async function seedPilot() {
  const { routeId, vehicleId } = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
  const points = await db.selectFrom('reference_points').select(['id', 'code']).execute();
  const point = (code: string) => points.find((p) => p.code === code)!.id;

  const household = (code: string, active: boolean, updatedAt: string, notes: string | null) =>
    db
      .insertInto('households')
      .values({
        code,
        route_id: routeId,
        point_id: point('P02'),
        enrolled_at: at('2026-10-25T15:00:00Z'),
        consent_at: at('2026-10-25T15:00:00Z'),
        consent_version: '2026-10-v1',
        active,
        notes,
        updated_at: at(updatedAt),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);
  const h1 = await household('H-001', true, '2026-11-01T15:00:00Z', null);
  const h2 = await household(
    'H-002',
    false,
    '2026-11-05T15:00:00Z',
    'Casa verde, frente al parque',
  );
  const h3 = await household('H-003', false, '2026-11-25T15:00:00Z', null);

  const subscription = (
    device: string,
    householdId: string | null,
    times: { revokedAt?: string; lastSuccessAt?: string },
  ) =>
    db
      .insertInto('push_subscriptions')
      .values({
        endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
        p256dh: 'p256dh',
        auth: 'auth',
        point_id: point('P02'),
        household_id: householdId,
        consent_at: at('2026-11-01T15:00:00Z'),
        consent_version: '2026-10-v1',
        management_token_hash: device,
        created_at: at('2026-11-01T15:00:00Z'),
        revoked_at: times.revokedAt === undefined ? null : at(times.revokedAt),
        revoke_reason: times.revokedAt === undefined ? null : 'user_cancelled',
        last_success_at: times.lastSuccessAt === undefined ? null : at(times.lastSuccessAt),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);
  const cancelled = await subscription('cancelled', h1, { revokedAt: '2026-11-12T15:00:00Z' });
  const active = await subscription('active', h1, { lastSuccessAt: '2026-11-25T12:00:00Z' });
  const dead = await subscription('dead', null, {});
  const ofH2 = await subscription('of-h2', h2, { lastSuccessAt: '2026-11-22T12:00:00Z' });

  const trip = (startedAt: string) =>
    db
      .insertInto('trips')
      .values({
        route_id: routeId,
        vehicle_id: vehicleId,
        status: 'completed',
        start_mode: 'auto',
        started_at: at(startedAt),
        ended_at: new Date(at(startedAt).getTime() + 3_600_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);
  const alert = (tripId: string, code: string, emittedAt: string, delivered: number) =>
    db
      .insertInto('alerts')
      .values({
        trip_id: tripId,
        point_id: point(code),
        emitted_at: at(emittedAt),
        communicated_predicted_pass_at: new Date(at(emittedAt).getTime() + 420_000),
        seconds_remaining_at_emission: 420,
        inside_target_window: true,
        recipients_count: delivered,
        delivered_count: delivered,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);
  const a1 = await alert(await trip('2026-11-10T12:00:00Z'), 'P01', '2026-11-10T12:10:00Z', 2);
  const a2 = await alert(await trip('2026-11-25T12:00:00Z'), 'P02', '2026-11-25T12:10:00Z', 1);
  const delivery = (alertId: string, subscriptionId: string, sentAt: string) => ({
    alert_id: alertId,
    subscription_id: subscriptionId,
    status: 'sent' as const,
    sent_at: at(sentAt),
    received_at: at(sentAt),
  });
  await db
    .insertInto('alert_deliveries')
    .values([
      delivery(a1, cancelled, '2026-11-10T12:10:01Z'),
      delivery(a1, active, '2026-11-10T12:10:01Z'),
      delivery(a2, active, '2026-11-25T12:10:01Z'),
    ])
    .execute();

  await db
    .insertInto('app_views')
    .values([
      {
        point_id: point('P02'),
        household_id: h1,
        subscription_id: active,
        viewed_at: at('2026-11-10T14:00:00Z'),
      },
      { point_id: point('P02'), household_id: h1, viewed_at: at('2026-11-25T14:00:00Z') },
      { point_id: point('P02'), household_id: h2, viewed_at: at('2026-11-03T14:00:00Z') },
      { point_id: point('P02'), household_id: h2, viewed_at: at('2026-11-25T14:00:00Z') },
      { point_id: point('P02'), household_id: null, viewed_at: at('2026-11-10T14:00:00Z') },
      {
        point_id: point('P02'),
        household_id: null,
        subscription_id: dead,
        viewed_at: at('2026-11-26T14:00:00Z'),
      },
    ])
    .execute();
  await db
    .insertInto('household_surveys')
    .values({
      household_id: h2,
      wave: 'pre',
      surveyed_on: '2026-10-28',
      q2_lead_time: 'gt_3h',
      created_at: at('2026-10-28T15:00:00Z'),
      updated_at: at('2026-10-28T15:00:00Z'),
    })
    .execute();

  return { h1, h2, h3, cancelled, active, dead, ofH2, a1, a2 };
}

/** Everything the purge may touch, in a stable order, to compare before and after. */
async function snapshot() {
  return {
    households: await db
      .selectFrom('households')
      .select(['id', 'code', 'notes', 'active'])
      .orderBy('enrolled_at')
      .orderBy('id')
      .execute(),
    subscriptions: await db
      .selectFrom('push_subscriptions')
      .select(['id', 'household_id', 'endpoint'])
      .orderBy('id')
      .execute(),
    deliveries: await db
      .selectFrom('alert_deliveries')
      .select(['alert_id', 'subscription_id', 'sent_at'])
      .orderBy('sent_at')
      .orderBy('subscription_id')
      .execute(),
    views: await db
      .selectFrom('app_views')
      .select(['household_id', 'subscription_id', 'viewed_at'])
      .orderBy('viewed_at')
      .orderBy('household_id')
      .execute(),
    alerts: await db
      .selectFrom('alerts')
      .select(['id', 'emitted_at', 'communicated_predicted_pass_at', 'delivered_count'])
      .orderBy('emitted_at')
      .execute(),
    surveys: await db.selectFrom('household_surveys').select(['household_id', 'wave']).execute(),
  };
}

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  ids = await seedPilot();
});

describe('purgePersonalData (PostGIS)', () => {
  it('removes the personal data older than the cutoff and keeps what the indicators need', async () => {
    const summary = await purgePersonalData(db, { cutoff: CUTOFF, now: NOW, dryRun: false });

    expect(summary).toEqual({
      householdsAnonymized: 1,
      // H-001's view with its subscription, and H-002's view, before the cutoff.
      viewsUnlinked: 2,
      // H-002's live subscription and its view after the cutoff.
      householdLinksCleared: 2,
      // The view after the cutoff from the deleted `dead` subscription.
      viewsOfDeletedSubscriptions: 1,
      deliveriesDeleted: 2,
      subscriptionsDeleted: 2,
    });
    const after = await snapshot();

    // H-002 (inactive before the cutoff) keeps its row and survey under an anonymous code.
    const h2 = after.households.find((h) => h.id === ids.h2)!;
    expect(h2.code).toMatch(/^ANON-[0-9A-F]{10}$/);
    expect(h2.notes).toBeNull();
    expect(after.households.find((h) => h.id === ids.h1)?.code).toBe('H-001');
    expect(after.households.find((h) => h.id === ids.h3)?.code).toBe('H-003');
    expect(after.surveys).toEqual([{ household_id: ids.h2, wave: 'pre' }]);

    // Ended subscriptions are gone with their endpoints; H-002's live one loses its link.
    expect(after.subscriptions.map((s) => s.id).sort()).toEqual([ids.active, ids.ofH2].sort());
    expect(after.subscriptions.find((s) => s.id === ids.ofH2)?.household_id).toBeNull();
    expect(after.subscriptions.find((s) => s.id === ids.active)?.household_id).toBe(ids.h1);

    // Deliveries before the cutoff are gone; the alert keeps its times and counts.
    expect(after.deliveries).toEqual([
      { alert_id: ids.a2, subscription_id: ids.active, sent_at: at('2026-11-25T12:10:01Z') },
    ]);
    expect(after.alerts.map((a) => a.delivered_count)).toEqual([2, 1]);

    // Views stay (point and time) but lose their household before the cutoff and for H-002, and
    // their link to a deleted subscription.
    expect(after.views).toEqual([
      { household_id: null, subscription_id: null, viewed_at: at('2026-11-03T14:00:00Z') },
      { household_id: null, subscription_id: null, viewed_at: at('2026-11-10T14:00:00Z') },
      { household_id: null, subscription_id: null, viewed_at: at('2026-11-10T14:00:00Z') },
      { household_id: ids.h1, subscription_id: null, viewed_at: at('2026-11-25T14:00:00Z') },
      { household_id: null, subscription_id: null, viewed_at: at('2026-11-25T14:00:00Z') },
      { household_id: null, subscription_id: null, viewed_at: at('2026-11-26T14:00:00Z') },
    ]);
  });

  it("deletes a subscription viewed after the cutoff without relying on the foreign key's ON DELETE", async () => {
    // Migration 0003 declares app_views.subscription_id ON DELETE SET NULL; the purge must not
    // depend on it. With a plain (NO ACTION) key, a remaining reference would abort the purge.
    await sql`
      ALTER TABLE app_views
        DROP CONSTRAINT app_views_subscription_id_fkey,
        ADD CONSTRAINT app_views_subscription_id_fkey
          FOREIGN KEY (subscription_id) REFERENCES push_subscriptions (id)`.execute(db);
    try {
      const summary = await purgePersonalData(db, { cutoff: CUTOFF, now: NOW, dryRun: false });

      expect(summary).toMatchObject({ viewsOfDeletedSubscriptions: 1, subscriptionsDeleted: 2 });
      const dead = await db
        .selectFrom('push_subscriptions')
        .select('id')
        .where('id', '=', ids.dead)
        .execute();
      expect(dead).toEqual([]);
    } finally {
      await sql`
        ALTER TABLE app_views
          DROP CONSTRAINT app_views_subscription_id_fkey,
          ADD CONSTRAINT app_views_subscription_id_fkey
            FOREIGN KEY (subscription_id) REFERENCES push_subscriptions (id) ON DELETE SET NULL`.execute(
        db,
      );
    }
  });

  it('records the purge in the audit trail, without any personal data', async () => {
    await purgePersonalData(db, { cutoff: CUTOFF, now: NOW, dryRun: false });

    const events = await db.selectFrom('audit_events').selectAll().execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: null,
      action: 'privacy.purge',
      entity: 'personal_data',
      entity_id: CUTOFF.toISOString(),
      at: NOW,
      details: { householdsAnonymized: 1, subscriptionsDeleted: 2, deliveriesDeleted: 2 },
    });
    expect(JSON.stringify(events[0]?.details)).not.toMatch(/H-00|fcm|parque/);
  });

  it('only reports in a dry run, changing nothing', async () => {
    const before = await snapshot();

    const summary = await purgePersonalData(db, { cutoff: CUTOFF, now: NOW, dryRun: true });

    expect(summary).toMatchObject({ householdsAnonymized: 1, subscriptionsDeleted: 2 });
    expect(await snapshot()).toEqual(before);
    expect(await db.selectFrom('audit_events').selectAll().execute()).toEqual([]);
  });

  it('changes nothing more when run again', async () => {
    await purgePersonalData(db, { cutoff: CUTOFF, now: NOW, dryRun: false });
    const once = await snapshot();

    const again = await purgePersonalData(db, { cutoff: CUTOFF, now: NOW, dryRun: false });

    expect(again).toEqual({
      householdsAnonymized: 0,
      viewsUnlinked: 0,
      householdLinksCleared: 0,
      viewsOfDeletedSubscriptions: 0,
      deliveriesDeleted: 0,
      subscriptionsDeleted: 0,
    });
    expect(await snapshot()).toEqual(once);
  });
});
