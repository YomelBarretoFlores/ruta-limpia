# Feature: ruta-limpia-system

Locator: `odd/tasks/ruta-limpia-system.md` · Engram mirror: `odd/ruta-limpia-system/tasks` (project `ruta-limpia`)
Branch: `feat/ruta-limpia-system` · Source of requirements: `Proyecto_RSU_Ruta_Limpia_2026.pdf`

## Objective

Build the complete Ruta Limpia pilot system: GPS tracking of garbage trucks, an ETA engine, proximity alerts for
households, a municipal monitoring panel, field-instrument capture, and impact indicators, ready to deploy on one VPS.

## Problem

Households do not know when the collection truck actually passes, so waste bags sit on the street for a long time,
break, and scatter. The proposal (UNASAM RSU 2026, RR N.° 767-2026-UNASAM) runs a 9-week pilot
(2026-10-19 → 2026-12-20) on route RI-01 (Independencia), optionally one Huaraz route, with up to 100 households and
15–20 observation points.

## Why

The objectives OE2 (system in operation) and OE4 (measured impact) depend on software that tracks the truck, warns
households in time, and produces verifiable logs for the impact indicators (Tabla 16).

## Scope

- Ingestion: commercial 4G trackers → **Traccar** (open-source protocol gateway, decided with the user) → JSON
  position forwarding (`forward.type=json`, `forward.url`) → our API. Verified against Traccar source
  (`PositionForwarderJson`, `Keys.FORWARD_URL`): the payload is `{ position, device }`, and the speed is in knots.
- Domain: route geometry (linear referencing), trip lifecycle, point-pass detection, ETA estimation, staleness,
  alert policy.
- Citizen PWA: map, ETA for a public reference point, Web Push subscription with consent, QR deep link, cancel.
- Municipal panel: live tracking, per-point pass table, alert status, incidents, history, roles.
- Field instruments: Instrument 1 (route/telemetry log, auto-generated), Instrument 2 (point observation form,
  manual entry), household registry (codes, no addresses), Instrument 3 survey results import.
- Indicators: ETA error, availability, adoption, exposure, dispersion, music-notice duration; CSV exports.
- Simulator plus seed data (RI-01, P01–P15 from Annex 8). Production deployment (docker compose + Caddy HTTPS).
  Handover documentation (OE5).

Out of scope: SMS/WhatsApp channels (no budget), native mobile apps, measuring noise in dB(A).

## Constraints (from the proposal)

- Positions every 15–30 s; a position older than 60 s is stale → show "sin actualización" and suspend the ETA. Never
  present a stale ETA as current.
- One alert per trip per point, sent when the ETA is within the 5–10 min target window and the telemetry is fresh.
- Log the alert emission time, the communicated ETA, and the actual pass time. Never reconstruct a prediction
  retrospectively.
- Households subscribe to a public reference point and their address is never stored. Require consent, use
  household codes, and enforce role-based access.
- Field indicators come from instruments and are never auto-filled.
- Budget: one small VPS (S/ 80/month), so the stack must run comfortably in about 2 GB RAM.

## Architecture decisions

- Monorepo with pnpm workspaces, Node 22, TypeScript (strict mode), ESM.
- `apps/api`: Fastify plus hexagonal / screaming architecture, organized by bounded context
  (`src/<context>/{domain,application,infrastructure}`). The domain is pure and has no I/O.
- PostgreSQL 16 + PostGIS. Kysely for queries and migrations. Testcontainers for integration tests.
- `apps/web`: Vite + React + TypeScript PWA with Leaflet and OpenStreetMap tiles. Two areas: citizen (`/`) and
  panel (`/panel`).
- Realtime through Server-Sent Events. Web Push through VAPID (`web-push`).
- Vitest for all tests. Test-first for the domain and the application services.
- Delivery strategy: `exception-ok`. There is no remote repository, so PR slicing is moot. Each task closes with
  one reviewable work-unit commit, and the user decides about pushes and PRs.

## Tasks

