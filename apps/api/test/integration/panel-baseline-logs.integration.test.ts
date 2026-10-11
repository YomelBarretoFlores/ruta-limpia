import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { DRIVE_VEHICLE_UNIQUE_ID, driveRi01 } from '../support/panel-drive.js';
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

const T0 = Date.parse('2026-10-20T12:00:00Z');
const URL = '/api/panel/baseline-logs';

const LOG = {
  routeCode: 'RI-01',
  serviceDate: '2026-10-13',
  vehicleLabel: 'Compactadora municipal',
  plannedStart: '07:00',
  actualStart: '07:12',
  notes: 'Rain delayed the start',
  passes: [
    { pointCode: 'P02', passedAt: '07:21' },
    { pointCode: 'P01', passedAt: '07:15' },
  ],
};

interface LogJson {
  id: string;
  passes: { pointCode: string; sequence: number; passedAt: string }[];
}

let db: AppDatabase;
let clock: ManualClock;
let api: Api;
let supervisor: PanelClient;
let observer: PanelClient;
let otherObserver: PanelClient;

beforeAll(async () => {
  db = await connectTestDatabase();
});
afterAll(async () => {
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  await resetData(db);
  await seedDatabase(db, { vehicleUniqueId: DRIVE_VEHICLE_UNIQUE_ID });
  clock = new ManualClock(new Date(T0));
  if (api !== undefined) await api.app.close();
  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: 'silent' }),
    passwordHasher: TEST_PASSWORD_HASHER,
  });
  await createPanelUser(api, 'sara.super', 'supervisor');
  await createPanelUser(api, 'omar.obs', 'observer');
  await createPanelUser(api, 'olga.obs', 'observer');
  supervisor = await panelClient(api.app, 'sara.super');
  observer = await panelClient(api.app, 'omar.obs');
  otherObserver = await panelClient(api.app, 'olga.obs');
});

describe('panel baseline route logs, manual Instrument 1 (PostGIS)', () => {
  it('records a log with its passes in route order', async () => {
    const created = await observer.post(URL, LOG);

    expect(created.statusCode).toBe(201);
    const log = created.json<{ log: LogJson }>().log;
    expect(log).toMatchObject({
      routeCode: 'RI-01',
      serviceDate: '2026-10-13',
      vehicleLabel: 'Compactadora municipal',
      plannedStart: '07:00',
      actualStart: '07:12',
      passes: [
        { pointCode: 'P01', sequence: 1, passedAt: '07:15' },
        { pointCode: 'P02', sequence: 2, passedAt: '07:21' },
      ],
    });
    expect((await observer.get(`${URL}/${log.id}`)).json()).toEqual(created.json());
    expect(
      (await supervisor.get(`${URL}?route=RI-01&from=2026-10-13&to=2026-10-13`)).json(),
    ).toMatchObject({ total: 1 });
  });

  it('rejects unknown and repeated points', async () => {
    const unknown = await observer.post(URL, {
      ...LOG,
      passes: [{ pointCode: 'P99', passedAt: '07:15' }],
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ error: 'unknown_point', pointCode: 'P99' });
    const repeated = await observer.post(URL, {
      ...LOG,
      passes: [
        { pointCode: 'P01', passedAt: '07:15' },
        { pointCode: 'p01', passedAt: '07:16' },
      ],
    });
    expect(repeated.json()).toMatchObject({ error: 'duplicate_point', pointCode: 'P01' });
    expect((await observer.post(URL, { ...LOG, actualStart: '25:00' })).statusCode).toBe(400);
  });

  it('applies the field ownership rules and replaces the passes on update', async () => {
    const log = (await observer.post(URL, LOG)).json<{ log: LogJson }>().log;

    expect((await otherObserver.get(URL)).json()).toMatchObject({ total: 0 });
    expect((await otherObserver.delete(`${URL}/${log.id}`)).statusCode).toBe(404);

    const updated = await observer.put(`${URL}/${log.id}`, {
      ...LOG,
      passes: [{ pointCode: 'P03', passedAt: '07:30' }],
    });
    expect(updated.json<{ log: LogJson }>().log.passes).toEqual([
      { pointCode: 'P03', sequence: 3, passedAt: '07:30' },
    ]);

    clock.set(new Date(T0 + 25 * 3_600_000));
    const lateObserver = await panelClient(api.app, 'omar.obs');
    expect((await lateObserver.put(`${URL}/${log.id}`, LOG)).json()).toMatchObject({
      error: 'edit_window_closed',
    });
    const lateSupervisor = await panelClient(api.app, 'sara.super');
    expect((await lateSupervisor.delete(`${URL}/${log.id}`)).statusCode).toBe(204);
    expect(await db.selectFrom('baseline_point_passes').selectAll().execute()).toEqual([]);
    expect(
      (
        await db
          .selectFrom('audit_events')
          .select('action')
          .where('entity', '=', 'baseline_log')
          .orderBy('id')
          .execute()
      ).map((e) => e.action),
    ).toEqual(['baseline_log.created', 'baseline_log.updated', 'baseline_log.deleted']);
  });
});

describe('instrument1_export view (PostGIS)', () => {
  it('unites the system trip log and the baseline logs, marked by source', async () => {
    await driveRi01(api.app, clock, T0, [
      { seconds: 0, chainage: 0 },
      { seconds: 15, chainage: 20 },
      { seconds: 30, chainage: 40 },
    ]);
    const log = (await observer.post(URL, LOG)).json<{ log: LogJson }>().log;

    const rows = await db
      .selectFrom('instrument1_export')
      .selectAll()
      .where('point_code', 'in', ['P01', 'P02'])
      .orderBy('source')
      .orderBy('point_sequence')
      .execute();

    expect(rows.map((r) => [r.source, r.point_code, r.service_date, r.vehicle])).toEqual([
      ['baseline_manual', 'P01', '2026-10-13', 'Compactadora municipal'],
      ['baseline_manual', 'P02', '2026-10-13', 'Compactadora municipal'],
      ['system', 'P01', '2026-10-20', 'UNIDAD-A'],
      ['system', 'P02', '2026-10-20', 'UNIDAD-A'],
    ]);
    const [baselineP01] = rows;
    expect(baselineP01).toMatchObject({
      record_id: log.id,
      planned_start: '07:00:00',
      // 07:12 and 07:15 in Lima (UTC-5).
      actual_start: new Date('2026-10-13T12:12:00Z'),
      actual_passed_at: new Date('2026-10-13T12:15:00Z'),
      alert_emitted_at: null,
      abs_error_minutes: null,
      notes: 'Rain delayed the start',
    });
    expect(rows[2]?.actual_passed_at).not.toBeNull();
    const baselineRows = await db
      .selectFrom('instrument1_export')
      .select('point_code')
      .where('source', '=', 'baseline_manual')
      .execute();
    expect(baselineRows).toHaveLength(15);
  });
});
