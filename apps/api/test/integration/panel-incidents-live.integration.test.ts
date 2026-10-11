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
import { connectTestDatabase, failAuditWritesOf, resetData } from './database.js';

const T0 = Date.parse('2026-10-20T12:00:00Z');

interface IncidentJson {
  id: string;
  kind: string;
  routeCode: string;
  pointCode: string | null;
  tripId: string | null;
  reportedBy: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

let db: AppDatabase;
let clock: ManualClock;
let api: Api;
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
  supervisor = await panelClient(api.app, 'sara.super');
  observer = await panelClient(api.app, 'omar.obs');
});

describe('panel incidents (PostGIS)', () => {
  it('lets an observer report an incident and a supervisor list and resolve it', async () => {
    const created = await observer.post('/api/panel/incidents', {
      kind: 'missed_collection',
      routeCode: 'ri-01',
      pointCode: 'p08',
      occurredAt: '2026-10-20T07:40:00-05:00',
      description: 'The truck skipped the corner',
    });
    expect(created.statusCode).toBe(201);
    const incident = created.json<{ incident: IncidentJson }>().incident;
    expect(incident).toMatchObject({
      kind: 'missed_collection',
      routeCode: 'RI-01',
      pointCode: 'P08',
      tripId: null,
      reportedBy: 'omar.obs',
      occurredAt: '2026-10-20T12:40:00.000Z',
      resolvedAt: null,
    });

    const open = await supervisor.get('/api/panel/incidents?route=RI-01&status=open');
    expect(open.json()).toMatchObject({ total: 1, items: [{ id: incident.id }] });

    const resolved = await supervisor.patch(`/api/panel/incidents/${incident.id}`, {
      resolved: true,
      resolutionNote: 'Collected at 09:00',
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      incident: { resolvedAt: new Date(T0).toISOString(), resolutionNote: 'Collected at 09:00' },
    });
    expect((await supervisor.get('/api/panel/incidents?status=open')).json()).toMatchObject({
      total: 0,
    });
    expect(
      (
        await db
          .selectFrom('audit_events')
          .select('action')
          .where('entity', '=', 'incident')
          .orderBy('id')
          .execute()
      ).map((e) => e.action),
    ).toEqual(['incident.created', 'incident.resolved']);
  });

  it('links an incident to a trip of the same route only', async () => {
    const trip = (
      await supervisor.post('/api/panel/trips', { vehicleCode: 'UNIDAD-A', routeCode: 'RI-01' })
    ).json<{ trip: { id: string } }>().trip;

    const linked = await supervisor.post('/api/panel/incidents', {
      kind: 'gps_failure',
      routeCode: 'RI-01',
      tripId: trip.id,
    });
    expect(linked.json()).toMatchObject({ incident: { tripId: trip.id, pointCode: null } });
    expect((await supervisor.get(`/api/panel/incidents?tripId=${trip.id}`)).json()).toMatchObject({
      total: 1,
    });
    const detail = await supervisor.get(`/api/panel/trips/${trip.id}`);
    expect(detail.json()).toMatchObject({ incidents: [{ kind: 'gps_failure', resolvedAt: null }] });

    const unknownTrip = await supervisor.post('/api/panel/incidents', {
      kind: 'other',
      routeCode: 'RI-01',
      tripId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknownTrip.statusCode).toBe(422);
    expect(unknownTrip.json()).toMatchObject({ error: 'unknown_trip' });
  });

  it('validates kinds, routes and points', async () => {
    const post = (body: object) => supervisor.post('/api/panel/incidents', body);

    expect((await post({ kind: 'alien_attack', routeCode: 'RI-01' })).statusCode).toBe(400);
    expect((await post({ kind: 'weather', routeCode: 'XX-99' })).json()).toMatchObject({
      error: 'unknown_route',
    });
    expect(
      (await post({ kind: 'weather', routeCode: 'RI-01', pointCode: 'P99' })).json(),
    ).toMatchObject({ error: 'unknown_point' });
    expect(
      (
        await supervisor.patch('/api/panel/incidents/00000000-0000-4000-8000-000000000000', {
          kind: 'other',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('filters by local service date (America/Lima), both bounds inclusive', async () => {
    const report = (occurredAt: string, description: string) =>
      supervisor.post('/api/panel/incidents', {
        kind: 'weather',
        routeCode: 'RI-01',
        occurredAt,
        description,
      });
    // Local dates 19, 20, 20 and 21 October; in UTC the second and third fall on the 20th and 21st.
    await report('2026-10-19T23:30:00-05:00', 'late on the 19th');
    await report('2026-10-20T00:10:00-05:00', 'early on the 20th');
    await report('2026-10-20T23:50:00-05:00', 'late on the 20th');
    await report('2026-10-21T00:05:00-05:00', 'early on the 21st');

    const descriptions = async (query: string) =>
      (await supervisor.get(`/api/panel/incidents?${query}`))
        .json<{ items: { description: string }[] }>()
        .items.map((i) => i.description);

    expect(await descriptions('from=2026-10-20&to=2026-10-20')).toEqual([
      'late on the 20th',
      'early on the 20th',
    ]);
    expect(await descriptions('from=2026-10-21')).toEqual(['early on the 21st']);
    expect(await descriptions('to=2026-10-19')).toEqual(['late on the 19th']);
  });

  it('reopens a resolved incident and refuses a resolution note without resolving', async () => {
    const created = await supervisor.post('/api/panel/incidents', {
      kind: 'missed_collection',
      routeCode: 'RI-01',
    });
    const id = created.json<{ incident: IncidentJson }>().incident.id;
    await supervisor.patch(`/api/panel/incidents/${id}`, {
      resolved: true,
      resolutionNote: 'Collected later',
    });

    const reopened = await supervisor.patch(`/api/panel/incidents/${id}`, { resolved: false });
    expect(reopened.json()).toMatchObject({ incident: { resolvedAt: null, resolutionNote: null } });
    const noteOnly = await supervisor.patch(`/api/panel/incidents/${id}`, {
      resolutionNote: 'Just a note',
    });
    expect(noteOnly.statusCode).toBe(400);
    const notResolving = await supervisor.patch(`/api/panel/incidents/${id}`, {
      resolved: false,
      resolutionNote: 'Just a note',
    });
    expect(notResolving.statusCode).toBe(400);

    const events = await db
      .selectFrom('audit_events')
      .select(['action', 'details'])
      .where('entity', '=', 'incident')
      .orderBy('id')
      .execute();
    expect(events.map((e) => [e.action, e.details])).toEqual([
      ['incident.created', expect.objectContaining({ kind: 'missed_collection' })],
      ['incident.resolved', { fields: ['resolved', 'resolutionNote'] }],
      ['incident.updated', { fields: ['resolved', 'resolutionNote'] }],
    ]);
  });

  it('records no incident when its audit event cannot be written', async () => {
    const restore = await failAuditWritesOf(db, 'incident.created');
    try {
      const created = await observer.post('/api/panel/incidents', {
        kind: 'weather',
        routeCode: 'RI-01',
      });
      expect(created.statusCode).toBe(500);
    } finally {
      await restore();
    }

    expect((await supervisor.get('/api/panel/incidents')).json()).toMatchObject({ total: 0 });
  });

  it('lets observers report but not list or resolve incidents', async () => {
    const created = await supervisor.post('/api/panel/incidents', {
      kind: 'weather',
      routeCode: 'RI-01',
    });
    const id = created.json<{ incident: IncidentJson }>().incident.id;

    expect((await observer.get('/api/panel/incidents')).statusCode).toBe(403);
    expect(
      (await observer.patch(`/api/panel/incidents/${id}`, { resolved: true })).statusCode,
    ).toBe(403);
  });
});

describe('panel live route (PostGIS)', () => {
  it('adds the pass table with alert status and delivery counts, and the open incidents', async () => {
    await driveRi01(api.app, clock, T0, [
      { seconds: 0, chainage: 0 },
      { seconds: 15, chainage: 20 },
      { seconds: 30, chainage: 40 },
    ]);
    await supervisor.post('/api/panel/incidents', {
      kind: 'route_change',
      routeCode: 'RI-01',
      pointCode: 'P05',
    });

    const response = await observer.get('/api/panel/live/routes/ri-01');

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<{
      route: { code: string };
      trips: {
        signal: string;
        vehicle: { code: string };
        points: { pointCode: string; alertStatus: string; passedAt: string | null }[];
      }[];
      openIncidents: { kind: string; pointCode: string | null }[];
    }>();
    expect(body.route.code).toBe('RI-01');
    expect(body.trips).toHaveLength(1);
    expect(body.trips[0]).toMatchObject({ signal: 'live', vehicle: { code: 'UNIDAD-A' } });
    expect(body.trips[0]?.points).toHaveLength(15);
    expect(body.trips[0]?.points[0]).toMatchObject({ pointCode: 'P01', alertStatus: 'not_sent' });
    expect(body.trips[0]?.points[0]?.passedAt).not.toBeNull();
    expect(
      body.trips[0]?.points
        .slice(1)
        .every((p) => ['sent', 'preparing', 'waiting'].includes(p.alertStatus)),
    ).toBe(true);
    expect(body.openIncidents).toEqual([
      expect.objectContaining({ kind: 'route_change', pointCode: 'P05' }),
    ]);
  });

  it('answers 404 for an unknown route and 401 without a session', async () => {
    expect((await supervisor.get('/api/panel/live/routes/XX-99')).statusCode).toBe(404);
    expect(
      (await api.app.inject({ method: 'GET', url: '/api/panel/live/routes/RI-01' })).statusCode,
    ).toBe(401);
  });
});
