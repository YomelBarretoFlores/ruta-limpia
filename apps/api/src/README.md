# API source layout

The API follows a hexagonal architecture organized by bounded context ("screaming" layout): the top-level
folders name what the system does, not the technical layers.

| Context      | Responsibility                                                                           |
| ------------ | ---------------------------------------------------------------------------------------- |
| `routes`     | Route catalog: route geometry and public reference points (for example RI-01, P01–P15).  |
| `tracking`   | Vehicles, positions ingested from Traccar, trips, and point-pass detection.              |
| `eta`        | ETA estimation per reference point and telemetry staleness.                              |
| `alerts`     | Point subscriptions with consent, Web Push dispatch, and the alert log.                  |
| `live`       | Public live views of a route: snapshot (trips, signal, ETAs, passes, alerts) and stream. |
| `field`      | Field instruments: point observations, baseline logs, household registry, incidents.     |
| `indicators` | Impact indicators (ETA error, availability, adoption, ...) and CSV exports.              |
| `auth`       | Panel users, sessions, and role-based access.                                            |
| `shared`     | Cross-context kernel: common value objects, ports, and HTTP plumbing (`/health`).        |

Each context has three layers:

- `domain/`: pure business rules (entities, value objects, policies). No I/O, no framework imports.
- `application/`: use cases that orchestrate the domain through ports (interfaces).
- `infrastructure/`: adapters that implement ports (PostgreSQL, Fastify routes, Web Push, Traccar).

Dependencies point inward: `infrastructure → application → domain`. ESLint enforces that `domain/` code does
not import frameworks, Node built-ins, or outer layers. `main.ts` is the composition root that wires
adapters to use cases; `app.ts` assembles the Fastify instance.

## Domain core

The tracking pipeline is pure and deterministic: time is always passed in, nothing reads the clock.

```text
PositionFix → advanceTrip (tracking) → TripState + TripEvents (point_passed, off_route, ...)
            → observeProgress (eta)  → recent effective speed (EWMA)
            → estimateEtas (eta)     → PointEta per point: live | stale | passed | not_started
            → decideAlerts (alerts)  → AlertDecision, at most one per (trip, point)
```

- `shared/domain/geo.ts`: haversine distance and a local equirectangular projection.
- `routes/domain`: `Route`, `ReferencePoint`, route geometry (chainage, lateral offset, chainage
  windows) and point validation.
- `tracking/domain`: `PositionFix`, the trip state and lifecycle, progress and pass detection.
- `eta/domain`: staleness and the public telemetry signal (`live`/`stale`/`none`), recent and
  historical speed, ETA estimation, and the citizen display window (`etaDisplayWindow`: remaining
  time ±max(1 min, 20 %) in whole minutes).
- `alerts/domain`: the alert policy and the ETA error indicator.

Every context exports its tunables as a typed `DEFAULT_*_SETTINGS` object that the application
layer can override.

The RI-01 fixture (`routes/domain/ri01.fixture.ts`) holds the route and the P01–P15 coordinates
from the proposal. Tests, seed data and the simulator share it so they all use the same geometry.
`alerts/domain/ri01-drive.scenario.test.ts` drives the whole pipeline over a stop-and-go run.

A point is passed when progress reaches its exact chainage (no tolerance, so a truck stopping just short
of a point does not pass it early). Trip completion passes every remaining point first (`upper_bound`
for the final stretch the truck never reached).

## Application and infrastructure

