import type { Socket } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RI01_SNAPSHOT } from '../../../../test/support/ri01-tracking.js';
import { openSse, type SseConnection } from '../../../../test/support/sse-client.js';
import { buildApp } from '../../../app.js';
import type { RouteSnapshot } from '../../../routes/application/route-catalog.js';
import { SILENT_LOGGER } from '../../../shared/application/logger.js';
import { InMemoryEventBus } from '../../../shared/infrastructure/events/in-memory-event-bus.js';
import type { TrackingEvents } from '../../../tracking/application/tracking-events.js';
import type { LiveRouteSnapshotView } from '../../application/live-views.js';
import { LiveStreamHub } from '../sse/live-stream-hub.js';

const AT = new Date('2026-10-20T12:10:00Z');
const p08 = RI01_SNAPSHOT.points[7]!;
const EMPTY_SNAPSHOT: LiveRouteSnapshotView = {
  route: { code: 'RI-01', name: RI01_SNAPSHOT.name },
  generatedAt: AT.toISOString(),
  staleAfterSeconds: 60,
  trips: [],
};

const passed = (routeId = RI01_SNAPSHOT.id): TrackingEvents['point.passed'] => ({
  tripId: 'trip-1',
  routeId,
  pointId: p08.id,
  passedAt: AT,
  precision: 'interpolated',
});

const apps: FastifyInstance[] = [];
const streams: SseConnection[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  // An aborted `fetch` can leave an idle keep-alive socket of undici open on the server, which
  // would hold `close()` until the hook times out; tests do not need graceful draining.
  for (const app of apps) app.server.closeAllConnections();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function start(
  options: {
    maxConnections?: number;
    heartbeatMs?: number;
    findRoute?: (code: string) => Promise<RouteSnapshot | null>;
  } = {},
) {
  const events = new InMemoryEventBus<TrackingEvents>(SILENT_LOGGER);
  const hub = new LiveStreamHub({
    events,
    maxConnections: options.maxConnections ?? 10,
    heartbeatMs: options.heartbeatMs ?? 60_000,
    retryMs: 5_000,
    logger: SILENT_LOGGER,
  });
  const snapshot = vi.fn((_route: RouteSnapshot) => Promise.resolve(EMPTY_SNAPSHOT));
  const app = await buildApp({
    publicRead: {
      catalog: {
        queries: {
          listActive: () => Promise.resolve([]),
          findActiveByCode: () => Promise.resolve(null),
          findActiveIdByCode: () => Promise.resolve(null),
        },
      },
      live: {
        snapshots: {
          findRoute:
            options.findRoute ??
            ((code) => Promise.resolve(code === 'RI-01' ? RI01_SNAPSHOT : null)),
          snapshot,
        },
        stream: { hub, maxFixAgeSec: 60 },
      },
    },
  });
  apps.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const connect = async (code = 'ri-01') => {
    const stream = await openSse(`${address}/api/live/routes/${code}/stream`);
    streams.push(stream);
    return stream;
  };
  return { app, address, events, hub, snapshot, connect };
}

describe('GET /api/live/routes/:code/stream', () => {
  it('sends the snapshot first, then only the events of its route', async () => {
    const { events, connect } = await start();

    const stream = await connect();
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(stream.headers.get('cache-control')).toBe('no-store');
    expect(stream.headers.get('x-accel-buffering')).toBe('no');
    expect(await stream.next()).toEqual({ event: 'snapshot', data: EMPTY_SNAPSHOT });
    expect(stream.retries).toEqual([5000]);

    events.publish('point.passed', passed('route-other'));
    events.publish('point.passed', passed());

    expect(await stream.next()).toEqual({
      event: 'point.passed',
      data: {
        tripId: 'trip-1',
        pointId: p08.id,
        pointCode: 'P08',
        passedAt: AT.toISOString(),
        precision: 'interpolated',
      },
    });
  });

  it('queues the events published while the snapshot is built', async () => {
    const { events, snapshot, connect } = await start();
    let release: () => void = () => undefined;
    snapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(EMPTY_SNAPSHOT);
        }),
    );

    const stream = await connect();
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalled());
    events.publish('point.passed', passed());
    release();

    expect((await stream.next()).event).toBe('snapshot');
    expect((await stream.next()).event).toBe('point.passed');
  });

  it('sends heartbeat comments', async () => {
    const { connect } = await start({ heartbeatMs: 20 });

    const stream = await connect();
    await stream.next();

    await vi.waitFor(() => expect(stream.comments).toContain('heartbeat'));
  });

  it('answers 503 when the stream capacity is reached and frees a slot on disconnect', async () => {
    const { hub, connect } = await start({ maxConnections: 1 });

    const first = await connect();
    await first.next();
    const second = await connect();
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('30');

    first.close();
    await vi.waitFor(() => expect(hub.size).toBe(0));
    const third = await connect();
    expect(third.status).toBe(200);
  });

  it('releases the slot when the client disconnects while the route is being looked up', async () => {
    let lookupStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => (lookupStarted = resolve));
    let releaseLookup: () => void = () => undefined;
    const { app, address, hub, snapshot } = await start({
      findRoute: () => {
        lookupStarted();
        return new Promise((resolve) => (releaseLookup = () => resolve(RI01_SNAPSHOT)));
      },
    });
    const serverSocketClosed = new Promise<void>((resolve) =>
      app.server.once('connection', (socket: Socket) => socket.once('close', () => resolve())),
    );
    const client = new AbortController();
    const request = fetch(`${address}/api/live/routes/RI-01/stream`, {
      signal: client.signal,
    }).catch(() => null);

    await started;
    client.abort();
    await request;
    await serverSocketClosed;
    releaseLookup();

    // The rest of the handler runs on microtasks, which all settle before `setImmediate`.
    await new Promise((resolve) => setImmediate(resolve));
    expect(hub.size).toBe(0);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown route and 400 for a malformed code', async () => {
    const { hub, connect } = await start();

    expect((await connect('XX-99')).status).toBe(404);
    expect((await connect('bad%20code')).status).toBe(400);
    expect(hub.size).toBe(0);
  });

  it('ends the stream when the snapshot fails', async () => {
    const { hub, snapshot, connect } = await start();
    snapshot.mockRejectedValueOnce(new Error('db down'));

    const stream = await connect();

    await stream.ended;
    expect(hub.size).toBe(0);
  });

  it('ends every open stream when the server closes', async () => {
    const { app, hub, connect } = await start();
    const stream = await connect();
    await stream.next();

    await app.close();

    await stream.ended;
    expect(hub.size).toBe(0);
  });
});
