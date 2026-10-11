/**
 * End-to-end smoke test of the whole pipeline: the simulator bootstraps a real Traccar 6.16 and
 * drives RI-01 over OsmAnd; Traccar forwards each position as JSON (`forward.type=json`, the
 * `X-Ingest-Token` header) to the API running in this process; the live stream (SSE) shows the
 * trip, the passes, the ETAs and the alerts; the panel exports the Instrument 1 rows.
 *
 * Traccar runs with the repository's own `infra/traccar/traccar.xml` and entrypoint, against a
 * `traccar` database in the same PostGIS container (network alias `db`, as in docker compose).
 *
 * Time: the API's clock is the injectable `ManualClock` the composition root already takes. The
 * drive keeps its realistic timestamps (a fix every 20 s, 40 s stops at the points) and the test
 * moves the clock to each fix's time before sending it, then waits for the API to stream it. So a
 * 16-minute drive runs in seconds, in order, with no production change.
 */
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'kysely';
import { pino } from 'pino';
import {
  GenericContainer,
  Network,
  TestContainers,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapTraccar,
  planRi01Drive,
  RI01_STOPS,
  sendOsmAnd,
  type PlannedFix,
} from '../../../../tools/simulator/src/index.js';
import { ManualClock } from '../fakes/in-memory-tracking-store.js';
import { TEST_API_CONFIG } from '../support/api-config.js';
import { createPanelUser, panelClient } from '../support/panel-client.js';
import { openSse, type SseConnection, type SseMessage } from '../support/sse-client.js';
import { composeApi, type Api } from '../../src/composition-root.js';
import { parseCsv } from '../../src/shared/domain/csv.js';
import { createDatabase, type AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { migrateToLatest } from '../../src/shared/infrastructure/db/migrator.js';
import { seedDatabase } from '../../src/shared/infrastructure/db/seed.js';
import { SILENT_LOGGER } from '../../src/shared/application/logger.js';

const POSTGIS_IMAGE = 'postgis/postgis:16-3.5';
/** Same image as `infra/docker-compose.yml`. */
const TRACCAR_IMAGE = 'traccar/traccar:6.16.0-alpine';
const INFRA = resolve(import.meta.dirname, '../../../../infra');
const DEVICE = 'ruta-limpia-unidad-a';
const ADMIN = { email: 'admin@e2e.example.org', password: 'e2e-traccar-admin-password' };
/**
 * The drive starts half an hour ago, on the minute: Traccar drops fixes from the future (its
 * default future filter), so the timestamps stay behind the real clock.
 */
const T0 = new Date(Math.floor((Date.now() - 30 * 60_000) / 60_000) * 60_000);
/** The service date of the drive (America/Lima), for the Instrument 1 export. */
const SERVICE_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(T0);
/** A signal gap long enough (over 60 s) to make the ETA stale, in the middle of the drive. */
const GAP = { atSec: 400, durationSec: 100 };
/** How long one forwarded position may take to come back on the stream. */
const STEP_TIMEOUT_MS = 15_000;

let network: StartedNetwork;
let postgis: StartedPostgreSqlContainer;
let traccar: StartedTestContainer;
let db: AppDatabase;
let api: Api;
let apiUrl: string;
const clock = new ManualClock(T0);
const traccarUrl = (port: number) => `http://${traccar.getHost()}:${traccar.getMappedPort(port)}`;
/** What `bootstrapTraccar` needs; every test can run it again (it is idempotent). */
const bootstrapOptions = () => ({
  baseUrl: traccarUrl(8082),
  ...ADMIN,
  deviceUniqueId: DEVICE,
  deviceName: 'Unidad A',
});
/** The first bootstrap, on the fresh Traccar: done once here so no test depends on another. */
let firstBootstrap: Awaited<ReturnType<typeof bootstrapTraccar>>;

beforeAll(async () => {
  network = await new Network().start();
  postgis = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withPlatform('linux/amd64')
    .withNetwork(network)
    .withNetworkAliases('db')
    .withDatabase('ruta_limpia_e2e')
    .withUsername('ruta_limpia')
    .withPassword('ruta_limpia')
    .withStartupTimeout(180_000)
    .start();
  db = createDatabase(postgis.getConnectionUri(), { poolMax: 10 });
  await sql`CREATE DATABASE traccar`.execute(db);
  await migrateToLatest(db, SILENT_LOGGER);
  await seedDatabase(db, { vehicleUniqueId: DEVICE });

  api = await composeApi({
    config: TEST_API_CONFIG,
    db,
    clock,
    logger: pino({ level: process.env['E2E_DEBUG'] === '1' ? 'info' : 'silent' }),
    notifier: { notify: () => Promise.resolve() },
  });
  apiUrl = await api.app.listen({ host: '127.0.0.1', port: 0 });
  const apiPort = Number(new URL(apiUrl).port);
  // Lets the Traccar container reach this process as host.testcontainers.internal.
  await TestContainers.exposeHostPorts(apiPort);

  traccar = await new GenericContainer(TRACCAR_IMAGE)
    .withNetwork(network)
    .withCopyFilesToContainer([
      { source: `${INFRA}/traccar/traccar.xml`, target: '/opt/traccar/conf/traccar.xml' },
      {
        source: `${INFRA}/traccar/entrypoint.sh`,
        target: '/opt/traccar/ruta-limpia-entrypoint.sh',
      },
    ])
    .withEntrypoint(['/bin/sh', '/opt/traccar/ruta-limpia-entrypoint.sh'])
    .withEnvironment({
      INGEST_TOKEN: TEST_API_CONFIG.ingestToken,
      POSTGRES_USER: 'ruta_limpia',
      POSTGRES_PASSWORD: 'ruta_limpia',
      TRACCAR_FORWARD_URL: `http://host.testcontainers.internal:${apiPort}/ingest/traccar/positions`,
    })
    .withExposedPorts(8082, 5055)
    .withWaitStrategy(Wait.forHttp('/api/server', 8082).forStatusCode(200))
    .withStartupTimeout(240_000)
    .withLogConsumer((stream) => {
      // E2E_DEBUG=1 shows Traccar's log (forwarding errors, decoded positions).
      if (process.env['E2E_DEBUG'] === '1')
        stream.on('data', (line: string) => process.stdout.write(line));
    })
    .start();
  firstBootstrap = await bootstrapTraccar(bootstrapOptions());
});

afterAll(async () => {
  // Every step runs even when an earlier one fails, so no container or network is left behind.
  const steps = [
    () => api?.app.close(),
    () => db?.destroy(),
    () => traccar?.stop(),
    () => postgis?.stop(),
    () => network?.stop(),
  ];
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'E2E teardown failed');
});

