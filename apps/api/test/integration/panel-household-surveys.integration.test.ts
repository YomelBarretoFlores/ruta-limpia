import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import {
  createPanelUser,
  PANEL_HEADERS,
  panelClient,
  TEST_PASSWORD_HASHER,
  type PanelClient,
} from '../support/panel-client.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import { UTF8_BOM } from '../../src/shared/domain/csv.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, failAuditWritesOf, resetData } from './database.js';

const URL = '/api/panel/household-surveys';
const NOW = new Date('2026-12-15T15:00:00Z');

const POST_SURVEY = {
  householdCode: 'h-001',
  wave: 'post',
  surveyedOn: '2026-12-15',
  knowsSchedule: true,
  leadTime: '0_15',
  satisfaction: 5,
  alertsHelped: 4,
  notHeard: true,
  channels: ['alert', 'other'],
  channelOther: 'Junta vecinal',
};

interface SurveyJson {
  id: string;
  householdCode: string;
  wave: string;
  importBatchId: string | null;
}

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
  const { routeId } = await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
  const point = await db
    .selectFrom('reference_points')
    .select('id')
    .where('code', '=', 'P02')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('households')
    .values(
      ['H-001', 'H-002'].map((code) => ({
        code,
        route_id: routeId,
        point_id: point.id,
        enrolled_at: NOW,
        consent_at: NOW,
        consent_version: '2026-10-v1',
      })),
    )
    .execute();
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

function importCsv(client: PanelClient, csv: string, headers: Record<string, string> = {}) {
  return api.app.inject({
    method: 'POST',
    url: `${URL}/import`,
    headers: { ...PANEL_HEADERS, cookie: client.cookie, 'content-type': 'text/csv', ...headers },
    payload: csv,
  });
}

const auditActions = async () =>
  (
    await db
      .selectFrom('audit_events')
      .select(['action', 'details'])
      .where('entity', 'like', 'household_survey%')
      .orderBy('id')
      .execute()
  ).map((e) => [e.action, e.details]);

