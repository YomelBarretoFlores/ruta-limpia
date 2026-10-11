import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { NOW, PERIOD, seedIndicatorFixture } from '../support/indicator-fixtures.js';
import { createPanelUser, panelClient, TEST_PASSWORD_HASHER } from '../support/panel-client.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { connectTestDatabase, resetData } from './database.js';

const URL = `/api/panel/indicators?route=RI-01&from=${PERIOD.from}&to=${PERIOD.to}`;

interface IndicatorJson {
  id: string;
  status: string;
  value: number | null;
  [key: string]: unknown;
}

let db: AppDatabase;
let api: Api;

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  await seedIndicatorFixture(db);
  if (api !== undefined) await api.app.close();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock: new ManualClock(NOW),
    logger: pino({ level: 'silent' }),
    passwordHasher: TEST_PASSWORD_HASHER,
  });
  await createPanelUser(api, 'sara.super', 'supervisor');
  await createPanelUser(api, 'omar.obs', 'observer');
});

async function indicators(): Promise<Map<string, IndicatorJson>> {
  const client = await panelClient(api.app, 'sara.super');
  const response = await client.get(URL);
  expect(response.statusCode).toBe(200);
  const body = response.json<{ indicators: IndicatorJson[] }>();
  return new Map(body.indicators.map((i) => [i.id, i]));
}