```text
shared/application       Clock, Logger, EventBus<T> ports; KeyedMutex (per-key serialization)
shared/infrastructure    system clock, InMemoryEventBus, db/ (Kysely types, migrations, migrator, seed, CLI)
routes/application       RouteCatalog (cached) over the RouteRepository port
routes/application       ReferencePointLookup port (public points by id or code)
routes/application       PublicRouteQueries port (active catalog: summaries, detail, schedule)
routes/infrastructure    KyselyRouteRepository (PostGIS → RouteSnapshot), KyselyReferencePointLookup,
                         KyselyPublicRouteQueries, http/ (GET /api/routes, /api/routes/:code)
live/application         LiveSnapshotService over the LiveRouteReadModel port; live-views (pure
                         mapping to the public JSON views, shared by the snapshot and the stream)
live/application         live-event-views (pure mapping and route filtering of the streamed tracking
                         events to public views)
live/infrastructure      KyselyLiveRouteReadModel (one read-only REPEATABLE READ transaction per read), http/ (GET /api/live/routes/:code and its /stream,
                         zod response schemas), sse/ (LiveStreamHub: SSE streams with heartbeat,
                         connection cap and shutdown close; wire format)
eta/application          SpeedProfileProvider (cached per route) over CompletedTripSamplesSource
eta/infrastructure       KyselyCompletedTripSamples (accepted positions of recent completed trips)
alerts/application       AlertNotifier port; PushAlertNotifier over the PushGateway and
                         AlertDeliveryStore ports; SubscriptionService (subscribe, cancel, receipts)
                         over the SubscriptionStore and ManagementTokens ports
alerts/infrastructure    WebPushGateway (web-push, VAPID), LoggingAlertNotifier (no VAPID),
                         KyselySubscriptionStore, KyselyAlertDeliveryStore, CryptoManagementTokens,
                         http/ (public subscription and receipt routes), vapid-keys-cli
auth/application         AuthService (login, session validation, logout) and UserAdminService over
                         the UserStore, SessionStore, PasswordHasher and SessionTokens ports
auth/infrastructure      ScryptPasswordHasher (bounded queue, load shedding), CryptoSessionTokens,
                         KyselyUserStore, KyselySessionStore, InMemoryLoginSourceStore (per-network
                         login failures), user-cli (user:create), http/ (panel guard: cookie,
                         CSRF and role checks; /api/panel/auth/*, /users, /audit-events)
shared/application       AuditLog and AuditTrail ports; UnitOfWork port (a change and its audit event
                         in one transaction); shared/infrastructure: audit/KyselyAuditLog,
                         db/KyselyUnitOfWork (and inTransaction for stores' own multi-statement writes)
indicators/application   AppViewService (app views for the adoption indicator) over the AppViewStore
                         and SubscriberIdentification ports (SubscriptionService.identify provides it)
indicators/infrastructure KyselyAppViewStore, http/ (POST /api/usage/views)
field/application        IncidentService (report, list, edit, resolve; audited) over the IncidentStore
                         port; field/infrastructure: KyselyIncidentStore, http/panel-incident-routes
live/application         PanelLiveService (public snapshot + pass table with alert status and
                         delivery counts + open incidents; pure mapping in panel-live-views) over
                         the PanelLiveReadModel port; live/infrastructure: KyselyPanelLiveReadModel,
                         http/panel-live-routes (/api/panel/live/routes/:code)
routes/application       RoutePointResolver port (active route and point codes for the panel);
                         routes/infrastructure: KyselyRoutePointResolver
field/application        HouseholdRegistryService (enroll with the next H-### code, list with
                         subscription status, move, deactivate, delete, sticker link) over the
                         HouseholdStore port; field/infrastructure: KyselyHouseholdStore (code
                         counter row locked per enrollment), http/panel-household-routes
field/domain             point-observation (Instrument 2 rules: exposure, consistency problems),
                         field-record-access (own records editable for 24 h), household-code
field/application        FieldObservationService over the FieldObservationStore port;
                         field/infrastructure: KyselyFieldObservationStore,
                         http/panel-field-observation-routes
field/application        BaselineLogService (manual Instrument 1 logs with point passes) over the
                         BaselineLogStore port; field/infrastructure: KyselyBaselineLogStore,
                         http/panel-baseline-log-routes
field/application        HouseholdDirectory port (household registry: codes, never addresses)
field/infrastructure     KyselyHouseholdDirectory
tracking/application     ports (VehicleDirectory, TrackingStore/TrackingTransaction), TrackingEvents,
                         IngestPositionService, TripLifecycleService
tracking/application     PanelTripService (fleet signal, trip history with track summary, audited manual
                         start and end) over the TripHistoryQueries port
tracking/infrastructure  KyselyTripHistoryQueries, http/panel-trip-routes (/api/panel/vehicles, /trips)
tracking/application     EtaRefreshService (republishes every active trip's ETAs at the current time)
tracking/infrastructure  KyselyTrackingStore, KyselyVehicleDirectory, KyselyTripReader, http/ (Traccar
                         ingest route, payload schema, token check), InactivityJob, EtaRefreshJob
shared/infrastructure    PeriodicJob (non-overlapping interval runs, failures logged; both jobs use it)
composition-root.ts      composeApi(): wires adapters to use cases (shared by main.ts and integration tests)
shutdown.ts              createShutdown(): ordered graceful shutdown with a hard deadline (used by main.ts)
```

