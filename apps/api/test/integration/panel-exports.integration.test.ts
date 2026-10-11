import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { NOW, PERIOD, seedIndicatorFixture } from '../support/indicator-fixtures.js';
import {
  createPanelUser,
  panelClient,
  TEST_PASSWORD_HASHER,
  type PanelClient,
} from '../support/panel-client.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import { parseCsv, UTF8_BOM } from '../../src/shared/domain/csv.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { connectTestDatabase, resetData } from './database.js';

const EXPORTS = '/api/panel/exports';
const PERIOD_QUERY = `route=RI-01&from=${PERIOD.from}&to=${PERIOD.to}`;

let db: AppDatabase;
let api: Api;
let supervisor: PanelClient;

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
  supervisor = await panelClient(api.app, 'sara.super');
});

/** Downloads a CSV export and returns its records as objects keyed by the header. */
async function download(path: string) {
  const response = await supervisor.get(`${EXPORTS}/${path}`);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
  const fileName = path.split('?')[0];
  expect(response.headers['content-disposition']).toBe(`attachment; filename="${fileName}"`);
  expect(response.body.startsWith(UTF8_BOM)).toBe(true);
  const [header, ...records] = parseCsv(response.body);
  const names = header?.fields ?? [];
  return {
    header: names,
    rows: records.map((r) => Object.fromEntries(names.map((name, i) => [name, r.fields[i]]))),
  };
}

describe('panel CSV exports (PostGIS)', () => {
  it('instrumento1.csv: the trip log with local HH:MM times and the ETA error', async () => {
    const { header, rows } = await download(`instrumento1.csv?${PERIOD_QUERY}`);

    expect(header).toEqual([
      'source',
      'record_id',
      'service_date',
      'route_code',
      'vehicle',
      'planned_start',
      'actual_start',
      'point_sequence',
      'point_code',
      'actual_passed_at',
      'alert_emitted_at',
      'communicated_eta',
      'abs_error_minutes',
      'point_incidents_count',
      'notes',
    ]);
    // Trip A only (trip C is before the period): 15 points.
    expect(rows).toHaveLength(15);
    expect(rows[1]).toMatchObject({
      source: 'system',
      service_date: '2026-11-17',
      route_code: 'RI-01',
      planned_start: '07:00',
      actual_start: '07:00',
      point_code: 'P02',
      actual_passed_at: '07:27',
      alert_emitted_at: '07:13',
      communicated_eta: '07:20',
      abs_error_minutes: '7',
    });
    expect(rows[4]).toMatchObject({
      point_code: 'P05',
      actual_passed_at: '',
      abs_error_minutes: '',
    });
    expect((await download('instrumento1.csv')).rows).toHaveLength(30);
  });

  it('instrumento2.csv: every sheet with its flags, causes and local times', async () => {
    const { header, rows } = await download('instrumento2.csv?route=RI-01');

    expect(header).toContain('exposure_incomplete');
    expect(header).toContain('comparable_window');
    expect(header).not.toContain('created_by_user_id');
    expect(rows).toHaveLength(10);
    expect(rows.find((r) => r['exposure_incomplete'] === 'yes')).toMatchObject({
      point_code: 'P04',
      phase: 'baseline',
      exposure_minutes: '30',
      music_window_start: '07:00',
      music_window_end: '07:30',
      music_seconds: '200',
      observers: 'L.R.',
    });
    expect(rows.filter((r) => r['comparable_window'] === 'no')).toHaveLength(1);
    expect((await download('instrumento2.csv?from=2026-12-01&to=2026-12-31')).rows).toHaveLength(5);
  });

  it('instrumento3.csv: the surveys in the import format, without personal data', async () => {
    const { header, rows } = await download('instrumento3.csv?route=RI-01');

    expect(header.slice(0, 4)).toEqual(['household_code', 'route_code', 'wave', 'surveyed_on']);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ household_code: 'H-001', wave: 'pre', q2_lead_time: 'gt_3h' });
    expect(rows[1]).toMatchObject({
      household_code: 'H-001',
      wave: 'post',
      q2_lead_time: '0_15',
      q11_satisfaction: '5',
      q12_not_heard: 'no',
    });
  });

  it('indicadores.csv: each indicator, its phases and points, in long form', async () => {
    const { rows } = await download(`indicadores.csv?${PERIOD_QUERY}`);

    expect(rows.find((r) => r['indicator'] === 'I1' && r['scope'] === 'route')).toMatchObject({
      period_from: '2026-11-16',
      period_to: '2026-11-29',
      name: 'Precisión del ETA',
      phase: 'all',
      value: '4',
      unit: 'minutes',
      n_valid: '3',
      n_missing: '12',
      target: '<= 5',
      status: 'met',
    });
    expect(
      rows
        .filter((r) => r['indicator'] === 'I2' && r['scope'] === 'route')
        .map((r) => [r['phase'], r['value']]),
    ).toEqual([
      ['all', '35'],
      ['baseline', '80'],
      ['post', '35'],
    ]);
    expect(
      rows.find((r) => r['indicator'] === 'I3' && r['phase'] === 'all' && r['scope'] === 'route'),
    ).toMatchObject({ change_kind: 'absolute', change: '0.33', status: 'no_data' });
    expect(rows.find((r) => r['indicator'] === 'I4' && r['phase'] === 'all')).toMatchObject({
      paired_test: 'mcnemar',
      pairs: '3',
      p_value: '1',
      target: '>= +30 pp',
    });
    expect(
      rows.find((r) => r['indicator'] === 'I5' && r['phase'] === 'confirmedValue'),
    ).toMatchObject({ value: '28.57' });
    expect(
      rows.find((r) => r['indicator'] === 'I2' && r['scope'] === 'P04' && r['phase'] === 'post'),
    ).toMatchObject({ value: '35', change_kind: 'relative', change: '-65' });
  });

  it('uso.csv: each enrolled household and week, with the adoption rules', async () => {
    const { rows } = await download(`uso.csv?${PERIOD_QUERY}`);

    expect(
      rows.map((r) => [r['week_start'], r['household_code'], r['active'], r['active_confirmed']]),
    ).toEqual([
      ['2026-11-16', 'H-001', 'yes', 'yes'],
      ['2026-11-16', 'H-002', 'yes', 'yes'],
      ['2026-11-16', 'H-003', 'no', 'no'],
      ['2026-11-23', 'H-001', 'no', 'no'],
      ['2026-11-23', 'H-002', 'no', 'no'],
      ['2026-11-23', 'H-003', 'yes', 'no'],
      ['2026-11-23', 'H-004', 'no', 'no'],
    ]);
  });

  it('keeps the exports from observers and validates the filters', async () => {
    const observer = await panelClient(api.app, 'omar.obs');

    expect((await observer.get(`${EXPORTS}/instrumento1.csv`)).statusCode).toBe(403);
    expect((await supervisor.get(`${EXPORTS}/uso.csv?route=RI-01`)).statusCode).toBe(400);
    expect(
      (await supervisor.get(`${EXPORTS}/instrumento2.csv?from=2026-12-31&to=2026-12-01`))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await supervisor.get(
          `${EXPORTS}/indicadores.csv?route=XX-1&from=${PERIOD.from}&to=${PERIOD.to}`,
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (await api.app.inject({ method: 'GET', url: `${EXPORTS}/instrumento1.csv` })).statusCode,
    ).toBe(401);
  });
});
