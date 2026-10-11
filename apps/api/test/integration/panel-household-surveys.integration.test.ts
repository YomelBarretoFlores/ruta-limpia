import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
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

  it('keeps surveys to supervisors and administrators', async () => {
    const observer = await panelClient(api.app, 'omar.obs');

    expect((await observer.get(URL)).statusCode).toBe(403);
    expect((await observer.post(URL, POST_SURVEY)).statusCode).toBe(403);
  });
});