describe('panel indicators, Tabla 16 (PostGIS)', () => {
  it('I1: the median error of the alerts of the ended trips in the period', async () => {
    const i1 = (await indicators()).get('I1');

    // Trip A: errors 2, 7 and 4 minutes; 12 point-trips without an alert. Trip C is outside.
    expect(i1).toMatchObject({ value: 4, nValid: 3, nMissing: 12, status: 'met' });
    expect((i1?.['byPoint'] as unknown[]).slice(0, 2)).toEqual([
      {
        pointCode: 'P01',
        before: null,
        after: { value: 2, nValid: 1, nMissing: 0, nIncomplete: 0 },
        change: null,
      },
      {
        pointCode: 'P02',
        before: null,
        after: { value: 7, nValid: 1, nMissing: 0, nIncomplete: 0 },
        change: null,
      },
    ]);
  });

  it('I2: baseline and post median exposure, the incomplete one apart, paired by point', async () => {
    const i2 = (await indicators()).get('I2');

    expect(i2).toMatchObject({
      value: 35,
      nValid: 4,
      nMissing: 0,
      nIncomplete: 0,
      before: { value: 80, nValid: 3, nMissing: 1, nIncomplete: 1 },
      after: { value: 35, nValid: 4, nMissing: 0, nIncomplete: 0 },
      change: { kind: 'relative', percent: -56.25 },
      // P01 70 → 40 and P04 100 → 35: two negative differences, exact p = 0.5.
      paired: { kind: 'wilcoxon', pairs: 2, statistic: 0, pValue: 0.5, method: 'exact' },
      status: 'met',
    });
  });

  it('I3: a zero baseline reports the absolute change and leaves the target unevaluated', async () => {
    const i3 = (await indicators()).get('I3');

    expect(i3).toMatchObject({
      before: { value: 0, nValid: 4, nMissing: 1 },
      // The non-comparable window is missing: one event in three valid point-trips.
      after: { value: 0.33, nValid: 3, nMissing: 1 },
      change: { kind: 'absolute', difference: 0.33 },
      status: 'no_data',
      details: {
        brokenBagsShareBaseline: 0.5,
        brokenBagsSharePost: null,
        wasteRemainingShareBaseline: 0.5,
        wasteRemainingSharePost: null,
      },
    });
  });

  it('I4, I6, I9: the household surveys, with McNemar and the "not heard" answers apart', async () => {
    const all = await indicators();

    expect(all.get('I4')).toMatchObject({
      before: { value: 33.33, nValid: 3, nMissing: 1 },
      after: { value: 66.67, nValid: 3, nMissing: 0 },
      change: { kind: 'points', difference: 33.33 },
      paired: { kind: 'mcnemar', pairs: 3, yesToNo: 1, noToYes: 2, pValue: 1 },
      status: 'met',
    });
    // Active households H-001, H-002, H-003 answered 5, 3 and 4.
    expect(all.get('I6')).toMatchObject({
      value: 66.67,
      nValid: 3,
      nMissing: 0,
      status: 'not_met',
      details: { activeHouseholds: 3 },
    });
    expect(all.get('I9')).toMatchObject({
      before: { value: 2.5, nValid: 2, nMissing: 2, nIncomplete: 0 },
      after: { value: 1.5, nValid: 2, nMissing: 0, nIncomplete: 1 },
      paired: { kind: 'wilcoxon', pairs: 1 },
      status: 'exploratory',
    });
  });

  it('I5: weekly adoption of the enrolled, active households, and the confirmed rate', async () => {
    const client = await panelClient(api.app, 'sara.super');
    const body = (await client.get(URL)).json<{
      indicators: IndicatorJson[];
      adoptionWeeks: unknown[];
    }>();

    expect(body.adoptionWeeks).toEqual([
      { weekStart: '2026-11-16', enrolled: 3, active: 2, activeConfirmed: 2 },
      { weekStart: '2026-11-23', enrolled: 4, active: 1, activeConfirmed: 0 },
    ]);
    expect(body.indicators.find((i) => i.id === 'I5')).toMatchObject({
      value: 42.86,
      nValid: 7,
      status: 'not_met',
      details: { confirmedValue: 28.57, weeks: 2 },
    });
  });

  it('I7: 60 s intervals of the trip with a fresh valid position received in time', async () => {
    // 60 intervals; fixes every 30 s until 07:30:00 keep 31 of them available. The invalid fix
    // and the fix received two minutes late add none.
    expect((await indicators()).get('I7')).toMatchObject({
      value: 51.67,
      nValid: 60,
      nMissing: 0,
      status: 'not_met',
    });
  });

  it('I8: the median music seconds at the music points, comparable windows only', async () => {
    expect((await indicators()).get('I8')).toMatchObject({
      before: { value: 250, nValid: 2, nMissing: 1 },
      after: { value: 90, nValid: 2, nMissing: 1 },
      change: { kind: 'relative', percent: -64 },
      paired: { kind: 'wilcoxon', pairs: 1 },
      status: 'met',
    });
  });

  it('lets an observer read the indicators, and validates the query', async () => {
    const observer = await panelClient(api.app, 'omar.obs');

    expect((await observer.get(URL)).statusCode).toBe(200);
    const unknown = await observer.get(
      `/api/panel/indicators?route=XX-99&from=${PERIOD.from}&to=${PERIOD.to}`,
    );
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ error: 'unknown_route' });
    expect(
      (await observer.get('/api/panel/indicators?route=RI-01&from=2026-11-29&to=2026-11-16'))
        .statusCode,
    ).toBe(400);
    expect((await observer.get('/api/panel/indicators?route=RI-01')).statusCode).toBe(400);
    expect((await api.app.inject({ method: 'GET', url: URL })).statusCode).toBe(401);
  });

  it('bounds the period to 120 days, with a clear 400 beyond it', async () => {
    const observer = await panelClient(api.app, 'omar.obs');
    const period = (from: string, to: string) =>
      observer.get(`/api/panel/indicators?route=RI-01&from=${from}&to=${to}`);

    expect((await period('2026-09-01', '2026-12-29')).statusCode).toBe(200);
    const tooLong = await period('2026-09-01', '2026-12-30');
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ error: 'invalid_request' });
    expect(tooLong.json<{ details: string }>().details).toContain('at most 120 days');
    expect((await period('2000-01-01', '2026-12-20')).statusCode).toBe(400);
  });
});
