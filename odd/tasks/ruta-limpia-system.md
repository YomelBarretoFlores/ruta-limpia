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
| T7b-1 | Design system + citizen PWA redesign + T6 PWA hardening (and the T7a-hardening residual findings) | delegated (writer: 2+ non-trivial files) | [x] |
| T7b-2 | Municipal panel UI (`/panel`) on the design system | delegated (writer) | [x] |
| T7c | T7b-2 review follow-ups: account throttle redesign, household point resolve, citizen refetch jitter, panel fixes, trip map, bundle and precache guards | delegated (writer: 2+ non-trivial files) | [x] |
| T7d | T7c review follow-ups: per-network burst budget, shed-attempt release, throttled refusals without hashing, doc fixes, trip track decimation, panel renames | delegated (writer: 2+ non-trivial files) | [x] |
| T8 | Indicators and exports: KPI computation (Tabla 16), Instrument 3 surveys and import, CSV exports, panel screens | delegated (writer: 2+ non-trivial files) | [x] |
| T8b | T8 review follow-ups: sign-in place leak on store errors, headline counts, bounded indicator periods, survey edit clashes, CSV round-trip, survey editor read-only and unknown problems, period params | delegated (writer: 2+ non-trivial files) | [x] |
| T9 | Simulator (OsmAnd → Traccar) and end-to-end smoke test over the whole pipeline | delegated (writer: 2+ non-trivial files) | [x] |
| T9b | T9 review follow-ups: settle-flag ordering, lossless CSV restore, migration 0015 deploy order, simulator gap/timeout/route end, e2e robustness, root Vitest project | delegated (writer: 2+ non-trivial files) | [x] |
| T10 | Production deploy (compose + Caddy HTTPS, backups), data retention, operations and handover docs (OE5) | delegated (writer: 2+ non-trivial files) | [x] (repository scope; real VPS steps pending, see Progress) |

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

- 2026-10-11: T7a was reviewed in five slices, `cf4e353..39a0087`, `39a0087..a39e0a6`,
  `a39e0a6..12a727e`, `12a727e..ff414e1` and `ff414e1..8526846`; all were approved and
  acknowledged, with advisory findings (53, 27 of them warnings). The reviewed boundary is now
  `8526846`. Every warning was then fixed in four hardening commits (changed lines, lockfile
  excluded), each building and passing its tests on its own:
  - `d120eda` `fix(auth): shed hashing load and stop lockout from revealing or locking out
    accounts` (883): the scrypt queue is bounded (16 waiters, 5 s) and overload answers
    `503 auth_busy` with `Retry-After: 5`; a failed dummy hash is retried, not cached; login input
    is cut before normalization, lookup or hashing; the lockout counts failures per (account,
    client network /24 or /64, 5 → 15 min) and per account (50 → 15 min), and a paused attempt
    answers the generic `401 invalid_credentials` (the in-memory phantom lockout and `423` are
    gone), so nothing enumerates usernames, across restarts too, and a stranger cannot lock the
    owner out from another network; pauses are logged with the user id only; the failure and
    weak-password messages derive from the policy constants; README documents the threadpool
    bound and `UV_THREADPOOL_SIZE`.
  - `2834928` `fix(auth): commit user changes, session revocation and their audit atomically`
    (335): a `UnitOfWork` port (`KyselyUnitOfWork`, `inTransaction`); user changes, the sessions
    they end and their audit event commit together; audit `fields` come from a real diff; HTTP
    tests prove revocation on role change and password reset and the rollback when the audit write
    fails (a test trigger makes the audit insert fail).
  - `68087a1` `fix(panel): audit manual trip control atomically and upgrade legacy incidents`
    (527): `TrackingTransaction.recordAudit` writes `trip.started`/`trip.ended` in the trip
    transaction; `POST /trips/:id/end` takes `{ note }` (the end reason stays the typed `manual`);
    the fleet view reads each last fix with a LATERAL index probe; migration `0006` adds the
    incident constraints `NOT VALID` and the new `0010-incident-legacy-data` maps legacy rows
    (unknown kind → `other`, a point of another route cleared, both noted in the description) and
    validates them, tested on a database holding such rows; tests cover the trip detail's alert
    and incident mapping.
  - The last commit (the parent records the hash) `fix(field): commit field records with their
    audit, never reuse household codes, and answer races with 404`: incidents, households,
    observation sheets and baseline logs write through the unit of work; migration
    `0011-household-code-counter` keeps household codes monotonic; a record deleted during an edit
    answers `404`; `other_cause_text_without_other` is split from `other_cause_text_required`;
    incident date-filter, reopen and note-validation tests; this entry.

  Policy decisions: no answer reveals a pause (tradeoff: a paused user is not told so; the message
  says sign-in pauses after repeated failures); per-network counts live in process memory (a
  restart forgets them), the per-account count is stored with the user. Suggestions applied:
  maxmem headroom and hashing limits named, relock race test, password transport bound named
  (UTF-16 units), username rule built from constants, reset revocation atomic, trip status list
  and end-note limit named, edit-window messages from the constant, shared field helpers,
  open-incident tie-breaker, `windowSeconds`, migration notes in order. Suggestions skipped:
  `R3-absolute-lifetime-coverage` (unit-tested in `AuthService`; the HTTP path is the same
  code), `R3-afterall-undefined-api` and `R3-session-config-bounds` (test and config polish, no
  behavior risk), `R3-user-cli-untested` (needs a TTY/stdin harness; the CLI only wraps the tested
  use case), `R2-summary-field-rename` and `R2-duplicate-ordering` (API naming and sorting churn
  better settled with the T7b UI), `R3-summary-counts-invalid-fixes` (needs a product decision on
  what an outage gap is), `R3-service-date-boundary-untested` for trips (the same
  `AT TIME ZONE` pattern is now proved for incidents), `R3-reresolve-overwrites` (needs a product
  decision), `R4-sequential-pass-resolution` (at most 16 points per route; a batch resolver port
  can come with T8), `R3-trip-mismatch-untested` (branch shared with incidents, which test
  `unknown_trip`), `R2-empty-panel-routes` and `R2-unused-panel-http-exports` (no longer true:
  the routes array and schemas are used).

