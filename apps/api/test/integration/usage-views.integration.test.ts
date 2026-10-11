import { sql } from 'kysely';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG, browserSubscription } from '../support/api-config.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase, type SeedResult } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, resetData } from './database.js';

const NOW = new Date('2026-10-20T12:00:00Z');

let db: AppDatabase;
let api: Api;
let seeded: SeedResult;

function postView(body: object) {
  return api.app.inject({ method: 'POST', url: '/api/usage/views', payload: body });
}

const views = () =>
  db
    .selectFrom('app_views as v')
    .innerJoin('reference_points as p', 'p.id', 'v.point_id')
    .select(['p.code', 'v.subscription_id', 'v.household_id', 'v.viewed_at'])
    .execute();

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock: new ManualClock(NOW),
    logger: pino({ level: 'silent' }),
  });
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  seeded = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
});

describe('POST /api/usage/views (PostGIS)', () => {
  it('records an anonymous view without any client identifier', async () => {
    const response = await postView({ pointCode: 'p08' });

    expect(response.statusCode).toBe(204);
    expect(await views()).toEqual([
      { code: 'P08', subscription_id: null, household_id: null, viewed_at: NOW },
    ]);
    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'app_views'
      ORDER BY ordinal_position`.execute(db);
    expect(columns.rows.map((c) => c.column_name)).toEqual([
      'id',
      'point_id',
      'subscription_id',
      'household_id',
      'viewed_at',
    ]);
  });

  it('links the subscription and its household with a valid token, and only then', async () => {
    const p08 = await db
      .selectFrom('reference_points')
      .select('id')
      .where('code', '=', 'P08')
      .executeTakeFirstOrThrow();
    const household = await db
      .insertInto('households')
      .values({
        code: 'H-001',
        route_id: seeded.routeId,
        point_id: p08.id,
        enrolled_at: NOW,
        consent_at: NOW,
        consent_version: '2026-10',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const subscribed = await api.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      payload: {
        subscription: browserSubscription('device-1'),
        pointCode: 'P08',
        householdCode: 'H-001',
        consent: true,
        consentVersion: '2026-10',
      },
    });
    const { subscriptionId, managementToken } = subscribed.json<{
      subscriptionId: string;
      managementToken: string;
    }>();

    const valid = await postView({ pointCode: 'P09', subscriptionId, managementToken });
    const wrong = await postView({ pointCode: 'P09', subscriptionId, managementToken: 'wrong' });
    const unknown = await postView({
      pointCode: 'P09',
      subscriptionId: 'not-a-uuid',
      managementToken,
    });

    expect([valid.statusCode, wrong.statusCode, unknown.statusCode]).toEqual([204, 204, 204]);
    expect(await views()).toEqual([
      { code: 'P09', subscription_id: subscriptionId, household_id: household.id, viewed_at: NOW },
      { code: 'P09', subscription_id: null, household_id: null, viewed_at: NOW },
      { code: 'P09', subscription_id: null, household_id: null, viewed_at: NOW },
    ]);
  });

  it('rejects unknown points with 422 and malformed bodies with 400', async () => {
    expect((await postView({ pointCode: 'P99' })).statusCode).toBe(422);
    expect((await postView({ pointCode: 'P08', routeCode: 'XX-99' })).statusCode).toBe(422);
    expect((await postView({})).statusCode).toBe(400);
    expect((await postView({ pointCode: 'P 08' })).statusCode).toBe(400);
    expect(await views()).toEqual([]);
  });
});