describe('panel household surveys, Instrument 3 (PostGIS)', () => {
  it('records, reads, edits and deletes a survey, with its audit trail', async () => {
    const created = await supervisor.post(URL, POST_SURVEY);
    expect(created.statusCode).toBe(201);
    const survey = created.json<{ survey: SurveyJson }>().survey;
    expect(survey).toMatchObject({
      householdCode: 'H-001',
      routeCode: 'RI-01',
      wave: 'post',
      leadTime: '0_15',
      satisfaction: 5,
      annoyance: null,
      notHeard: true,
      channels: ['alert', 'other'],
      importBatchId: null,
    });
    expect((await supervisor.get(`${URL}/${survey.id}`)).json()).toEqual(created.json());

    const edited = await supervisor.put(`${URL}/${survey.id}`, {
      ...POST_SURVEY,
      notHeard: false,
      annoyance: 2,
    });
    expect(edited.json()).toMatchObject({ survey: { annoyance: 2, notHeard: false } });
    const list = await supervisor.get(`${URL}?route=RI-01&wave=post`);
    expect(list.json()).toMatchObject({ total: 1, items: [{ id: survey.id }] });

    expect((await supervisor.delete(`${URL}/${survey.id}`)).statusCode).toBe(204);
    expect((await supervisor.get(`${URL}/${survey.id}`)).statusCode).toBe(404);
    expect(await auditActions()).toEqual([
      ['household_survey.created', { householdCode: 'H-001', wave: 'post' }],
      ['household_survey.updated', { householdCode: 'H-001', wave: 'post' }],
      ['household_survey.deleted', { householdCode: 'H-001', wave: 'post' }],
    ]);
  });

  it('refuses a second survey of a wave, unknown households and inconsistent answers', async () => {
    expect((await supervisor.post(URL, POST_SURVEY)).statusCode).toBe(201);

    const twice = await supervisor.post(URL, POST_SURVEY);
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ error: 'duplicate_survey' });
    const unknown = await supervisor.post(URL, { ...POST_SURVEY, householdCode: 'H-404' });
    expect(unknown.json()).toMatchObject({ error: 'unknown_household' });
    const pre = await supervisor.post(URL, { ...POST_SURVEY, wave: 'pre', annoyance: 1 });
    expect(pre.statusCode).toBe(422);
    expect(pre.json()).toMatchObject({
      error: 'invalid_survey',
      problems: ['post_only_answer_in_pre', 'annoyance_and_not_heard'],
    });
    expect((await supervisor.post(URL, { ...POST_SURVEY, satisfaction: 6 })).statusCode).toBe(400);
  });

  it('refuses an edit into a household and wave that already has a survey, and keeps working', async () => {
    const first = (await supervisor.post(URL, POST_SURVEY)).json<{ survey: SurveyJson }>().survey;
    const other = await supervisor.post(URL, { ...POST_SURVEY, householdCode: 'H-002' });
    const second = other.json<{ survey: SurveyJson }>().survey;

    const clash = await supervisor.put(`${URL}/${second.id}`, POST_SURVEY);
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ error: 'duplicate_survey' });
    expect((await supervisor.get(`${URL}/${second.id}`)).json()).toMatchObject({
      survey: { householdCode: 'H-002' },
    });
    expect(await auditActions()).toEqual([
      ['household_survey.created', { householdCode: 'H-001', wave: 'post' }],
      ['household_survey.created', { householdCode: 'H-002', wave: 'post' }],
    ]);
    // The refused edit left no aborted transaction behind: the next edit commits.
    const edited = await supervisor.put(`${URL}/${first.id}`, { ...POST_SURVEY, satisfaction: 3 });
    expect(edited.json()).toMatchObject({ survey: { satisfaction: 3 } });
  });

  it('answers 404 for unknown or malformed ids and 422 for an edit to an unknown household', async () => {
    const survey = (await supervisor.post(URL, POST_SURVEY)).json<{ survey: SurveyJson }>().survey;
    const unknownId = '00000000-0000-4000-8000-000000000000';

    for (const id of [unknownId, 'not-a-uuid']) {
      expect((await supervisor.get(`${URL}/${id}`)).statusCode).toBe(404);
      expect((await supervisor.put(`${URL}/${id}`, POST_SURVEY)).statusCode).toBe(404);
      expect((await supervisor.delete(`${URL}/${id}`)).statusCode).toBe(404);
    }
    const moved = await supervisor.put(`${URL}/${survey.id}`, {
      ...POST_SURVEY,
      householdCode: 'H-404',
    });
    expect(moved.statusCode).toBe(422);
    expect(moved.json()).toMatchObject({ error: 'unknown_household' });
  });

  it('filters the list by a household code written in lower case', async () => {
    await supervisor.post(URL, POST_SURVEY);

    expect((await supervisor.get(`${URL}?household=h-001`)).json()).toMatchObject({ total: 1 });
  });

  it('keeps surveys to supervisors and administrators', async () => {
    const observer = await panelClient(api.app, 'omar.obs');
    const survey = (await supervisor.post(URL, POST_SURVEY)).json<{ survey: SurveyJson }>().survey;

    expect((await observer.get(URL)).statusCode).toBe(403);
    expect((await observer.get(`${URL}/${survey.id}`)).statusCode).toBe(403);
    expect((await observer.put(`${URL}/${survey.id}`, POST_SURVEY)).statusCode).toBe(403);
    expect((await observer.delete(`${URL}/${survey.id}`)).statusCode).toBe(403);
    expect((await observer.post(URL, POST_SURVEY)).statusCode).toBe(403);
    expect((await importCsv(observer, 'household_code,wave,surveyed_on\n')).statusCode).toBe(403);
  });

  it('imports a CSV file keyed by household and wave, replacing a survey already there', async () => {
    await supervisor.post(URL, {
      ...POST_SURVEY,
      wave: 'pre',
      satisfaction: null,
      alertsHelped: null,
    });
    const csv = [
      'household_code,route_code,wave,surveyed_on,q2_lead_time,q11_satisfaction,q12_annoyance',
      'H-001,RI-01,pre,2026-10-15,gt_3h,,3',
      'H-001,RI-01,post,2026-12-15,0_15,5,1',
      'H-002,RI-01,pre,2026-10-16,after_pass,,2',
    ].join('\r\n');

    const response = await importCsv(supervisor, `${UTF8_BOM}${csv}\r\n`);

    expect(response.statusCode).toBe(200);
    const result = response.json<{ batchId: string; created: number; updated: number }>();
    expect(result).toMatchObject({ created: 2, updated: 1 });
    const stored = await db
      .selectFrom('household_surveys as s')
      .innerJoin('households as h', 'h.id', 's.household_id')
      .select(['h.code', 's.wave', 's.q2_lead_time', 's.q12_annoyance', 's.import_batch_id'])
      .orderBy('h.code')
      .orderBy('s.wave')
      .execute();
    expect(stored).toEqual([
      {
        code: 'H-001',
        wave: 'post',
        q2_lead_time: '0_15',
        q12_annoyance: 1,
        import_batch_id: result.batchId,
      },
      {
        code: 'H-001',
        wave: 'pre',
        q2_lead_time: 'gt_3h',
        q12_annoyance: 3,
        import_batch_id: result.batchId,
      },
      {
        code: 'H-002',
        wave: 'pre',
        q2_lead_time: 'after_pass',
        q12_annoyance: 2,
        import_batch_id: result.batchId,
      },
    ]);
    expect((await auditActions()).at(-1)).toEqual([
      'household_survey.imported',
      { rows: 3, created: 2, updated: 1 },
    ]);
  });

  it('imports nothing when any row has a problem, and lists every problem by line', async () => {
    const csv = [
      'household_code,wave,surveyed_on,q11_satisfaction,q12_annoyance,q12_not_heard',
      'H-001,pre,2026-10-15,,2,',
      'H-404,pre,2026-10-15,,,',
      'H-002,pre,2026-10-15,4,1,yes',
      'H-001,pre,2026-10-17,,,',
      'H-002,post,2026-13-01,,,',
    ].join('\n');

    const response = await importCsv(supervisor, csv);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'invalid_rows',
      message: 'Some rows have problems; nothing was imported.',
      errors: [
        { line: 3, column: 'household_code', problem: 'unknown_household' },
        { line: 4, column: null, problem: 'post_only_answer_in_pre' },
        { line: 4, column: null, problem: 'annoyance_and_not_heard' },
        { line: 5, column: null, problem: 'duplicate_of_line_2' },
        { line: 6, column: 'surveyed_on', problem: 'invalid_value' },
      ],
    });
    expect(await db.selectFrom('household_surveys').select('id').execute()).toEqual([]);
  });

  it('rolls the whole import back when its audit event cannot be written', async () => {
    const restore = await failAuditWritesOf(db, 'household_survey.imported');
    try {
      const response = await importCsv(
        supervisor,
        'household_code,wave,surveyed_on\nH-001,pre,2026-10-15\n',
      );
      expect(response.statusCode).toBe(500);
    } finally {
      await restore();
    }
    expect(await db.selectFrom('household_surveys').select('id').execute()).toEqual([]);
  });

  it('answers a broken file, an empty one and a body that is not CSV', async () => {
    const broken = await importCsv(supervisor, 'household_code,wave,surveyed_on,address\n');
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({
      error: 'invalid_csv',
      errors: [{ line: 1, column: 'address', problem: 'unknown_column' }],
    });
    const empty = await importCsv(supervisor, 'household_code,wave,surveyed_on\r\n');
    expect(empty.json()).toMatchObject({ error: 'empty_file' });
    expect((await supervisor.post(`${URL}/import`, { rows: [] })).statusCode).toBe(415);
    const withoutCsrf = await importCsv(supervisor, 'household_code,wave,surveyed_on\n', {
      'x-requested-with': '',
    });
    expect(withoutCsrf.statusCode).toBe(403);
  });

  it('refuses a file with too many rows, and a body over 1 MiB', async () => {
    const rows = Array.from({ length: 1001 }, () => 'H-001,pre,2026-10-15');
    const tooMany = await importCsv(
      supervisor,
      ['household_code,wave,surveyed_on', ...rows].join('\n'),
    );
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json()).toMatchObject({ error: 'too_many_rows' });

    const tooBig = await importCsv(
      supervisor,
      `household_code,wave,surveyed_on\n${'x'.repeat(1024 * 1024)}`,
    );
    expect(tooBig.statusCode).toBe(413);
    expect(await db.selectFrom('household_surveys').select('id').execute()).toEqual([]);
  });

  it('serves the CSV template as a download', async () => {
    const response = await supervisor.get(`${URL}/template.csv`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="plantilla-instrumento3.csv"',
    );
    expect(response.body.startsWith(`${UTF8_BOM}household_code,route_code,wave,surveyed_on,`)).toBe(
      true,
    );
  });
});
