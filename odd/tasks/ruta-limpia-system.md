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
| T3 | Persistence + ingestion: schema/migrations, Traccar forward endpoint, tracking pipeline, Instrument 1 log | delegated (writer) | [ ] |
| T4 | Notifications: Web Push (VAPID), point subscriptions with consent/cancel, alert dispatch and delivery log | delegated (writer) | [ ] |
| T5 | Public API + SSE: routes, points, vehicle status, live ETA per point | delegated (writer) | [ ] |
| T6 | Citizen PWA: map, point selection, ETA, subscription flow, QR deep link, offline/printed fallback | delegated (writer) | [ ] |
| T7 | Municipal panel: auth/roles, live tracking, pass table, alert status, incidents, trips, field forms, household registry | delegated (writer) | [ ] |
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

## Next step

T3.