- 2026-10-11: the T7a-hardening commits `d120eda 2834928 68087a1 3ea76eb` were reviewed in two
  slices, `8526846..2834928` and `2834928..3ea76eb`; both were approved and acknowledged. The
  reviewed boundary is now `3ea76eb`.

- 2026-10-11: T7b split into T7b-1 (design system, citizen redesign, hardening; done) and T7b-2
  (panel UI). T7b-1 done in four work-unit commits (changed lines, lockfile excluded), each building
  and passing its tests on its own:
  - `c0e0676` `fix(auth): observe shed logins, cap account guessing at 20 and keep running pauses;
    diff field edits under a row lock` (399).
  - `c556401` `feat(web): add the civic design system foundation` (1090):
    `docs/design/design-system.md`, `tokens.css`, the primitives `Section` (replaces `Card`),
    `Button`, `Notice`, `Field`, `Status`, `Num`; a Vitest contrast check
    over `tokens.css`; Atkinson Hyperlegible Next self-hosted and precached.
  - `b781c01` `feat(web): redesign the citizen PWA on the civic design system` (1036).
  - The last commit (the parent records the hash) `fix(web): harden the citizen PWA against stale
    snapshots, failed loads, bad timestamps and storage failures`, with this entry.

  Verification at the last commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0,
  `pnpm format:check` clean, `pnpm test` 85 files / 631 tests passed, `pnpm --filter
  @ruta-limpia/web build` exit 0 (service worker `sw.js` and `manifest.webmanifest` emitted,
  precache 19 entries / 612 KiB with the two `woff2` files). Bundle: initial JS 492.5 kB (152.9 kB
  gzip) before, 343.6 kB (109.0 kB gzip) after, with the lazily loaded map chunk 156.4 kB (46.1 kB
  gzip); CSS 20.0 kB before, 9.4 kB initial + 16.2 kB with the map after. Smoke: a throwaway
  PostGIS container (`docker run`, port 55432; the compose `db` service reads the root `.env`,
  which agents may not read), migrations 0001–0011 and seed applied, built API with the env on the
  command line and fresh VAPID keys, `vite preview` with the proxy: `/` 200, `/api/routes/RI-01`
  200 through the proxy, `sw.js` and the manifest 200, Traccar-format fixes posted with the ingest
  token started a trip and gave P08 a live window; headless Chromium screenshots of the stale and
  live states; everything stopped, the container removed, project volumes untouched. One
  unexplained single failure in six full `pnpm test` runs during commit A (not reproduced in five
  reruns).

  Decisions: the font has `tnum` (checked with fontTools), so no Public Sans; inputs use a new
  `--rule-control` (`#8a877e`, 3.6:1) because `--rule-strong` is 2:1; `--ink-3` only on
  `--surface`; the focus ring has `outline-offset: 1px` so its ink inner ring shows; the alerts
  section is now titled "Avisos de llegada"; the per-account sign-in budget is 20 failures per 15
  minutes; a subscription whose credentials cannot be stored durably is cancelled on the server at
  once (kept in page memory, with a warning, only if that cancellation fails).

  Findings: T6 review (15) — `R3-stale-refresh-overwrites-stream`, `R3-unguarded-event-parse`,
  `R3-headers-instance-dropped`, `R3-route-resolution-no-retry`, `R3-invalid-iso-throws`,
  `R3-visibility-reporting-untested`, `R3-uncontrolled-client-navigate`, `R3-001` to `R3-007`:
  fixed in the last commit; `R3-eta-zero-branch-untested`: tests in `b781c01`. T7a-hardening
  review (11): all fixed in `c0e0676`, except that `R3-incident-audit-diff-unlocked` has no
  dedicated concurrency test (the row lock is in place) and `R3-auth-busy-admin-paths-untested` is
  covered for the password reset only (user creation goes through the same scope handler).
  Pending: the seed names the points "Reference point P08" (Spanish names belong in the seed);
  the Engram mirror of this document.

- 2026-10-11: the T7b-1 commits `c0e0676 c556401 b781c01 75d4944` were reviewed in two slices,
  `3ea76eb..c556401` and `c556401..75d4944`; both were approved and acknowledged. The reviewed
  boundary is now `75d4944`. The parent's visual QA of T7b-1 found the citizen map not fitted to
  the route, the "En vivo" header status contradicting a stale signal, and English seed point
  names; all three are fixed in the first T7b-2 commit and the seed commit.

