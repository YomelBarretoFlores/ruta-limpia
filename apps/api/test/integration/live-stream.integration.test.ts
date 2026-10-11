import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { stopAndGoChainageAt } from '../support/ri01-tracking.js';
import { openSse, type SseConnection, type SseMessage } from '../support/sse-client.js';
import { forwardAt } from '../support/traccar-forward.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import type { LiveSnapshotResponse } from '../../src/live/infrastructure/http/live-schemas.js';
import type { AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { connectTestDatabase, resetData } from './database.js';

/** Tuesday 2026-10-20, 07:05 in Lima. */
const T0 = Date.parse('2026-10-20T12:05:00Z');

let db: AppDatabase;
let api: Api;
let baseUrl: string;
const clock = new ManualClock(new Date(T0));
const streams: SseConnection[] = [];

async function connect(code = 'RI-01') {
  const stream = await openSse(`${baseUrl}/api/live/routes/${code}/stream`);
  streams.push(stream);
  return stream;
}

async function ingest(id: number, seconds: number) {
  clock.set(new Date(T0 + seconds * 1000 + 1000));
  const response = await api.app.inject({
    method: 'POST',
    url: '/ingest/traccar/positions',
    headers: { 'x-ingest-token': TEST_API_CONFIG.ingestToken },
    payload: forwardAt(T0, id, seconds, stopAndGoChainageAt(seconds)),
  });
  expect(response.statusCode).toBe(200);
}

const named =
  (event: string) =>
  (message: SseMessage): boolean =>
    message.event === event;

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await composeApi({
    config: { ...TEST_API_CONFIG, sseMaxConnections: 1 },
    db,
    clock,
    logger: pino({ level: 'silent' }),
    notifier: { notify: () => Promise.resolve() },
  });
  baseUrl = await api.app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  for (const stream of streams) stream.close();
  await api.app.close();
  await db.destroy();
});
beforeEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  await expect.poll(() => api.liveStreams.size).toBe(0);
  await resetData(db);
  await seedDatabase(db, { vehicleUniqueId: 'ruta-limpia-unidad-a' });
  api.routes.invalidate();
  clock.set(new Date(T0));
});

describe('live route stream (PostGIS)', () => {
  it('sends the snapshot, then the trip, positions, ETAs and passes as fixes arrive', async () => {
    const stream = await connect();

    const snapshot = await stream.next();
    expect(snapshot.event).toBe('snapshot');
    expect((snapshot.data as LiveSnapshotResponse).trips).toEqual([]);

    await ingest(1, 0);
    const first = [await stream.next(), await stream.next(), await stream.next()];
    expect(first.map((m) => m.event)).toEqual(['vehicle.position', 'trip.started', 'eta.updated']);
    const [position, started, eta] = first;
    expect(started!.data).toMatchObject({ startMode: 'auto' });
    expect(position!.data).toMatchObject({
      vehicleCode: 'UNIDAD-A',
      fixTime: new Date(T0).toISOString(),
    });
    expect(eta!.data).toMatchObject({ signal: 'live', lastFixAt: new Date(T0).toISOString() });
    expect(JSON.stringify(first)).not.toMatch(/vehicleId|subscription|token/i);

    // P01 lies 30 m along the route: reached after the first 20 s of driving at 1.5 m/s.
    await ingest(2, 20);
    await ingest(3, 40);
    const pass = await stream.next(named('point.passed'));
    expect(pass.data).toMatchObject({ pointCode: 'P01', precision: 'interpolated' });
  });

  it('forwards the periodic refresh, stale once the telemetry is old', async () => {
    await ingest(1, 0);
    await ingest(2, 20);
    const stream = await connect();
    const snapshot = await stream.next();
    expect((snapshot.data as LiveSnapshotResponse).trips[0]?.signal).toBe('live');

    clock.set(new Date(T0 + 20_000 + 61_000));
    await api.etaRefresh.refreshAll();

    const eta = await stream.next(named('eta.updated'));
    expect(eta.data).toMatchObject({ signal: 'stale' });
    expect(JSON.stringify(eta.data)).not.toContain('predictedPassAt');
  });

  it('answers 503 beyond SSE_MAX_CONNECTIONS', async () => {
    const first = await connect();
    await first.next();

    const second = await connect();

    expect(second.status).toBe(503);
    expect((await connect('XX-99')).status).toBe(404);
  });
});