### Tracking pipeline (`IngestPositionService`)

A fix dated more than `MAX_FIX_FUTURE_SKEW_SEC` (default 120 s) ahead of the server clock is logged
and ignored before anything else (`future_fix`, answered `202` so Traccar does not retry it): it would
keep a trip `live` and delay the inactivity abort.

Per forwarded position, serialized per vehicle by an in-process `KeyedMutex` and, inside one transaction,
by `SELECT … FOR UPDATE` on the vehicle and its active trip (which also covers several API processes):

1. Store the position (`ON CONFLICT (traccar_position_id) DO NOTHING`: a replay is a no-op).
2. Lock the active trip, or auto-start one when the vehicle has a default route and the fix lies on it
   (offset ≤ off-route threshold) within the start zone.
3. `advanceTrip` → record passes, trip state and the position outcome (`chainage_m`, `off_route`);
   `observeProgress` updates the persisted recent speed.
4. Unless the trip completed: `estimateEtas` with the route's historical speed profile, then
   `decideAlerts` with the already-alerted points. Alerts wait for a speed basis (a measured recent speed
   or a profile): an ETA resting on the default speed alone is published but never alerted on. Alerts are
   inserted with `ON CONFLICT (trip_id, point_id) DO NOTHING`; the database is the final guard.
5. After commit: publish events, call the `AlertNotifier` for newly inserted alerts, and invalidate the
   route's speed profile when the trip completed.

Degraded inputs never block a vehicle's positions:

- When the historical speed profile cannot be loaded, a warning is logged and the ETA uses the recent
  speed only.
- When the route of the active trip is missing or cannot be loaded, the position is stored and linked to
  the trip without advancing it, and an error is logged with the trip and vehicle ids. The inactivity job
  ends the trip if the route stays unavailable.
- Without an active trip, a missing or inactive default route only prevents auto-start: it is warned
  once per vehicle and process. A failure to load it is logged as a skipped auto-start on each fix.
- The route and profile caches drop a failed load only while it is still the current entry, so a late
  failure never evicts a newer load that followed an invalidation.

`TripLifecycleService` provides `startTrip` (manual), `endTrip` (recorded as aborted) and
`closeInactiveTrips`, which the `InactivityJob` runs periodically.

`EtaRefreshService` runs every `ETA_REFRESH_INTERVAL_SEC` (`EtaRefreshJob`): for each active trip,
under the vehicle's `KeyedMutex` (so it never interleaves with a fix of that vehicle), it re-reads the
trip, estimates the ETAs at the current time from the persisted state, the recent speed and the cached
speed profile, and publishes `eta.updated`. Countdowns advance and stale telemetry suspends the
predictions between fixes. It never writes and never emits alerts.

### Events (`TrackingEvents`, in-memory bus)

`vehicle.position`, `trip.started`, `trip.updated`, `trip.completed` (carries `status` completed or
aborted and `endReason`), `point.passed`, `eta.updated` (every point's `PointEta`, plus the trip's
`lastFixAt`; `stale` entries carry no prediction) and `alert.emitted`. They are published only after
the transaction commits. `vehicle.position` carries the trip's `routeId` (null without a trip) so the
live stream can filter by route.

### Live stream (`LiveStreamHub`)