| ID | Task | Route | Status |
|----|------|-------|--------|
| T1 | Monorepo scaffold, tooling, docker compose (PostGIS + Traccar) and README | delegated (writer: 2+ non-trivial files) | [x] |
| T2 | Pure domain: route geometry, trip lifecycle, pass detection, ETA engine, staleness, alert policy (test-first) | delegated (writer) | [x] |
| T3 | Persistence + ingestion: schema/migrations, Traccar forward endpoint, tracking pipeline, Instrument 1 log | delegated (writer) | [x] |
| T4 | Notifications: Web Push (VAPID), point subscriptions with consent/cancel, alert dispatch and delivery log | delegated (writer) | [x] |
| T5 | Public API + SSE: routes, points, vehicle status, live ETA per point | delegated (writer) | [x] |
| T6 | Citizen PWA: map, point selection, ETA, subscription flow, QR deep link, offline/printed fallback | delegated (writer) | [x] |
| T7a | Municipal panel backend: auth/sessions/roles, audit, live panel, trips, incidents, households, field observations, baseline logs | delegated (writer: 2+ non-trivial files) | [x] |
| T7b | Municipal panel UI (`/panel`) + design system + T6 PWA hardening | delegated (writer) | [ ] |
| T8 | Indicators and exports: KPI computation (Tabla 16), CSV exports for Instruments 1–3 | delegated (writer) | [ ] |
| T9 | Simulator (OsmAnd → Traccar) and end-to-end smoke test over the whole pipeline | delegated (writer) | [ ] |
| T10 | Production deploy (compose + Caddy HTTPS, backups), operations and handover docs (OE5) | delegated (writer) | [ ] |

## Acceptance criteria

- A simulated truck driving RI-01 produces live positions, ETAs per point, exactly one alert per (trip, point), and
  recorded pass times.
- The panel shows the vehicle, signal status, the pass table, and the alert status. Stale telemetry suspends the ETA.
- The citizen PWA subscribes to a point with consent, receives a push, and can cancel the subscription.
- The indicators compute from the logs and the instrument data. CSV exports work.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass. Integration tests run against PostGIS.
- `docker compose up` brings up the full stack locally. Production compose and docs are present.

## Applicable checks

`pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit + integration), and the e2e smoke test (T9).

## Forecast

Authored changed lines: about 8–12k across 10 tasks, which exceeds the ~400-line budget. Strategy `exception-ok`
(see the architecture decisions).

## Progress

- 2026-10-10: requirements extracted from the proposal PDF; Traccar forwarding verified; repo initialized
  (`f2a7486`), branch created.
- 2026-10-11: T1 done in work-unit commit `chore: scaffold monorepo, tooling and local infra`. The commit
  cannot quote its own hash, so the parent records it. Verification: `pnpm install` OK, `pnpm typecheck` exit 0,
  `pnpm lint` exit 0, `pnpm test` 3 files / 9 tests passed, `pnpm format:check` clean, `pnpm build` OK.
  `docker compose -f infra/docker-compose.yml up -d` reached db=healthy and traccar=healthy; Traccar UI GET :8082
  returned 200; `traccar` database and PostGIS 3.5.2 present. A manual forward probe
  (OsmAnd :5055 → host listener) received `POST /ingest/traccar/positions` with `X-Ingest-Token` and a
  `{position, device}` body. Versions: TypeScript 6.0 (typescript-eslint does not support TS 7 yet), jsdom 29 and
  react-router 7 (the latest majors require Node ≥ 22.22, but 22.19 is installed), postgis/postgis:16-3.5,
  traccar/traccar:6.16.0-alpine. Authored lines: about 850 (lockfile excluded; README, configs and infra included).

- 2026-10-11: T1 commit is `60244ed`. Review (RDD on, risk high): consent granted; 4-lens review approved and
  acknowledged (lineage `review-58fa6aa9f1099dcc`, authority burned). There were no blocking findings.
  Advisory WARNINGs: PostGIS :5432 and the Traccar UI :8082 were published on all interfaces. Both are now bound to
  127.0.0.1 in a follow-up `fix(infra)` commit. Deferred suggestions: a graceful-shutdown deadline in
  `apps/api/src/main.ts` (T3), an example INGEST_TOKEN that should fail validation (T3), wider config test coverage
  (T3), and duplicated Traccar defaults in `entrypoint.sh` (T10). The reviewed boundary is now `60244ed`.

- 2026-10-11: T2 done in work-unit commit `feat(domain): add route geometry, trip progress, ETA engine and alert
  policy`. The parent records the hash. Verification: `pnpm typecheck` exit 0, `pnpm lint` exit 0 (the domain
  purity rule passes), `pnpm test` 14 files / 100 tests passed. Test-first: each module's tests ran RED before
  any code existed (missing module). `advanceTrip` then failed 13 tests against a no-op stub, `estimateEtas` failed
  10, and `decideAlerts`/`etaErrorMinutes` failed 4; all went GREEN after implementation. The RI-01 stop-and-go
  scenario probe exposed an EWMA bias: clamping stopped samples up to minSpeed inflated 0.75 m/s to about
  1.0 m/s. A new test went RED, and the fix (stops count as 0, only the reported speed is clamped) made it GREEN.
  Design: equirectangular local projection (bbox center); chainage-window projection for overlap and jump
  safety; passes are interpolated by chainage (`upper_bound` precision for points already behind the first fix);
  `PointEta` is a discriminated union, so `stale` cannot carry a prediction. Defaults: point offset 50 m,
  off-route 60 m, back tolerance 30 m, max plausible speed 15 m/s plus 50 m slack, pass tolerance 15 m, end
  tolerance 30 m, inactivity 30 min, stale after 60 s, speed clamp 0.5–12 m/s, EWMA tau 90 s, bucket 100 m,
  recent weight 0.5, default speed 8 km/h, alert lead 60–600 s, target window 300–600 s. The RI-01 fixture is
  `apps/api/src/routes/domain/ri01.fixture.ts` (reuse it for seed data and the simulator). Authored lines: about
  2.1k (950 source+docs, 1,140 tests), well above the 400-line heuristic. The domain contracts are cohesive, and
  the scenario test needs all five contexts; strategy `exception-ok`.

- 2026-10-11: T3 done in two work-unit commits. Commit A `d1c65a1`
  `fix(domain): pass points at their exact chainage and never strand them at trip completion` (T2 review
  items). Test-first: 3 new tests went RED against the old code (early pass 10 m before P01, pass time
  taken from the stop, point 3 m before the route end stranded at completion), then GREEN after removing
  `passToleranceMeters` and passing every remaining point (`upper_bound`) before `trip_completed`. The
  off-route + `jump_rejected` behavior was already correct (stays off route, keeps progress, no
  `route_rejoined`); it is now documented and covered by a characterization test. The scenario's
  out-of-order assertion moved into an `it()`. Points near the route end stay valid in
  `locateReferencePoints` (P15 sits 0.03 m before the completion threshold; completion covers it).
  Commit B `feat(tracking): ...` (the parent records the hash): Kysely 0.29 + pg 8.23 + PostGIS schema
  (migration `0001-initial-schema`, view `instrument1_route_log`), idempotent seed, `POST
  /ingest/traccar/positions`, `IngestPositionService`, `TripLifecycleService`, `InactivityJob`, typed
  in-memory event bus, logging `AlertNotifier`, graceful shutdown with a deadline, new env vars, and
  Testcontainers integration tests (`postgis/postgis:16-3.5` with `withPlatform('linux/amd64')`).
  Verification: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm format:check` clean, `pnpm test`
  26 files / 161 tests passed (projects `api`, `api-integration` with 12 PostGIS tests, `web`; about 10 s
  including the container). Smoke: `db:migrate` applied `0001-initial-schema`, `db:seed` twice returned the
  same ids, the built API answered 401 without a token, 200 processed (auto-started trip), 200 duplicate,
  202 unknown device and 400 malformed; SIGTERM exited cleanly; compose containers removed again, volumes
  kept. Decisions: alerts wait for a speed basis (a measured recent speed or a historical profile), because
  on the first fix the default speed alone fired alerts for every point within 10 min; per-vehicle
  serialization locks the vehicle row and the active trip (`FOR UPDATE`), which also serializes auto-start
  across processes; manual and inactivity ends are recorded as `aborted` and published as `trip.completed`
  with `status`/`endReason`; the Instrument 1 view uses America/Lima dates; ETA "now" is the server clock.
  Pending: `.env.example` could not be edited (the writer's permission settings deny reading `.env*`
  files), so its INGEST_TOKEN placeholder is unverified; the parent must make it a short `change-me`
  value that fails validation. Authored lines: about 4.0k (2.4k source+docs, 1.55k tests), above the
  400-line heuristic because schema, pipeline, adapters and their integration tests form one deliverable;
  strategy `exception-ok`.

- 2026-10-11: T2 review (slice `60244ed..ffb8af2`, medium, 1 lens) approved and acknowledged. Its WARNING (a point in
  the last 15 m of the route was never passed) was fixed in T3 commit A.
