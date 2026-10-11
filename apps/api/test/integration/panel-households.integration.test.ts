import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { browserSubscription, TEST_API_CONFIG } from '../support/api-config.js';
import {
  createPanelUser,
  panelClient,
  TEST_PASSWORD_HASHER,
  type PanelClient,
} from '../support/panel-client.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, resetData } from './database.js';

const NOW = new Date('2026-10-20T12:00:00Z');

interface HouseholdJson {
  code: string;
  routeCode: string;
  pointCode: string;
  active: boolean;
  consentVersion: string;
  notes: string | null;
  activeSubscriptions?: number;
  lastAppViewAt?: string | null;
}

let db: AppDatabase;
let api: Api;
let admin: PanelClient;
let supervisor: PanelClient;
let observer: PanelClient;

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
  if (api !== undefined) await api.app.close();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock: new ManualClock(NOW),
    logger: pino({ level: 'silent' }),
    passwordHasher: TEST_PASSWORD_HASHER,
  });
  await createPanelUser(api, 'ana.admin', 'admin');
  await createPanelUser(api, 'sara.super', 'supervisor');
  await createPanelUser(api, 'omar.obs', 'observer');
  admin = await panelClient(api.app, 'ana.admin');
  supervisor = await panelClient(api.app, 'sara.super');
  observer = await panelClient(api.app, 'omar.obs');
});

const enroll = async (pointCode = 'P08', extra: object = {}) => {
  const response = await supervisor.post('/api/panel/households', {
    routeCode: 'RI-01',
    pointCode,
    ...extra,
  });
  return { response, household: response.json<{ household: HouseholdJson }>().household };
};

describe('panel household registry (PostGIS)', () => {
  it('enrolls households with consecutive H-### codes and records consent', async () => {
    const first = await enroll('P08', { notes: 'Door with blue gate' });
    const second = await enroll('p09', { consentAt: '2026-10-19T09:30:00-05:00' });

    expect(first.response.statusCode).toBe(201);
    expect(first.household).toMatchObject({
      code: 'H-001',
      routeCode: 'RI-01',
      pointCode: 'P08',
      active: true,
      consentAt: NOW.toISOString(),
      consentVersion: 'enrollment-2026-10',
      notes: 'Door with blue gate',
    });
    expect(second.household).toMatchObject({
      code: 'H-002',
      pointCode: 'P09',
      consentAt: '2026-10-19T14:30:00.000Z',
    });
    expect(
      await db
        .selectFrom('audit_events')
        .select(['action', 'entity_id'])
        .where('entity', '=', 'household')
        .execute(),
    ).toEqual([
      { action: 'household.created', entity_id: 'H-001' },
      { action: 'household.created', entity_id: 'H-002' },
    ]);
  });

  it('never hands out the same code to concurrent enrollments', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enroll()));

    const codes = results.map((r) => r.household.code).sort();
    expect(codes).toEqual(['H-001', 'H-002', 'H-003', 'H-004', 'H-005', 'H-006', 'H-007', 'H-008']);
  });

  it('rejects unknown routes and points', async () => {
    expect((await enroll('P99')).response.json()).toMatchObject({ error: 'unknown_point' });
    const route = await supervisor.post('/api/panel/households', {
      routeCode: 'XX-99',
      pointCode: 'P01',
    });
    expect(route.statusCode).toBe(422);
    expect(
      (await supervisor.post('/api/panel/households', { routeCode: 'RI-01' })).statusCode,
    ).toBe(400);
  });

  it('lists households with their subscriptions and app views', async () => {
    await enroll('P08');
    await enroll('P09');
    const subscribed = await api.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      payload: {
        subscription: browserSubscription('household-1'),
        pointCode: 'P08',
        householdCode: 'H-001',
        consent: true,
        consentVersion: '2026-10-v1',
      },
    });
    const { subscriptionId, managementToken } = subscribed.json<{
      subscriptionId: string;
      managementToken: string;
    }>();
    await api.app.inject({
      method: 'POST',
      url: '/api/usage/views',
      payload: { pointCode: 'P08', subscriptionId, managementToken },
    });

    const page = await supervisor.get('/api/panel/households?route=RI-01&active=true');

    expect(page.json()).toMatchObject({
      total: 2,
      items: [
        {
          code: 'H-001',
          activeSubscriptions: 1,
          lastAlertReceivedAt: null,
          lastAppViewAt: NOW.toISOString(),
        },
        { code: 'H-002', activeSubscriptions: 0, lastAppViewAt: null },
      ],
    });
    expect((await supervisor.get('/api/panel/households?point=P09')).json()).toMatchObject({
      total: 1,
    });
  });

  it('serves the sticker deep link on the public origin', async () => {
    await enroll('P08');

    const sticker = await supervisor.get('/api/panel/households/h-001/sticker');

    expect(sticker.json()).toEqual({
      code: 'H-001',
      url: 'https://rutalimpia.example.org/?r=RI-01&p=P08&h=H-001',
    });
    expect((await supervisor.get('/api/panel/households/H-404/sticker')).statusCode).toBe(404);
  });

  it('moves a household to another point of its route and deactivates it', async () => {
    await enroll('P08');

    const moved = await supervisor.patch('/api/panel/households/H-001', {
      pointCode: 'P10',
      notes: '',
    });
    expect(moved.json()).toMatchObject({ household: { pointCode: 'P10', notes: null } });
    expect(
      (await supervisor.patch('/api/panel/households/H-001', { pointCode: 'P99' })).statusCode,
    ).toBe(422);

    const deactivated = await supervisor.patch('/api/panel/households/H-001', { active: false });
    expect(deactivated.json()).toMatchObject({ household: { active: false } });
    const subscribe = await api.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      payload: {
        subscription: browserSubscription('household-2'),
        pointCode: 'P10',
        householdCode: 'H-001',
        consent: true,
        consentVersion: '2026-10-v1',
      },
    });
    expect(subscribe.json()).toMatchObject({ error: 'unknown_household' });
  });

  it('lets only administrators delete a household, keeping its subscriptions unlinked', async () => {
    await enroll('P08');
    await api.app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      payload: {
        subscription: browserSubscription('household-3'),
        pointCode: 'P08',
        householdCode: 'H-001',
        consent: true,
        consentVersion: '2026-10-v1',
      },
    });

    expect((await supervisor.delete('/api/panel/households/H-001')).statusCode).toBe(403);
    expect((await admin.delete('/api/panel/households/H-001')).statusCode).toBe(204);
    expect((await admin.delete('/api/panel/households/H-001')).statusCode).toBe(404);
    const subscriptions = await db
      .selectFrom('push_subscriptions')
      .select('household_id')
      .execute();
    expect(subscriptions).toEqual([{ household_id: null }]);
  });

  it('keeps observers out of the registry', async () => {
    expect((await observer.get('/api/panel/households')).statusCode).toBe(403);
    expect(
      (await observer.post('/api/panel/households', { routeCode: 'RI-01', pointCode: 'P08' }))
        .statusCode,
    ).toBe(403);
  });
});