Each SSE stream subscribes to the streamed tracking events (`trip.updated` stays internal), maps them
with `toLiveStreamEvent` (null for other routes, invalid fixes and points no longer on the route), and
writes them after the initial `snapshot`; events that arrive while the snapshot is built are queued. The
hub caps open streams (`SSE_MAX_CONNECTIONS`), sends a heartbeat every 15 s, disconnects a client whose
unsent output exceeds 1 MiB, never registers a client that disconnected before its stream was set up
(for example during the route lookup), releases everything when the response closes, and ends every
stream in Fastify's `preClose` hook so graceful shutdown is not held by open streams.

### Subscriptions (`SubscriptionService`)

A citizen subscribes one browser to one public reference point with explicit consent; the HTTP adapter
rejects requests without `consent: true`. The service accepts only endpoints of the browser push
services (`alerts/domain/push-endpoint.ts`), so the API never posts to arbitrary hosts. It resolves the
point by id or by code (plus the route code when a code repeats across routes) and the optional household
code; a household may follow any point of its own route, never one of another route
(`household_route_mismatch`). It issues a random management token and stores only its SHA-256 hash.
Upserting by endpoint keeps the subscription id, moves it to the new point and rotates the token.
`cancel` compares the token in constant time and soft-deletes the subscription with one conditional
UPDATE on the verified hash, so a re-subscription racing the cancel is never revoked by the old token.

### Alert dispatch (`PushAlertNotifier`)

`IngestPositionService` hands newly inserted alerts to the `AlertNotifier` after the commit, in the
background: the ingest response never waits for push services, and `whenNotificationsSettled()` lets
shutdown and tests wait for them. Each background run ends with a logging error handler, so it can
never become an unhandled rejection, and `whenNotificationsSettled()` never rejects. On shutdown this
wait is best-effort: it gets the remaining budget minus a 1 s reserve, so the database pool always
closes (`WebPushGateway` uses a 5 s per-push timeout). The composition root uses `PushAlertNotifier` with `WebPushGateway`
when VAPID is configured, and `LoggingAlertNotifier` (with a startup warning) otherwise.

Per alert, `PushAlertNotifier` loads the active subscriptions of the point and sends the payload built by
`alerts/domain/proximity-alert-message.ts` (Spanish copy, America/Lima time), a few at a time
(`runWithConcurrency`). `alerts/domain/push-delivery.ts` classifies each answer (`2xx` sent, `404`/`410`
expired, anything else or no answer failed) and gives the TTL and topic. Each outcome is recorded in
`alert_deliveries`; expired subscriptions are revoked, and failures revoke a subscription after a streak
(one SQL statement, safe under concurrency). Finally the alert counts are recomputed from its deliveries.
Errors are logged per subscription and never reach the ingest.

### Panel access (`auth`)

The domain holds the rules: `credentials` (12–256 characters, case-insensitive usernames),
`lockout-policy` (five failures from one network pause it for 15 minutes; per account, attempts
are spaced out after ten failures and 100 failures in 24 hours pause the account),
`session-policy` (idle and absolute lifetimes, touch interval), `role` (the permission matrix;
code asks `can(role, permission)`, never compares role names) and `csrf-policy` (custom header
plus `Origin` check). `AuthService` burns one password verification for unknown and inactive
users; a paused or throttled attempt waits as long as a recent real verification instead
(`VerificationTiming`, fed by every real verification), so it costs no hashing. Before hashing it
takes a provisional place in the source's budget (`admitSourceAttempt`; attempts in flight count as
failures, settled by `settleSourceAttempt`), decides the account's spacing and reserves the
attempt's slot under the row lock (`reserveAttempt` through `modifyLoginState`), skips the spacing
for the account's known networks (`KnownNetworkStore`, a successful sign-in within 30 days), gives
the slot and the place back when the hasher sheds the check (`releaseAttempt`), counts failures
under the row lock,
opens a fresh session at each login and revokes the presented one. `UserAdminService` revokes a
user's sessions on a role change, a deactivation or a password reset.