/** Every event the stream sent, in order, and a way to wait for the next one that matters. */
function recorder(stream: SseConnection) {
  const log: SseMessage[] = [];
  return {
    log,
    async until(predicate: (message: SseMessage) => boolean): Promise<SseMessage> {
      for (;;) {
        const message = await stream.next(() => true, STEP_TIMEOUT_MS);
        log.push(message);
        if (predicate(message)) return message;
      }
    },
  };
}

const field = (message: SseMessage, key: string) => (message.data as Record<string, unknown>)[key];

describe('RI-01 through Traccar, end to end', () => {
  it('bootstraps Traccar idempotently', async () => {
    const again = await bootstrapTraccar(bootstrapOptions());

    expect(firstBootstrap).toMatchObject({ adminCreated: true, deviceCreated: true });
    expect(again).toEqual({
      adminCreated: false,
      deviceCreated: false,
      deviceId: firstBootstrap.deviceId,
    });
  });

  it('streams the trip, the passes in order, the ETAs and one alert per point, and logs Instrument 1', async () => {
    const stream = await openSse(`${apiUrl}/api/live/routes/RI-01/stream`);
    const events = recorder(stream);
    await events.until((m) => m.event === 'snapshot');
    const plan = planRi01Drive({ startAt: T0, gap: GAP });
    const send = (fix: PlannedFix) => sendOsmAnd(traccarUrl(5055), DEVICE, fix);
    const last = plan.fixes.at(-1)!;
    // The last fix before the gap, and when the ETA is first older than 60 s without a new one.
    const beforeGap = plan.fixes.findLast((fix) => fix.offsetSec < GAP.atSec)!;
    const afterGap = plan.fixes.find((fix) => fix.offsetSec >= GAP.atSec)!;
    const staleAtSec = beforeGap.offsetSec + 75;
    expect(staleAtSec).toBeLessThan(afterGap.offsetSec);

    for (const fix of plan.fixes) {
      clock.set(new Date(fix.at.getTime() + 1000));
      await send(fix);
      if (fix === last) break;
      // Traccar holds each fix for its ordering buffer (`server.buffering.threshold`, 3 s by
      // default) before forwarding it: wait for the API to stream it before the next one.
      const fixTime = fix.at.toISOString();
      await events.until((m) => m.event === 'vehicle.position' && field(m, 'fixTime') === fixTime);
      if (fix === beforeGap) {
        // No fix for 75 s: the next refresh suspends the ETA.
        clock.set(new Date(T0.getTime() + staleAtSec * 1000));
        await api.etaRefresh.refreshAll();
        await events.until((m) => m.event === 'eta.updated' && field(m, 'signal') === 'stale');
      }
    }
    // The trip completes in the final stretch; the last fix, at the route end, comes after it.
    if (!events.log.some((m) => m.event === 'trip.completed')) {
      await events.until((m) => m.event === 'trip.completed');
    }
    const stored = () =>
      db
        .selectFrom('positions')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
        .then((row) => Number(row.n));
    // Every fix went through Traccar and was stored once.
    await expect.poll(stored, { timeout: STEP_TIMEOUT_MS }).toBe(plan.fixes.length);
    stream.close();

    const named = (event: string) => events.log.filter((m) => m.event === event);
    const [started] = named('trip.started');
    const tripId = field(started!, 'tripId') as string;
    expect(named('trip.started')).toHaveLength(1);
    expect(named('point.passed').map((m) => field(m, 'pointCode'))).toEqual(
      RI01_STOPS.map((stop) => stop.code),
    );
    expect(named('eta.updated').some((m) => field(m, 'signal') === 'live')).toBe(true);
    expect(named('eta.updated').some((m) => field(m, 'signal') === 'stale')).toBe(true);
    expect(named('trip.completed')).toHaveLength(1);

    // One alert per eligible point: the stream and the log agree, and no point has two.
    const alerted = named('alert.emitted').map((m) => field(m, 'pointCode') as string);
    const rows = await db
      .selectFrom('alerts as a')
      .innerJoin('reference_points as p', 'p.id', 'a.point_id')
      .select(['p.code', 'a.trip_id'])
      .orderBy('p.sequence')
      .execute();
    expect(alerted.length).toBeGreaterThanOrEqual(10);
    expect(new Set(alerted).size).toBe(alerted.length);
    expect([...alerted].sort()).toEqual(rows.map((r) => r.code).sort());
    expect(rows.every((r) => r.trip_id === tripId)).toBe(true);

    await createPanelUser(api, 'sara.super', 'supervisor');
    const supervisor = await panelClient(api.app, 'sara.super');
    const exported = await supervisor.get(
      `/api/panel/exports/instrumento1.csv?route=RI-01&from=${SERVICE_DATE}&to=${SERVICE_DATE}`,
    );
    expect(exported.statusCode).toBe(200);
    const [header, ...records] = parseCsv(exported.body).map((r) => r.fields);
    const column = (name: string) => header!.indexOf(name);
    const tripRows = records.filter((r) => r[column('record_id')] === tripId);
    expect(tripRows).toHaveLength(15);
    expect(tripRows.every((r) => r[column('source')] === 'system')).toBe(true);
    expect(tripRows.every((r) => r[column('actual_passed_at')] !== '')).toBe(true);
    expect(tripRows.filter((r) => r[column('alert_emitted_at')] !== '')).toHaveLength(
      alerted.length,
    );
  });
});