- 2026-10-11: T3 commit B was over the reviewer context budget (`lens_context_budget_exceeded`, 5.5k lines). With
  the user's approval it was split, content unchanged (backup branch `backup/t3-before-split`), into `a2392ee`
  (application services and ports), `65355eb` (PostGIS schema, migrations, seed) and `b1e148e` (ingest endpoint,
  adapters, composition). Each slice built and passed its tests on its own. All three were reviewed (medium,
  reliability lens), approved and acknowledged. The reviewed boundary is now `b1e148e`. Advisory findings, to
  harden in T4 commit A:
  - WARNING: a speed-profile load failure rolls back the whole ingest; it should fall back to recent speed only.
  - WARNING: a missing route for an active trip makes every later fix fail; it should store the position and skip
    trip advancement.
  - SUGGESTION: the cache-invalidation race in `RouteCatalog` and `SpeedProfileProvider`.
  - SUGGESTION: add a concurrent same-vehicle ingest test.
  - SUGGESTION: add a duplicate `traccar_position_id` integration test.
  - SUGGESTION: treat empty env values as unset.
  - SUGGESTION: add a shutdown routine test with injectable exit and timers.
  - WARNING (accepted): `pnpm test` requires Docker, by design (acceptance criteria). CI without Docker runs
    `test:unit`.
  - `.env.example` cannot be edited by agents (`.env*` access is blocked by the user's permission settings); the
    user must apply the INGEST_TOKEN placeholder and new variables.

- 2026-10-11: T4 done in three work-unit commits, each under the ~1.5k-line review budget (lockfile
  excluded) and each building and passing its tests on its own. Commit A `36c5c9c`
  `fix(tracking): harden ingestion against degraded routes, profiles and shutdown` (about 590 lines)
  closes the T3 review findings. RED first: 3 ingest tests failed (a profile failure rejected the ingest
  with `profile query failed`; a missing or failing route threw `Route ... not found` or
  `route query failed`), 3 cache-race tests failed (a superseded load evicted the newer entry: 3 loads
  instead of 2), the empty-env test threw `ConfigError`, and the shutdown tests failed on the missing
  module. All went GREEN. These passed as characterization tests: concurrent first fixes create one
  trip (the per-vehicle mutex already covered it), a raw duplicate Traccar id raises 23505 (the
  endpoint replay test already existed), and the Instrument 1 view dates trips in America/Lima (a 22:00
  local Tuesday trip keeps Tuesday's planned start; Sunday has none) and reports the ETA error only with
  an alert and a pass (3.5 min). Commit B `4b4b0af` `feat(alerts): add point subscriptions with consent
  and token-based cancellation` (about 1.5k lines): migration `0002-push-subscriptions` (households with
  code and point only, with a composite FK so the point belongs to the route; push subscriptions;
  alert deliveries), `SubscriptionService`, the public `/api` routes with `@fastify/rate-limit`, VAPID,
  `TRUST_PROXY`, `PUBLIC_RATE_LIMIT_PER_MINUTE`, and `vapid:generate`. Commit C (the parent records the
  hash) `feat(alerts): deliver proximity alerts through Web Push` (about 1.45k lines):
  `PushAlertNotifier` over the `PushGateway` and `AlertDeliveryStore` ports, `WebPushGateway`
  (web-push 3.6.7), Spanish payload, receipts endpoint, background dispatch with
  `whenNotificationsSettled()` (also a shutdown step), `PUSH_CONCURRENCY` and
  `PUSH_MAX_CONSECUTIVE_FAILURES`. Verification at C: `pnpm typecheck` exit 0, `pnpm lint` exit 0,
  `pnpm format:check` clean, `pnpm test` 36 files / 246 tests passed (4 integration files, 31 PostGIS
  tests, including the end-to-end drive where a fake gateway receives one push per active subscription of
  each alerted point and none for other points or revoked subscriptions). Smoke: compose db healthy,
  `db:migrate` applied `0002-push-subscriptions`, built API with command-line VAPID keys answered
  `GET /api/push/vapid-public-key` 200, `POST /api/subscriptions` 400 without consent, 422 for `P99`, 201
  for `P08`, `DELETE` 403 with a wrong token and 204 with the right one; SIGTERM exited cleanly;
  containers removed, volumes kept. Decisions: endpoints are restricted to the browser push services
  (FCM, Mozilla, Apple, Windows) to prevent SSRF; a point code that repeats across routes needs
  `routeCode`; unknown point or household answers 422; without VAPID the API warns and the subscription
  endpoints answer 503; the application notifier is `PushAlertNotifier` (protocol-agnostic) and
  `WebPushGateway` is the `web-push` adapter; receipts get a 10x rate limit for carrier NAT bursts;
  `secondsRemaining` is recomputed at send time from the communicated ETA (never a new prediction).
  Pending: `.env.example` must gain `TRUST_PROXY`, `PUBLIC_RATE_LIMIT_PER_MINUTE`, `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_CONCURRENCY` and `PUSH_MAX_CONSECUTIVE_FAILURES` (agents
  cannot edit `.env*` files). Real delivery to a browser is checked in T6 (PWA service worker).

- 2026-10-11: T4's last commit is `7d80fb3`. T4 was reviewed in two slices, `b1e148e..4b4b0af` and
  `4b4b0af..7d80fb3`; both were approved and acknowledged. The reviewed boundary is now `7d80fb3`. Its
  findings are handled in T5 commit A `fix(alerts): close the cancel race and harden background
  dispatch and shutdown` (`cbca102`):
  - WARNING (cancel/revoke race): `cancel` now revokes with one UPDATE conditioned on the verified
    `management_token_hash` (`SubscriptionStore.revokeWithToken`); a re-subscription that rotated the
    token in between answers `403` and stays active.
  - Auto-start: a missing or inactive default route (new `RouteSnapshot.active`) is warned once per
    vehicle and process without trip wording; a route-load failure during auto-start is logged as a
    skipped auto-start.
  - Subscribing with a household requires the point to be on the household's route
    (`422 household_route_mismatch`); another point of the same route is allowed.
  - Background notifications end with a terminal logging `.catch`; `whenNotificationsSettled()` uses
    `Promise.allSettled` and never rejects.
  - `WebPushGateway` takes an injectable `sendNotification`; its 410/404/429/500 → status and
    network-error → rejection mapping is unit-tested. Per-push timeout lowered from 10 s to 5 s.
  - The end-to-end expiry assertion now requires P09 to be alerted (deterministic drive).
  - Shutdown: `ShutdownStep.reserveMs` makes a step best-effort; the alert-dispatch wait gets the
    remaining budget minus 1 s, so the database pool step always runs.

- 2026-10-11: T5 done in six work-unit commits, each under the ~1.5k-line review budget and each
  building and passing its tests on its own (changed lines, lockfile untouched):
  - `cbca102` `fix(alerts): close the cancel race and harden background dispatch and shutdown` (593):
    the T4 findings above. RED first: 13 unit tests failed (cancel with the old token answered
    `cancelled` and revoked the re-subscribed row; no `household_route_mismatch`; the default-route
    tests saw 3 "Trip route could not be loaded" errors with `tripId: null`, and an inactive route
    auto-started a trip; `whenNotificationsSettled()` rejected with "log sink down"; the 6
    `WebPushGateway` tests reached the real `web-push` (p256dh validation error); the best-effort
    shutdown test saw no bounded wait). All GREEN after the fixes. The deterministic P09 expiry
    assertion passed as a characterization test.
  - `e23483c` `feat(routes): publish the active route catalog with geometry, points and schedule`
    (445): `GET /api/routes`, `GET /api/routes/:code` (`public, max-age=300`).
  - `d213491` `feat(live): serve the live route snapshot with ETA windows and signal status` (1171):
    new `live` context, `GET /api/live/routes/:code` (`no-store`), `etaDisplayWindow`,
    `telemetrySignal`.
  - `4e7f4f2` `feat(tracking): refresh active trip ETAs periodically between fixes` (606):
    `EtaRefreshService`/`EtaRefreshJob` (`ETA_REFRESH_INTERVAL_SEC`, default 15), `PeriodicJob`.
  - `f2a7cc2` `feat(live): stream live route events over Server-Sent Events` (982):
    `GET /api/live/routes/:code/stream`, `LiveStreamHub` (`SSE_MAX_CONNECTIONS`, default 500).
  - The last commit (the parent records the hash) `feat(indicators): log app views for the adoption
    indicator`: migration `0003-app-views`, `POST /api/usage/views`, `SubscriptionService.identify`.

  Verification at the last commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm format:check`
  clean, `pnpm test` 48 files / 333 tests passed (8 integration files on PostGIS). Smoke (compose db,
  `db:migrate` applied `0003-app-views`, `db:seed`, built API with command-line env): `GET
  /api/routes` 200 (`public, max-age=300`), `GET /api/routes/RI-01` 200 (17 coordinates, 15 points,
  6 planned starts), `GET /api/live/routes/RI-01` 200 (`no-store`); `curl -N` on the stream received
  `retry`, `snapshot`, `vehicle.position`, `trip.started`, `eta.updated`, `point.passed` (P01) and
  `alert.emitted` while 3 Traccar fixes were posted (200 each), with `text/event-stream`,
  `no-store` and `X-Accel-Buffering: no`; `POST /api/usage/views` 204 anonymous, 204 with a wrong
  token, 422 for `P99`; SIGTERM exited cleanly; containers removed, volumes kept. The smoke database
  held an active trip from an earlier smoke run whose fixes were dated 5 hours in the future (signal
  `live`, ETAs ~4.8 h); it was ended with `TripLifecycleService.endTrip` before posting fixes.

  Decisions: a new `live` bounded context owns the public live views (snapshot and stream) and
  their pure mapping; responses are parsed through zod schemas (unknown keys stripped; a `stale` ETA
  with a prediction fails the schema). The snapshot nests ETAs, passes and alerts per active trip
  (usually one). The display window is the remaining time ±max(60 s, 20 %), floor/ceil to whole
  minutes, at least one minute wide. `RouteSnapshot` gained `active`; inactive routes are hidden
  from the catalog and the live API. `vehicle.position` gained `routeId` and `eta.updated` gained
  `lastFixAt` (the stream derives the signal from it). Stream events carry no vehicle, alert or
  subscription ids; `trip.started` is minimal, and clients refetch the snapshot for the vehicle.
  The ETA refresh runs under the vehicle's `KeyedMutex` and publishes inside it, so it never reorders
  with ingestion; it never writes or alerts. App views store no IP or user agent; a wrong token
  records an anonymous view with the same 204; the per-IP limit is 10x
  `PUBLIC_RATE_LIMIT_PER_MINUTE`. A household may follow any point of its own route.
  Pending: `.env.example` must gain `ETA_REFRESH_INTERVAL_SEC` and `SSE_MAX_CONNECTIONS` (agents
  cannot edit `.env*` files). Follow-ups: a fix dated in the future keeps a trip `live` and delays
  the inactivity abort (ingestion should reject or clamp fixes far ahead of the server clock); the
  reverse proxy (T10) must not buffer `text/event-stream` and needs read timeouts above 15 s.

- 2026-10-11: T5's last commit is `38f530d`. T5 was reviewed in two slices, `7d80fb3..d213491` and
  `d213491..38f530d`; both were approved and acknowledged. The reviewed boundary is now `38f530d`. Its
  findings are handled in T6 commit A `fix(live): release early-disconnected streams and harden live
  reads and ingestion` (the parent records the hash):
  - WARNING (SSE slot leak): a client that disconnected while the route was looked up was registered
    after its `close` event had fired, leaking the slot, the bus subscriptions and the heartbeat.
    `LiveStreamHub.stream` now returns at once for a destroyed response (the check and the listener
    registration run synchronously).
  - Migration `0004-app-views-household-set-null`: `app_views.household_id` is `ON DELETE SET NULL`.
  - Fixes dated more than `MAX_FIX_FUTURE_SKEW_SEC` (default 120) ahead of the server clock are
    logged and ignored (`202 { status: "ignored", reason: "future_fix" }`, never stored).
  - `KyselyLiveRouteReadModel.activeTrips` runs in one read-only `REPEATABLE READ` transaction.
  - The background notification `.catch` guards its logger call.
  - New test for the `/api/usage/views` rate limit (10x the public limit per IP).

- 2026-10-11: T6 done in five work-unit commits, each under the ~1.5k-line review budget (changed
  lines, lockfile excluded) and each building and passing its tests on its own:
  - `43b1967` `fix(live): release early-disconnected streams and harden live reads and ingestion`
    (521): the T5 findings above. RED first: the disconnect-during-lookup stream test saw
    `hub.size` 1 instead of 0; deleting a household with views failed on
    `app_views_household_id_fkey`; a fix 121 s ahead answered `processed` instead of `future_fix`
    (and the route test 200 instead of 202, the config tests lacked `maxFixFutureSkewSec`); the
    read model test saw no `start transaction isolation level repeatable read read only` before
    its queries; a throwing logger produced an unhandled rejection (`log sink down`). All GREEN
    after the fixes. The `/api/usage/views` rate-limit test passed as a characterization test.
  - `8c3408a` `feat(web): add the citizen API client, QR deep link and live route state` (1211).
  - `aad40e8` `feat(web): show the truck on the map and its arrival at the household's point`
    (1305).
  - `7abe83d` `feat(web): make the citizen app an installable PWA whose service worker shows
    alerts` (504).
  - The last commit (the parent records the hash) `feat(web): subscribe households to proximity
    alerts with consent` (about 1.2k): push service, subscription card, iOS install steps,
    container wiring, README.

  Verification at the last commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm format:check`
  clean, `pnpm test` 60 files / 409 tests passed (web 12 files / 70 tests), `pnpm --filter web build`
  emitted `dist/sw.js` (15 precache entries) and `dist/manifest.webmanifest`. Smoke: compose db
  healthy, `db:migrate` applied `0004-app-views-household-set-null`, `db:seed`, built API with
  command-line VAPID keys; through the Vite dev server (:5173) `/` 200 (`text/html`),
  `/api/routes/RI-01` 200, `/api/live/routes/RI-01` 200, `/api/push/vapid-public-key` 200,
  `/manifest.webmanifest` 200, `/dev-sw.js?dev-sw` 200, the proxied stream sent `retry` and
  `snapshot`, `POST /api/usage/views` 204; through `vite preview` (:4173) `/`, `/sw.js`,
  `/manifest.webmanifest`, the icons and `/api/routes/RI-01` answered 200. API stopped with SIGTERM,
  containers removed, volumes kept. Real-browser push is left to the parent (Chrome).

  Decisions: `vite-plugin-pwa` 2.0.0 (peer `vite ^8`) with `injectManifest` and a TypeScript
  service worker (`src/sw/sw.ts`, `tsconfig.sw.json` with the WebWorker lib; the web project is
  now a solution `tsconfig.json` over app, node and sw projects, `tsc -b`). Leaflet 1.9.4 with
  react-leaflet 5 on OpenStreetMap tiles (circle markers and a `divIcon` truck, no image assets).
  The subscription credentials live in IndexedDB (`ruta-limpia` / `subscription`), shared with the
  service worker; route, point and household choices live in `localStorage`. Consent version
  `2026-10-v1`. Live data: SSE first; after 3 failures, polling every 30 s and a stream retry
  after 5 min. App views: page load, then on visibility at most every 5 min. Dependencies are
  injected through `CitizenDepsContext` (fakes in tests). New web variable
  `VITE_API_PROXY_TARGET` (dev/preview proxy, default `http://localhost:3000`); new API variable
  `MAX_FIX_FUTURE_SKEW_SEC` (default 120). Pending: `.env.example` must gain
  `MAX_FIX_FUTURE_SKEW_SEC` (agents cannot edit `.env*` files). Follow-ups: the main bundle is
  about 490 kB (150 kB gzip) with Leaflet; lazy-loading the map would help low-end phones.
  `push_subscriptions.household_id` still has no `ON DELETE` action, so deleting a household with
  subscriptions fails (T7 household registry).

- 2026-10-11: T6 was reviewed in three slices, `38f530d..8c3408a`, `8c3408a..7abe83d` and
  `7abe83d..cf4e353` (commits `43b1967 8c3408a aad40e8 7abe83d cf4e353`); all were approved and
  acknowledged. The reviewed boundary is now `cf4e353`.

- 2026-10-11: T7 split into T7a (backend, done) and T7b (panel UI, design system, T6 PWA
  hardening). T7a done in eleven work-unit commits, each under the ~1.5k-line review budget
  (changed lines, lockfile excluded) and each building and passing its tests on its own:
  - `730f91c` `test(live): close leftover sockets before closing the stream test servers` (3): a
    pre-existing flake (about 1 run in 5) where an aborted `fetch` left an undici keep-alive socket
    that held `app.close()` past the 10 s hook timeout.
  - `f421095` `feat(auth): add panel credential, lockout, session, role and CSRF policies` (442).
  - `39a0087` `feat(auth): add login, session and user administration use cases with scrypt
    hashing` (1279).
  - `82a88e3` `feat(auth): persist panel users, sessions and the audit trail` (590): migration
    `0005-panel-auth`.
  - `a39e0a6` `feat(auth): serve panel login, sessions, CSRF guard and user administration`
    (1284): `@fastify/cookie` 11.1.3, `user:create` CLI.
  - `12a727e` `feat(panel): add the fleet view, trip history and manual trip control` (1154):
    migration `0006-panel-operations`.
  - `a2f91e4` `feat(panel): add the incident log and the supervisor's live route view` (1169).
  - `ff414e1` `feat(field): manage the household registry and its QR stickers from the panel`
    (923): migration `0007-household-registry`.
  - `a0e27ff` `feat(field): record Instrument 2 point observation sheets from the panel` (1275):
    migration `0008-field-observations`.
  - `925a8de` `test: give the full-cost scrypt and SSE heartbeat tests room under a loaded
    parallel run` (6): both timed out once when `pnpm test` ran every project at once.
  - The last commit (the parent records the hash) `feat(field): record baseline Instrument 1 logs
    and unite them with the system log`: migration `0009-baseline-route-logs`, view
    `instrument1_export`, this document.

  Verification at the last commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0,
  `pnpm format:check` clean, `pnpm test` 75 files / 523 tests passed twice in a row (14 PostGIS
  integration files, 7 of them new for the panel). The intermediate commit `12a727e` was re-run alone in a worktree (api unit
  46 files / 341 tests, integration 10 files / 76 tests). Smoke (compose db, `db:migrate` applied
  0005–0009, `db:seed`, `user:create` from stdin for an admin and an observer, a short password
  refused with `weak_password (too_short)`, built API with `SESSION_COOKIE_SECURE=false` on the
  command line): login 200 with `Set-Cookie: rl_session=…; Max-Age=604800; Path=/api/panel;
  HttpOnly; SameSite=Strict` and `no-store`; wrong password and unknown user both 401 with the
  same body; `me` 200; a POST without `X-Requested-With` 403 `csrf_rejected` and one with a
  foreign `Origin` 403; household `H-001` 201 and its sticker 200
  (`/?r=RI-01&p=P08&h=H-001`); a field observation 201 with `exposureMinutes` 75 computed; panel
  live snapshot 200; logout 204 then `me` 401; no password, token or cookie in the API log; API
  stopped with SIGTERM, containers removed, volumes kept.

  Decisions: hashing with Node's scrypt (N=2^17, r=8, p=1, PHC string, NFC-normalized input, at
  most 2 concurrent hashes for memory); unknown usernames get an in-memory "phantom" lockout so
  `423 account_locked` does not enumerate accounts; lockout answers `423`, bad credentials `401`;
  a locked account burns the same verification work; the CSRF check also covers the login; the
  panel is one encapsulated Fastify scope with per-route access rules (`config.panel`), fail
  closed; sessions are revoked on role change, deactivation and password reset, and admins cannot
  demote or deactivate themselves; audit events are written after the action (an audit failure
  fails the request); manual trip ends keep `end_reason = manual` and the operator's reason in
  `trips.end_note`; panel alert statuses are `sent`, `preparing`, `waiting`, `not_sent`;
  household codes use a transaction-level advisory lock; the sticker falls back to the request
  origin without `PUBLIC_ORIGIN`; field sheets and baseline logs are replaced with `PUT` (whole
  document), observers read only their own records and may change them for 24 hours; the
  exposure is computed only when both times were observed; the observer role reads only its own
  field records (`field:read_own`). The incident `kind` is now a closed list (CHECK), so the
  ingest test's `blocked_street` incident became `route_change` (folded into `12a727e`).
  New env vars: `SESSION_COOKIE_SECURE` (true), `SESSION_IDLE_MINUTES` (480),
  `SESSION_ABSOLUTE_HOURS` (168), `LOGIN_RATE_LIMIT_PER_MINUTE` (10), `PUBLIC_ORIGIN` (unset).
  Pending: `.env.example` must gain these variables (agents cannot edit `.env*` files); production
  must set `PUBLIC_ORIGIN`. Follow-ups: the phantom lockout and the login rate limit are per
  process; `instrument1_export` has no HTTP endpoint yet (T8 exports).

## Next step

T7b: the municipal panel UI at `/panel` (login, live route with the pass table and alert status,
vehicles, trips and trip detail, incidents, households and stickers, Instrument 2 sheets,
baseline logs, user administration), a small design system, and the T6 PWA hardening, built on
the T7a endpoints documented in the README ("Municipal panel API").