- 2026-10-11: T7b-2 done in fourteen work-unit commits (changed lines, lockfile excluded), each
  building and passing its tests on its own:
  - `3978ae6` `fix(web): fit the citizen map to the route and show the truck signal as the arrival
    status` (431): map fitted with 24 px padding and refitted on a route change, 280/320 px tall,
    8 px points; the header status is the truck signal and the connection shows only when
    degraded; `R3-trip-started-refetch-exhausted` (events of unknown trips no longer overtake a
    refetch; a failed or overtaken round runs again 5 s later, five rounds);
    `R2-doc-border-contradiction`.
  - `237cb49` `fix(field): name the seed points in Spanish and resolve a household point only
    when it changes` (54): "Av. Centenario · punto 1…15"; `R3-household-point-resolve-always`.
  - `70f6f18` `fix(auth): throttle account guessing with growing intervals instead of a low hard
    lock` (438): per account, after 10 consecutive failures the next attempt waits 2^(n−10) s (at
    most 60 s), early attempts get the generic 401 without scrypt (`login_blocked`
    `account_throttled`); 100 failures in a 24-hour window pause the account until the window
    ends; the per-network pause (5 / 15 min) stays; migration `0012-account-throttle`.
  - `5a822bb` panel API client and formats (824); `703e5c3` lazily loaded panel, sign-in, session
    and shell (1161); `52bd863` Usuarios (1014); `705cfae` En vivo (1239); `b1d395f` trip control
    and incidents from the live view (543); `2ff15d9` Viajes and trip detail (652); `e7896e3`
    Incidencias (552); `df29df6` Hogares and QR stickers (992, adds `qrcode` 1.5.4);
    `0d167a8` Fichas de campo (1386); `e30630c` Línea base (685).
  - The last commit (the parent records the hash) `fix(web): polish the panel after visual QA and
    keep it out of the citizen precache`, with this entry: panel base size 16 px, fractional zoom
    so a long route fills a short map, two-line point cells, a phone top bar, "Panel conectado"
    for the stream (not "en vivo", which belongs to the GPS signal), sign-in help, the dev/preview
    proxy keeps the `Host` header (sign-in through :5173/:4173 was refused as `csrf_rejected`),
    the service worker no longer precaches the panel chunks, README panel section.

  Verification at the last commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm
  format:check` clean, `pnpm test` 100 files / 702 tests passed, `pnpm --filter @ruta-limpia/web
  build` exit 0. Bundle: citizen entry JS 347.8 kB (110.4 kB gzip), unchanged by the panel; the
  panel chunk 122.2 kB (33.6 kB gzip) plus its map 1.9 kB, sharing the Leaflet chunk (155.0 kB,
  45.5 kB gzip) with the citizen map; precache 20 entries / 617 KiB without the panel. Visual QA
  with the scratchpad stack (throwaway PostGIS, built API, `vite preview`), an admin and an
  observer created with the user CLI, the truck driven along RI-01, headless Chromium
  screenshots of the citizen live and stale pages, the panel sign-in, En vivo (live, stale,
  phone), trip detail, Hogares, the printed stickers, Incidencias, Usuarios and the phone field
  sheet; the stack was stopped and the container removed.

  Findings (T7b-1 review WARNINGs): `R3-trip-started-refetch-exhausted`, `R2-doc-border-contradiction`,
  `R3-household-point-resolve-always`: fixed; `R2-citizen-field-duplicate`: already resolved by
  `b781c01` (the citizen form uses the shared `Field`, `.input` and `--rule-control`). Lockout:
  the 20-failure account pause is replaced by NIST-style throttling (see above). Tradeoffs: a
  throttled attempt answers faster than a checked one, so its timing shows the account exists and
  is under attack; the owner may wait up to a minute between tries during an attack. Pending:
  the Engram mirror of this document.

- 2026-10-11: T7b-2 reviewed in five slices, all approved and acknowledged: `75d4944..5a822bb`
  (four lenses), then `5a822bb..52bd863`, `52bd863..b1d395f`, `b1d395f..df29df6` and
  `df29df6..d7af82e` (one lens each). The reviewed boundary is now `d7af82e`.

- 2026-10-11: T7c (the T7b-2 review follow-ups) done in five work-unit commits (changed lines,
  lockfile excluded), each building and passing its tests on its own. Route: delegated writer
  (trigger: 2+ non-trivial files).
  - `e5ebe91` `fix(auth): reserve throttled attempts under the row lock, hash them like any
    failure and spare known networks` (672): a throttled attempt burns the dummy scrypt
    verification through the bounded queue and answers the generic 401 (the README no longer
    says it is faster); `reserveAttempt` checks the spacing and reserves the slot in one locked
    read-modify-write before hashing (integration test: eight concurrent attempts at interval
    expiry, one password check); attempts from a known network (a successful sign-in from that
    /24 or /64 within 30 days) skip the spacing, while the per-network 5 / 15 min pause and the
    100-in-24 h pause still apply (integration test: the attacker's network throttled, the
    owner's known /24 signs in during the attack); a successful sign-in ends the spacing but keeps
    the window's failure count (`window_failures`), so the owner's sign-in does not reset the
    attacker's daily budget. Migration `0013-known-networks`: `last_failed_at` →
    `last_attempt_at`, `window_failures`, `user_known_networks` (SHA-256 of user id and network,
    pruned after 30 days at each sign-in, cleared by a password reset). Also
    `R2-dead-window-fallback`.
  - `9f221a5` `fix: resolve a household's new point outside the row lock and spread citizen trip
    refetches` (148): the point is resolved before the transaction and the locked row's route is
    checked (integration test: no resolve while the lock is held); refetch rounds wait a random
    delay of up to 5, 10, 20 and 40 s, and a newer `trip.started` cancels the running chain (test:
    two events in quick succession keep the five-round cap).
  - `c1512a9` `fix(web): handle a failed sign-out, guard the user editor and the live forms, and
    assert the panel stays out of the citizen bundle` (583): sign-out never rejects; the user
    editor refuses a blank name and an empty save; the start-trip form defaults to a free vehicle;
    the panel connection restarts at "Conectando…" per route; the incident form drops a trip that
    ended; LivePage test titles fixed and the missing tests added; the bundle guard scans every
    non-panel module (side-effect imports, `export … from`); `pnpm build` runs
    `scripts/check-precache.mjs`, which fails when a panel-only file (chunk, CSS, a `qrcode`
    chunk) is in the service worker precache; `TruckSignalStatus` in its own module;
    `localToday` by parts from a module-level formatter; `safeReturnPath` table test.
  - `33d52e5` `fix(web): stop silent data loss and stuck screens in the panel registries and field
    records` (456): reopen guarded and its failure shown as an error; validated `tipo`/`estado`
    links; the consent date says why it is refused; no empty route filter; baseline passes at
    retired points stay visible and are sent; route load failures show a retry; field sheet
    counts must be whole numbers; a sheet at a retired point keeps its music; failure-path tests.
  - The last commit (the parent records the hash) `feat(web): set the trip's GPS track apart from
    the planned route on the trip map`, with this entry: the map fits the route and the track
    together; the track is a solid 3 px ink line with a 2 px dot per position; the planned route
    steps back to 4 px accent at 35 % over a 7 px casing; caption updated; design-system rule.

  Verification at the last commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm
  format:check` clean, `pnpm test` 104 files / 769 tests passed, `pnpm --filter
  @ruta-limpia/web build` exit 0 (precache 20 entries / 617.6 KiB, `check-precache`: none of the
  3 panel-only files precached; citizen entry 347.9 kB, 110.4 kB gzip). The trip map styling was
  not checked visually in a browser (Leaflet needs a real layout; unit tests cover the styles and
  the bounds).

  Findings → outcome. Fixed: `R1-throttle-timing-enumeration`, `R1-throttle-check-outside-lock`,
  `R4-owner-throttle-starvation`, `R4-refetch-retry-sync`, `R3-refetch-round-race`,
  `R3-resolve-inside-tx`, `R2-dead-window-fallback`, `R2-localToday-misnamed`,
  `R2-truck-signal-in-connection-badge`, `R3-signout-unhandled-rejection`, `R3-editor-blank-name`,
  `R3-safe-return-coverage`, `R3-bundle-guard-narrow`, `R3-start-trip-disabled-default`,
  `R3-connection-not-reset-on-route-change`, `R3-livepage-test-titles-overclaim`,
  `R3-polling-fallback-untested`, `R3-incident-stale-trip`, `R3-reopen-untested-and-unguarded`,
  `R3-enroll-date-silent-reject`, `R3-trips-empty-route`, `R3-failure-paths-uncovered`,
  `R3-baseline-route-load-failure-spins` (a failed route load; see below),
  `R3-baseline-drops-passes-of-inactive-points`, `R3-field-sheet-music-dropped-without-route-point`,
  `R3-field-sheet-invalid-numbers-silently-null`, `R3-precache-exclusion-unasserted`. Not changed:
  `R3-incident-description-null-dropped` (the API takes `description` as a string and clears it
  with `''`, which the web already sends; a test proves it); `R3-use-async-stale-untested`
  (test-only suggestion, not in this task's list). Residual: when the route catalog itself never
  loads on a first visit (no remembered route), the baseline editor still says "Cargando…"; the
  shell does not expose the catalog's load state. Surface note: the migration needed the
  registration in `migrator.ts` and the table types in `database.ts`, and the throttle docs in
  `apps/api/src/README.md` (outside the listed surfaces, mechanical). Pending: the Engram mirror
  of this document.

- 2026-10-11: the T7c commits were reviewed as one slice, `d7af82e..aeee04d` (four lenses), approved
  and acknowledged. The reviewed boundary is now `aeee04d`. Its advisory findings are handled in
  T7d.

- 2026-10-11: T7d and T8 done in eleven work-unit commits (changed lines, lockfile excluded), each
  building and passing its tests on its own. Route: delegated writer (trigger: 2+ non-trivial
  files).
  - `cfa4470` `fix(auth): bound bursts per network, give back shed attempts and refuse throttled
    ones without hashing; decimate the trip track` (941), T7d. RED first: 6 `AuthService` tests
    failed against the previous service (a burst of 8 from a known network got 8 password checks,
    a shed check kept the reserved slot, a throttled flood with a one-slot scrypt queue shed the
    other account's sign-in with `auth_busy`, and the refusal tests still saw dummy hashes); all
    GREEN after: attempts in flight count as provisional failures of their source
    (`admitSourceAttempt` / `settleSourceAttempt`, known networks included, entries with attempts
    in flight never evicted); a shed check gives back its slot (`releaseAttempt`) and its place;
    paused and throttled attempts wait one of the last 32 measured real verification durations
    (`VerificationTiming`, 400 ms before any, 5 ms–6 s) instead of burning scrypt. Doc fix
    (`R2-failed-attempts-doc-mismatch`): the code's meaning was kept and documented —
    `failedAttempts` counts the consecutive failures of the current 24 h window since the last
    success, so the per-window cap (`windowFailures`) is untouched. Deploy note: stop the old API
    before migrating `0013`. Web: at most 200 track dots on one canvas renderer, `FitRouteBounds`
    keyed by the extent; `reopening` boolean, `fieldErrors`, a preset incident trip kept while the
    trips load (`tripsLoading`).
  - `d591304` `feat(field): record incomplete exposures and window comparability, and add the
    household survey table` (150): migration `0014-indicator-inputs` (`exposure_incomplete`,
    `comparable_window`, `household_surveys` with `UNIQUE (household_id, wave)`, the post-only
    CHECK and the not-heard CHECK; `ON DELETE CASCADE` from households). RED: the field test saw
    the flags dropped.
  - `2bb89ba` `feat(indicators): compute the Tabla 16 indicators and the paired tests from
    recorded inputs` (1105): pure domain (median, proportions, relative change with the zero
    baseline rule, McNemar exact, Wilcoxon signed-rank exact/normal checked against scipy 1.17).
  - `d5b5ddc` `feat(indicators): serve the Tabla 16 indicators of a route and a period to the
    panel` (1201): `GET /api/panel/indicators`, one read-only `REPEATABLE READ` snapshot, new
    permissions `indicators:read` (observers too), `surveys:read`, `surveys:write`,
    `exports:read`; PostGIS tests with hand-computed values (`test/support/indicator-fixtures.ts`),
    `docs/indicators.md`.
  - `564168a` `feat(field): record Instrument 3 household surveys from the panel` (876) and
    `5dae2d6` `feat(field): import household surveys from a CSV file, all or nothing` (929):
    survey CRUD, in-repo RFC 4180 reader/writer (BOM, CRLF, quoting, formula neutralization),
    per-row error report, one audited import event, batch id, template.
  - `0850f5a` `feat(indicators): export the instruments, the indicators and the weekly use as
    CSV` (806): `instrumento1/2/3.csv`, `indicadores.csv` (long form), `uso.csv`.
  - `ccce187` (774), `f7bee0f` (1230), `33a4f27` (297): panel Indicadores, Encuestas, CSV import.
  - The last commit (the parent records the hash) `feat(web): download the CSV exports and record
    the Instrument 2 flags on the field sheet`, with this entry (about 600 with docs): Exportaciones,
    the two Instrument 2 controls (RED: two editor tests failed before), README, design-system
    note, visual QA fixes (a flex button dropped the space in "Descargar instrumento1.csv"; page
    notes spaced; "Pre y post" sub-label).

  Verification at the last commit: see the writer's report (`pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm test`, `pnpm --filter @ruta-limpia/web build`). Visual QA with the
  scratchpad stack (throwaway PostGIS, built API, `vite preview`, the indicator fixture seeded,
  an admin from the user CLI): headless Chromium screenshots `qa-t8-indicators`, `qa-t8-surveys`,
  `qa-t8-import-errors`, `qa-t8-exports`, `qa-t8-survey-form-phone` (390 px) and
  `qa-t8-field-sheet-flags-phone`; the stack was stopped and the container removed.

  Parent decisions for the T8 open questions (recorded in `docs/indicators.md`): (1) a dispersion
  event is an Instrument 2 record with `dispersion` `few` or `many`, the exit phase is `post`,
  broken bags and waste left are secondary rates only, the two new flags exist and incomplete
  exposures are reported apart and kept out of the I2 median; (2) availability uses consecutive
  60 s intervals over each trip's `[started_at, ended_at]` (running trips up to now) in the
  period, available when the latest valid position at or before the interval end is ≤ 60 s old;
  (3) adoption is per America/Lima week, numerator = active households with a linked app view or
  a `sent` delivery, views without household excluded, denominator = active households enrolled by
  the week's end, plus the stricter `received_at` rate; an I6 "active user" meets the rule in at
  least one week; (4) phases are not stored: every request takes the route and `from`/`to`, field
  indicators use the stored phase. Implementation choices beyond them: a position must also be
  received by the interval end to count (I7); `comparable_window = false` excludes a sheet from I3
  and I8 only; I5 pools household-weeks; a zero baseline leaves a reduction target "Sin datos";
  target labels in `indicadores.csv` start with a comparison so spreadsheets never read them as
  formulas; the comparability control is a Sí/No radio pair (a nullable answer), the incomplete
  exposure a checkbox. Pending: the Engram mirror of this document; cost per household needs the
  executed budget (divide by I6 `activeHouseholds`).

- 2026-10-11: the T8 commits were reviewed in five slices, all approved and acknowledged:
  `aeee04d..2bb89ba` and `2bb89ba..564168a` (four lenses each), `564168a..0850f5a`,
  `0850f5a..f7bee0f` and `f7bee0f..40cabc9` (one lens each). The reviewed boundary is now
  `40cabc9`. Their advisory findings are handled in T8b.

- 2026-10-11: T8b and T9 done in five work-unit commits (changed lines, lockfile excluded), each
  building and passing on its own. Route: delegated writer (trigger: 2+ non-trivial files).
  - `738ccca` `fix(api): settle sign-in places on every path, bound indicator periods and harden
    survey edits` (529), T8b. RED first: 4 `AuthService` tests (a store failing in the
    known-network lookup, the slot reservation or the success record left `inFlight` raised; six
    outages locked the owner's network) → GREEN with one held attempt settled in a `finally`
    (`giveBack`: the place if unsettled, the slot if the check never ran; its own failure logged,
    never thrown over the original). Headline counts are the post phase's (RED: I2 unit and
    integration). Periods bounded to 120 days with a clear `400` (RED: integration) plus a 15 s
    `statement_timeout` on the snapshot. Details rounded to 2 decimals in the view and
    `indicadores.csv`. Survey edits check the household/wave clash inside the `UPDATE`; new
    integration tests for the clash (409, no audit event, next edit commits), 404 for unknown and
    malformed ids, 422 unknown household, observer 403 on read/edit/delete, lower-case household
    filter, `too_many_rows` and the 1 MiB `413`. CSV import restores neutralized text (RED:
    round-trip test). Shared `householdCodeSchema`; `o.id` tiebreaker on `instrumento2.csv`;
    split `INTERVAL_SEC`/`FRESHNESS_SEC`; docs (period bound, headline counts, migrations
    0012–0014 and an additive-0014 deploy note).
  - `338d902` `fix(web): explain unknown survey problems, show surveys read-only and validate
    period params` (727), T8b. RED: unknown problem codes and the read-only view (editor tests),
    a malformed `hasta` and a 121-day period (indicators page test, against the old page), a
    missing `comparableWindow` (field sheet test, against the old mapping). Shared `chosenPeriod`
    for Indicadores and Exportaciones; `FitRouteBounds` keyed by four numbers; new tests for
    edit/delete/load error/API problems, the reversed export period, every import refusal message
    and "Sin respuesta".
  - `352eed7` `fix(tracking): accept positions Traccar forwards before storing them` (113), found
    by the e2e smoke: Traccar 6.16 runs `PositionForwardingHandler` before `DatabaseHandler`, so
    forwards carried `id: 0`; the API answered 400 and only Traccar's retry (stored id) got
    through (observed: 44 × 400 then 44 × 200, and one fix lost; retries are 10 with backoff, then
    dropped). RED: payload unit test and ingest integration test. Migration
    `0015-positions-without-traccar-id`: nullable Traccar id, unique `(vehicle_id, fix_time)`
    replacing the plain index, earlier replays collapsed to their first row; insert
    `ON CONFLICT DO NOTHING`. The "same fix under a new Traccar id" replay is now one row (test
    updated).
  - `cff678d` `feat(simulator): bootstrap Traccar and drive RI-01 over OsmAnd` (794), T9.
    `tools/simulator` workspace package (TypeScript, tsx), importing the RI-01 fixture and route
    geometry from `apps/api/src/routes/domain`. `sim:bootstrap` (first admin only when
    `newServer`, Basic auth, GET-or-POST device), `sim:drive` (20 s fixes, 3.5 m/s, 40 s stops,
    noise with seed, signal gap, speedup, dry run). 14 unit tests; `pnpm test` runs them after
    the Vitest projects (the root `vitest.config.ts` is outside this task's surfaces).
  - `4c513aa` `test(e2e): smoke the whole pipeline through Traccar 6.16 and document the checks`
    (457), T9. `pnpm test:e2e` (`apps/api/vitest.e2e.config.ts`): PostGIS (alias `db`, plus a
    `traccar` database) and `traccar/traccar:6.16.0-alpine` with the repository's `traccar.xml`
    and entrypoint, forwarding to the in-process API through `host.testcontainers.internal`.
    Clock: the composition root's injectable clock (`ManualClock`) is moved to each fix's time;
    no production change. Fixes are dated 30 min in the past (Traccar's `filter.future`); each
    takes about 3 s (Traccar's `server.buffering.threshold`, 3000 ms). Docs:
    `docs/simulator.md`, `docs/ops/push-check.md`, `tools/simulator/README.md`, README.
  - Skipped T8 findings: `R2-004` (the exports the doc cites shipped in `0850f5a`), `R2-005`
    (the import and the `exports:read` guard shipped in `5dae2d6`/`0850f5a`),
    `R3-migration-0014-absent` was not a missing file (`0014` is in `d591304`; documented). No
    rate limit on the indicators route (authenticated panel route; bounded period and timeout
    instead).
  - Surface notes: `apps/api/vitest.e2e.config.ts` is outside `apps/api/tsconfig.json`'s
    `include`, so the e2e test imports its `E2E_TIMEOUT_MS` (which brings it into the type-aware
    lint). `.env.example` should gain `TRACCAR_ADMIN_EMAIL`/`TRACCAR_ADMIN_PASSWORD` (not
    editable by the writer).

  Verification at the last commit: see the writer's report (`pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm test`, `pnpm --filter @ruta-limpia/web build`, `pnpm test:e2e`
  about 150 s). Pending: the Engram mirror of this document; the manual Web Push check
  (`docs/ops/push-check.md`) on a real Chrome.

- 2026-10-11: the T9 commits were reviewed in two slices, both approved and acknowledged:
  `40cabc9..352eed7` (four lenses) and `352eed7..ca0fb4f` (one lens). The reviewed boundary is
  now `ca0fb4f`. Their advisory findings are handled in T9b.

- 2026-10-11: T9b and T10 done in four work-unit commits (changed lines, lockfile excluded), each
  building and passing on its own. Route: delegated writer (trigger: 2+ non-trivial files).
  - `880749d` `fix: settle sign-in places only once stored, make CSV restore lossless and harden
    the simulator and e2e smoke` (302), T9b. RED first: two `AuthService` tests (the source
    store rejecting the settle after a wrong and after a correct password left `inFlight: 1`) →
    GREEN with the settled flag set only after the store call; a CSV round-trip test of authored
    `'=…`/`''+…` text (lossy before) → GREEN by giving such text one more apostrophe on export;
    three simulator tests (gap NaN/negative/infinite refused, the route-end fix kept inside a
    gap, an OsmAnd fetch that never answers fails after the timeout) → GREEN. Migration 0015's
    deploy order (stop the old API first) and its `positions` insert lock documented in the
    migration and `src/README.md`. E2E: bootstrap in `beforeAll` (no test-order dependency),
    the stale ETA always checked (the last fix before the gap is computed), teardown runs every
    step and reports an `AggregateError`. `apps/api/vitest.e2e.config.ts` is in the API
    tsconfig (the `E2E_TIMEOUT_MS` import is gone); the simulator is a root Vitest project
    (`pnpm test` is plain `vitest run`).
  - `feb61ab` `feat(infra): production compose with Caddy HTTPS, compiled API image and daily
    backups` (1048), T10. `infra/prod/`: `api.Dockerfile` (multi-stage, `pnpm deploy --prod`,
    `node` user, compiled JS and 29 MB of production modules only; migrate/seed/user/VAPID as
    `node dist/...`; `:dist` package scripts), `web.Dockerfile` (web build → Caddy 2.10),
    `Caddyfile`, `docker-compose.prod.yml` (project `ruta-limpia-prod`), `backup/`
    (`run.sh`, `backup.sh`, `restore.sh`), root `.dockerignore`. Docs: `docs/ops/deploy.md`,
    `configuration.md`, `runbook.md`, `backup-restore.md`.
  - `3aff035` `feat(privacy): purge households' personal data after the retention period` (718),
    T10. `privacy` context: `resolveCutoff` (default 2027-12-20, Lima midnight, a future cutoff
    refused; 4 unit tests, RED as a missing module), `purgePersonalData` (one transaction; 4
    PostGIS integration tests: what is purged and kept, the audit event without personal data,
    dry run changes nothing, a second run changes nothing), `data:purge` / `data:purge:dist`
    CLI. `docs/ops/data-retention.md`.
  - `fe7fc2d` `docs(entrega): panel manual, households' guide, escalation protocol and handover
    record` (368), T10, in neutral Spanish.

  Decisions:
  - `MIGRATE_ON_START=false` in production: 0013 and 0015 need the old API stopped first, a
    backup precedes any schema change, and a restarting container must never migrate by
    surprise. Upgrade order: backup, build, stop api, `migrate` with the new image, `up -d`.
  - Secrets: two operator files outside the repo (`/etc/ruta-limpia/ruta-limpia.env` for db,
    api, traccar, backup; `caddy.env` with only the domain and ACME e-mail), so the internet-facing
    Caddy never holds the database password or the VAPID key. `TRUST_PROXY`,
    `SESSION_COOKIE_SECURE`, `NODE_ENV` and the forward URL are fixed in the compose file. The
    `backend` network is internal (db and backup have no internet); the API also joins `edge`
    for Web Push; Traccar has a fixed `edge` address (172.30.57.10) for the SSH tunnel to its UI
    (8082 never published).
  - Caddy: `/ingest/*` answers 404; `/api/*` and `/health` proxied with the Host kept,
    `flush_interval -1`, upstream read and header timeouts 60 s, no server write timeout, SSE
    excluded from compression; `index.html`, `sw.js`, the manifest and SPA routes `no-cache`,
    `/assets/*` one year `immutable`, icons one week, a missing asset 404 (not the shell).
    Headers: HSTS (no preload, no subdomains), CSP `default-src 'self'`, `script-src 'self'`,
    `style-src 'self' 'unsafe-inline'` (Leaflet and the truck `divIcon`), `img-src 'self' data:
    https://tile.openstreetmap.org`, `connect-src`/`worker-src`/`manifest-src 'self'`,
    `frame-ancestors 'none'`; `Permissions-Policy` denies geolocation (the app never uses it),
    camera and microphone; `nosniff`, `Referrer-Policy`, `X-Frame-Options`.
  - Backups: `postgres:16-alpine` with a 20 s scheduler loop (no cron, no tzdata: `TZ=<-05>5`),
    `pg_dump -Fc` of `ruta_limpia` and `traccar`, read back with `pg_restore --list`, written
    under a temporary name, `umask 077`, 7 daily + 4 weekly (Sunday hard links), healthcheck
    unhealthy after 26 h without a dump.
  - Retention scope: deletes push subscriptions whose last activity is before the cutoff (and
    their deliveries) and deliveries sent before it; clears household/subscription links of
    earlier views; anonymizes (`ANON-` + 10 hex, notes erased, later links cleared) households
    inactive since before it. Kept: trips, positions, passes, alerts with emission time,
    communicated ETA and counts, incidents, field records, baseline logs, surveys, household
    rows, views (point, time), staff accounts and audit. Adoption (I5, I6) for purged weeks can
    no longer be recomputed: export first (documented).
  - Traccar defaults deduplicated: removed the forward-URL fallback from `entrypoint.sh` (now
    required; set by each compose file: host in dev, `http://api:3000/...` in prod, the test's
    own in the e2e) and its copy in the README; the JVM default stays only in the entrypoint.
    `osmand.port`/`gt06.port` stay in `traccar.xml` as the single listener definition.

  Findings: `R3-settle-flag-before-store` fixed; `R3-old-build-unique-violation`, `R4-001`
  fixed (documented deploy order and window, in the migration, `src/README.md` and
  `deploy.md`); `R2-001`, `R3-restore-strips-authored-apostrophe` fixed (lossless, not just
  documented); the six t9r2 suggestions fixed. Skipped: `R2-002`, `R2-003`
  (`pilot-periods.ts` comments) and `R2-004` (renaming `checkAdmitted`): outside the brief's
  cheap list; candidates for a later cleanup.

  Local production rehearsal (Docker Desktop, `RUTA_LIMPIA_DOMAIN=localhost`, so Caddy used its
  local CA; env files in the scratchpad, never committed): `docker compose config --quiet` OK;
  images built; `migrate` and `seed` through the compiled CLIs; all five services `healthy`.
  Through Caddy: `/health` 200; `http://` → 308 to `https://`; `/`, `/panel/seguimiento`,
  `/sw.js`, the manifest `no-cache`; `/assets/index-*.js` `immutable` with `zstd`; icons one
  week; a missing asset 404; `GET` and `POST /ingest/traccar/positions` 404; all security
  headers present. SSE: Traccar bootstrapped from inside the network, `sim:drive --speedup 20`
  over the published OsmAnd port; `curl -N` through Caddy received 125 events (snapshot,
  trip.started, 49 vehicle.position about 1.0 s apart, matching the send cadence, 15
  point.passed, 52 eta.updated, 6 alert.emitted, trip.completed) plus heartbeats; the stream
  had no `content-encoding`. The API logged the client address from `X-Forwarded-For`.
  Panel: an admin from `user-cli.js`, login through Caddy `200` with `rl_session` `HttpOnly;
  Secure; SameSite=Strict; Path=/api/panel`, `/auth/me` 200, a foreign `Origin` 403. Headless
  Chromium: no CSP violation on the citizen page and the panel, 12 OSM tiles 200, panel sign-in
  and **En vivo** rendered (the service worker does not register on the local CA's untrusted
  certificate). Backups: the first backup ran at start; a manual run restored into
  `ruta_limpia_restore_check` and `traccar_restore_check` with identical counts (49 positions,
  1 trip, 15 passes, 6 alerts, 1 user, 2 audit events, 15 migrations; route 1 280 m; Traccar 1
  device, 1 user, 50 positions); `restore.sh` refused an existing target without `--replace`;
  rotation with `BACKUP_KEEP_DAILY=2` kept two. `purge-cli.js` refused the default (future)
  cutoff and dry-ran `--before 2026-10-11`. Torn down with `down -v` (the `ruta-limpia-prod_*`
  volumes and networks removed) and the rehearsal images deleted. Incident: the first attempt
  used the project name `ruta-limpia`, the same as the dev compose, so its `db` started on the
  existing dev volume `ruta-limpia_db-data`; the password did not match, `migrate` and `seed`
  failed authentication and nothing was written; the container was removed and the project
  renamed `ruta-limpia-prod`. After the rehearsal, weekly backups were renamed one per day
  (`<db>-YYYYMMDD.dump`), checked with `sh -n` only.

  Verification at the last code commit: `pnpm typecheck` exit 0, `pnpm lint` exit 0,
  `pnpm format:check` clean, `pnpm test` 126 files / 922 tests passed,
  `pnpm --filter @ruta-limpia/web build` OK (precache 20 entries, no panel file),
  `pnpm test:e2e` 2 passed (about 150 s).

  Remaining human-only steps: rent the VPS and the domain, DNS, first deploy (`deploy.md`);
  register the real Traccar administrator and the GT06 tracker (IMEI, APN, 15–30 s); the
  manual Web Push check in Chrome and on a phone (`docs/ops/push-check.md`); confirm the
  retention period with the municipality; hosting after the 3 paid months; the handover session
  and the signed `acta-transferencia`; review `.env.example` (not readable by the writer): it may
  still list `TRACCAR_FORWARD_URL` (now set by the dev compose) and lacks
  `TRACCAR_ADMIN_EMAIL`/`TRACCAR_ADMIN_PASSWORD`. Pending: the Engram mirror of this document.

  Objective status: the software, the production stack and the handover documents are complete
  in the repository and rehearsed locally; the objective ("ready to deploy on one VPS") is met
  for the repository, but the pilot is not yet deployed or verified on the real VPS, tracker and
  phones.

## Next step

Review the T9b/T10 commits (`ca0fb4f..fe7fc2d`), then the human-only steps above: VPS and
domain, first deploy, real tracker, Web Push check, retention confirmation, handover session.
