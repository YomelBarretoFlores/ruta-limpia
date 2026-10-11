# API source layout

The API follows a hexagonal architecture organized by bounded context ("screaming" layout): the top-level
folders name what the system does, not the technical layers.

| Context      | Responsibility                                                                          |
| ------------ | --------------------------------------------------------------------------------------- |
| `routes`     | Route catalog: route geometry and public reference points (for example RI-01, P01–P15). |
| `tracking`   | Vehicles, positions ingested from Traccar, trips, and point-pass detection.             |
| `eta`        | ETA estimation per reference point and telemetry staleness.                             |
| `alerts`     | Point subscriptions with consent, Web Push dispatch, and the alert log.                 |
| `field`      | Field instruments: point observations, household registry, incidents.                   |
| `indicators` | Impact indicators (ETA error, availability, adoption, ...) and CSV exports.             |
| `auth`       | Panel users, sessions, and role-based access.                                           |
| `shared`     | Cross-context kernel: common value objects, ports, and HTTP plumbing (`/health`).       |

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
- `eta/domain`: staleness, recent and historical speed, ETA estimation.
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
routes/infrastructure    KyselyRouteRepository (PostGIS → RouteSnapshot), KyselyReferencePointLookup
eta/application          SpeedProfileProvider (cached per route) over CompletedTripSamplesSource
eta/infrastructure       KyselyCompletedTripSamples (accepted positions of recent completed trips)
alerts/application       AlertNotifier port; PushAlertNotifier over the PushGateway and
                         AlertDeliveryStore ports; SubscriptionService (subscribe, cancel, receipts)
                         over the SubscriptionStore and ManagementTokens ports
alerts/infrastructure    WebPushGateway (web-push, VAPID), LoggingAlertNotifier (no VAPID),
                         KyselySubscriptionStore, KyselyAlertDeliveryStore, CryptoManagementTokens,
                         http/ (public subscription and receipt routes), vapid-keys-cli
field/application        HouseholdDirectory port (household registry: codes, never addresses)
field/infrastructure     KyselyHouseholdDirectory
tracking/application     ports (VehicleDirectory, TrackingStore/TrackingTransaction), TrackingEvents,
                         IngestPositionService, TripLifecycleService
tracking/infrastructure  KyselyTrackingStore, KyselyVehicleDirectory, http/ (Traccar ingest route,
                         payload schema, token check), InactivityJob
composition-root.ts      composeApi(): wires adapters to use cases (shared by main.ts and integration tests)
shutdown.ts              createShutdown(): ordered graceful shutdown with a hard deadline (used by main.ts)
```

### Tracking pipeline (`IngestPositionService`)

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

### Events (`TrackingEvents`, in-memory bus)

`vehicle.position`, `trip.started`, `trip.updated`, `trip.completed` (carries `status` completed or
aborted and `endReason`), `point.passed`, `eta.updated` (every point's `PointEta`; `stale` entries carry no
prediction) and `alert.emitted`. They are published only after the transaction commits.

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

### Persistence

PostgreSQL 16 + PostGIS through Kysely. Migrations are registered in code
(`shared/infrastructure/db/migrations`) and run by `db:migrate` or on API start. Integrity rules live in
the database: one active trip per vehicle (partial unique index), one pass and one alert per (trip, point),
unique Traccar position ids, unique push endpoints, one delivery per (alert, subscription), and a
household's point always belongs to its route. The `instrument1_route_log` view produces the Instrument 1 rows (dates in
America/Lima); the alert columns and the ETA error stay null when no alert was sent.
