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

const T0 = Date.parse('2026-10-20T12:00:00Z');
const URL = '/api/panel/field-observations';

const SHEET = {
  routeCode: 'RI-01',
  pointCode: 'P08',
  observedOn: '2026-10-20',
  phase: 'baseline',
  observers: 'L.R., M.Q.',
  firstPlacementTime: '06:40',
  truckPassTime: '07:55',
  bagsAtPass: 12,
  brokenBags: 3,
  dispersion: 'many',
  dispersionCauses: ['animals', 'other'],
  dispersionCauseOther: 'Recyclers opened bags',
  wasteRemainingAfterPass: false,
  photoBefore: { taken: true, code: 'F-P08-001' },
  music: { windowStart: '07:30', windowEnd: '08:00', musicSeconds: 240, conditions: 'Windy' },
};

interface ObservationJson {
  id: string;
  exposureMinutes: number | null;
  exposureComputed: boolean;
  createdByUserId: string;
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
  await seedDatabase(db, { vehicleUniqueId: 'imei-1' });
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

async function createSheet(client: PanelClient, sheet: object = SHEET) {
  const response = await client.post(URL, sheet);
  return { response, observation: response.json<{ observation: ObservationJson }>().observation };
}

describe('panel field observations, Instrument 2 (PostGIS)', () => {
  it('records a sheet with the computed exposure and the music observation', async () => {
    const { response, observation } = await createSheet(observer);

    expect(response.statusCode).toBe(201);
    expect(observation).toMatchObject({
      routeCode: 'RI-01',
      pointCode: 'P08',
      tripId: null,
      observedOn: '2026-10-20',
      phase: 'baseline',
      firstPlacementTime: '06:40',
      truckPassTime: '07:55',
      exposureMinutes: 75,
      exposureComputed: true,
      dispersionCauses: ['animals', 'other'],
      photoBefore: { taken: true, code: 'F-P08-001' },
      photoAfter: { taken: false, code: null },
      music: { windowStart: '07:30', windowEnd: '08:00', musicSeconds: 240, conditions: 'Windy' },
      notes: null,
    });
    const fetched = await observer.get(`${URL}/${observation.id}`);
    expect(fetched.json()).toEqual(response.json());
    expect(
      await db
        .selectFrom('audit_events')
        .select('action')
        .where('entity', '=', 'field_observation')
        .execute(),
    ).toEqual([{ action: 'field_observation.created' }]);
  });

  it('keeps an observed exposure only when a time is missing', async () => {
    const { observation } = await createSheet(observer, {
      ...SHEET,
      firstPlacementTime: null,
      exposureMinutes: 40,
    });

    expect(observation).toMatchObject({ exposureMinutes: 40, exposureComputed: false });
  });

  it('rejects inconsistent sheets with the list of problems', async () => {
    const music = await observer.post(URL, { ...SHEET, pointCode: 'P07' });
    expect(music.statusCode).toBe(422);
    expect(music.json()).toMatchObject({
      error: 'invalid_observation',
      problems: ['music_not_observed_at_point'],
    });
    expect(
      (await observer.post(URL, { ...SHEET, truckPassTime: '06:00', brokenBags: 20 })).json(),
    ).toMatchObject({ problems: ['pass_before_placement', 'broken_bags_exceed_bags'] });
    expect((await observer.post(URL, { ...SHEET, truckPassTime: '7:55' })).statusCode).toBe(400);
    expect((await observer.post(URL, { ...SHEET, dispersion: 'lots' })).statusCode).toBe(400);
    expect(
      (await observer.post(URL, { ...SHEET, photoBefore: { taken: true, code: 'a photo.jpg' } }))
        .statusCode,
    ).toBe(400);
    expect((await observer.post(URL, { ...SHEET, pointCode: 'P99' })).json()).toMatchObject({
      error: 'unknown_point',
    });
  });

  it('lets an observer see and change only their own sheets, for 24 hours', async () => {
    const { observation } = await createSheet(observer);
    await createSheet(otherObserver, { ...SHEET, pointCode: 'P04' });

    const own = await observer.get(URL);
    expect(own.json()).toMatchObject({ total: 1, items: [{ id: observation.id }] });
    expect((await supervisor.get(`${URL}?route=RI-01&phase=baseline`)).json()).toMatchObject({
      total: 2,
    });
    expect((await otherObserver.get(`${URL}/${observation.id}`)).statusCode).toBe(404);
    expect((await otherObserver.put(`${URL}/${observation.id}`, SHEET)).statusCode).toBe(404);

    // Sessions idle out after 8 hours: sign in again after each jump of the clock.
    clock.set(new Date(T0 + 23 * 3_600_000));
    observer = await panelClient(api.app, 'omar.obs');
    const edited = await observer.put(`${URL}/${observation.id}`, { ...SHEET, bagsAtPass: 14 });
    expect(edited.json()).toMatchObject({ observation: { bagsAtPass: 14 } });

    clock.set(new Date(T0 + 24 * 3_600_000));
    observer = await panelClient(api.app, 'omar.obs');
    supervisor = await panelClient(api.app, 'sara.super');
    const late = await observer.put(`${URL}/${observation.id}`, { ...SHEET, bagsAtPass: 15 });
    expect(late.statusCode).toBe(403);
    expect(late.json()).toMatchObject({ error: 'edit_window_closed' });
    expect((await observer.delete(`${URL}/${observation.id}`)).statusCode).toBe(403);

    const bySupervisor = await supervisor.put(`${URL}/${observation.id}`, {
      ...SHEET,
      bagsAtPass: 15,
    });
    expect(bySupervisor.json()).toMatchObject({ observation: { bagsAtPass: 15 } });
    expect((await supervisor.delete(`${URL}/${observation.id}`)).statusCode).toBe(204);
    expect((await supervisor.get(`${URL}/${observation.id}`)).statusCode).toBe(404);
  });

  it('links a sheet to a trip of the same route', async () => {
    const trip = (
      await supervisor.post('/api/panel/trips', { vehicleCode: 'UNIDAD-A', routeCode: 'RI-01' })
    ).json<{ trip: { id: string } }>().trip;

    expect((await createSheet(observer, { ...SHEET, tripId: trip.id })).observation).toMatchObject({
      tripId: trip.id,
    });
    expect(
      (
        await observer.post(URL, { ...SHEET, tripId: '00000000-0000-4000-8000-000000000000' })
      ).json(),
    ).toMatchObject({ error: 'unknown_trip' });
  });
});
