# Simulator and end-to-end smoke test

The simulator drives a collection truck along RI-01 through a real Traccar, so the whole pipeline
runs as in the pilot: tracker → Traccar → API → live panel, citizen app and alerts. The smoke test
runs the same drive automatically in containers and checks every stage.

## Quick path

1. Start the stack: `pnpm infra:up`, then `pnpm dev` (API on :3000, web on :5173).
2. Prepare Traccar once:
   `TRACCAR_ADMIN_EMAIL=… TRACCAR_ADMIN_PASSWORD=… pnpm sim:bootstrap`.
3. Drive: `pnpm sim:drive`. Watch http://localhost:5173/panel (Seguimiento) or the citizen app.
4. Check the pipeline without the stack: `pnpm test:e2e` (Docker required, about 2.5 minutes).

## 1. Bootstrap Traccar

`pnpm sim:bootstrap` is idempotent; run it as often as you like.

| Step                | Traccar 6.16 call                                                    | When                                                                                         |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First administrator | `POST /api/users` (no authentication)                                | Only when `GET /api/server` reports `newServer`: Traccar makes the first user administrator. |
| Find the device     | `GET /api/devices?uniqueId=<SEED_VEHICLE_UNIQUE_ID>` with HTTP Basic | Always.                                                                                      |
| Create the device   | `POST /api/devices` `{ name, uniqueId }`                             | Only when it is missing. Traccar answers `400` to OsmAnd fixes from unknown devices.         |

The credentials come from `TRACCAR_ADMIN_EMAIL` and `TRACCAR_ADMIN_PASSWORD` (environment or the
root `.env`); they are never hardcoded or printed. Wrong credentials stop the script without
creating anything.

## 2. Drive RI-01

`pnpm sim:drive` sends OsmAnd requests (`GET :5055/?id&lat&lon&timestamp&speed&bearing&accuracy`,
speed in knots, timestamp in epoch seconds) in real time:

| Profile                    | Default                                        | Option                                                                                        |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Report interval            | 20 s (the pilot trackers report every 15–30 s) | `--interval 15..30`                                                                           |
| Speed between points       | 3.5 m/s (about 13 km/h)                        | `--speed`                                                                                     |
| Stop at each point P01–P15 | 40 s                                           | `--dwell`                                                                                     |
| GPS error                  | none                                           | `--noise <m>` and `--seed <n>` (repeatable)                                                   |
| Signal gap                 | none                                           | `--gap-at <s> --gap-for <s>`: over 60 s, the panel shows "Sin señal" and the ETA is suspended |
| Time compression           | 1×                                             | `--speedup <n>`: timestamps follow the wall clock, so the truck looks n times faster          |

The drive starts about 30 m before P01 (inside the trip start zone) and ends about 30 m after P15
(the trip completes). With the defaults it lasts about 16 minutes and sends 50 fixes. Use
`--dry-run` to see them.

## 3. End-to-end smoke test

`pnpm test:e2e` (own Vitest config, `apps/api/vitest.e2e.config.ts`; not part of `pnpm test`):

1. Starts PostGIS (network alias `db`, plus a `traccar` database) and Traccar 6.16 with the
   repository's own `infra/traccar/traccar.xml` and entrypoint: `forward.type=json` to the API in
   the test process (`host.testcontainers.internal`), with the `X-Ingest-Token` header.
2. Runs `bootstrapTraccar` twice (the second run changes nothing).
3. Drives RI-01 through Traccar's OsmAnd port, with a 100 s signal gap.
4. Asserts on the live stream (SSE) and the database:
   - one `trip.started`, the 15 `point.passed` in route order, live `eta.updated`, a `stale` one
     during the gap, one `trip.completed`;
   - one `alert.emitted` per alerted point, matching the `alerts` rows (unique per trip and point);
   - every fix stored once;
   - the 15 Instrument 1 rows of the trip in `instrumento1.csv`.

### How it stays fast: the clock

The drive keeps its realistic timestamps (16 minutes of driving), but the API under test runs on the
injectable clock its composition root already takes (`ManualClock` from the test fakes). Before
sending each fix the test sets the clock to the fix's time, then waits for the API to stream that
position. No production code changed for this. The fixes are dated half an hour in the past,
because Traccar drops fixes from the future (`filter.future`, one day by default).

Each fix takes about 3 s: Traccar holds incoming data for its ordering buffer
(`server.buffering.threshold`, 3000 ms by default) before forwarding it. The pilot's 15–30 s report
interval is unaffected.

`E2E_DEBUG=1 pnpm test:e2e` prints Traccar's log and the API's log.

### What it caught

Traccar 6.16 runs its forwarding handler before its database handler, so a forwarded position can
carry `id: 0`. In the first runs every first forward had `id: 0`: the API answered `400`, and only
Traccar's retry (with the stored id) got through. Traccar retries ten times with a growing delay,
then drops the position. The API now stores such a position without a Traccar id and recognizes a
replay by vehicle and fix time (migration `0015-positions-without-traccar-id`).

## Next step

Check real Web Push notifications by hand in Chrome: [`docs/ops/push-check.md`](ops/push-check.md).