All panel routes live in one encapsulated Fastify scope under `/api/panel`. `installPanelGuard`
registers `@fastify/cookie` and an `onRequest` hook that runs the CSRF check, resolves the session
cookie and checks the route's access rule (`config.panel`: `public`, `authenticated`, a permission
or `{ anyOf }`; routes without a rule need a session). Other contexts add their panel routes through
`PanelRouteRegistration` functions in the composition root, and read the actor with `actorOf`.

### Impact indicators (`indicators`)

`indicators/domain` is pure: `statistics` (median, proportions, the relative change with the
zero-baseline rule, McNemar's exact test, the Wilcoxon signed-rank test), `impact-indicators` (the
nine definitions of Tabla 16, their counts, changes, paired tests and target states) and `adoption`
(weekly use per household). `IndicatorService` reads the recorded inputs of a route through the
`IndicatorReadModel` port (`KyselyIndicatorReadModel`, one read-only `REPEATABLE READ` snapshot) and
computes them; `GET /api/panel/indicators?route=&from=&to=` serves them (`indicators:read`). The
operational definitions and the pilot's methodological decisions are in `docs/indicators.md`.

### Household surveys (`field`, Instrument 3)

`field/domain/household-survey` holds the answer codes and the consistency rules (questions 6–11
only in the post wave, "No la escuché" never with a score). `HouseholdSurveyService` creates, edits
and deletes surveys and imports a CSV file all or nothing (every row checked first; one upsert per
household and wave in one transaction with its audit event). `shared/domain/csv` is the RFC 4180
reader and writer (BOM, CRLF, quoting, formula neutralization); `field/infrastructure/survey-csv`
maps the survey columns both ways.

### Persistence

PostgreSQL 16 + PostGIS through Kysely. Migrations are registered in code
(`shared/infrastructure/db/migrations`) and run by `db:migrate` or on API start. Integrity rules live in
the database: one active trip per vehicle (partial unique index), one pass and one alert per (trip,
point), unique Traccar position ids, unique push endpoints, one delivery per (alert, subscription), and
a household's point always belongs to its route. `app_views` (migrations `0003-app-views` and
`0004-app-views-household-set-null`: deleting a household or a subscription keeps its views and clears
the link) logs app views with the point, the subscription and household only when proven by the
management token, and the time; never an IP address or a user agent. `0005-panel-auth` adds `users` (unique lower-case username), `sessions` (SHA-256 token hash only)
and `audit_events` (append-only; the user link is cleared when a user is deleted).
`0006-panel-operations` adds `trips.end_note` and incident tracking (closed list of kinds, reporting
and resolving user, resolution; the point must belong to the route). Its incident constraints are
added `NOT VALID`; `0010-incident-legacy-data` maps incidents recorded before them (a free-text kind
becomes `other`, a point of another route is cleared, both noted at the start of the description,
which is cut to 1000 characters) and then validates the constraints, so older databases upgrade
instead of failing. `0007-household-registry` makes `push_subscriptions.household_id`
`ON DELETE SET NULL` and adds the enrolling user and `updated_at` to `households`.
`0008-field-observations` stores the Instrument 2 sheets (`field_observations`, local dates and
times, photo codes only). `0009-baseline-route-logs` stores the hand-written baseline logs and
creates the `instrument1_export` view (system and baseline rows, `source` column).
`0011-household-code-counter` keeps the last generated household code, so a code is never reused.
`0014-indicator-inputs` adds the Instrument 2 flags `exposure_incomplete` and `comparable_window`
and the Instrument 3 table `household_surveys` (one row per household and wave; questions 6–11
only in the post wave; deleted with its household).
The `instrument1_route_log` view
produces the Instrument 1 rows (dates in America/Lima); the alert columns and the ETA error stay null
when no alert was sent.

#### Deploy notes

- **Stop the old API before migrating (from `0013-known-networks` on).** `0013` renames
  `users.last_failed_at` to `last_attempt_at` in place instead of expanding and contracting the
  schema. An API process of an earlier build still reads and writes `last_failed_at`, so once the
  migration commits every sign-in on that process fails with a database error. The pilot runs a
  single API instance, so the order is: stop the API, run `db:migrate` (or start the new build,
  which migrates on start), then start the new build. Rolling the code back likewise needs the
  migration's `down` first.
