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
routes/infrastructure    KyselyRouteRepository (PostGIS → RouteSnapshot)
eta/application          SpeedProfileProvider (cached per route) over CompletedTripSamplesSource
eta/infrastructure       KyselyCompletedTripSamples (accepted positions of recent completed trips)
alerts/application       AlertNotifier port (Web Push adapter in T4)
alerts/infrastructure    LoggingAlertNotifier (placeholder)
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
- The route and profile caches drop a failed load only while it is still the current entry, so a late
  failure never evicts a newer load that followed an invalidation.

`TripLifecycleService` provides `startTrip` (manual), `endTrip` (recorded as aborted) and
`closeInactiveTrips`, which the `InactivityJob` runs periodically.

### Events (`TrackingEvents`, in-memory bus)

`vehicle.position`, `trip.started`, `trip.updated`, `trip.completed` (carries `status` completed or
aborted and `endReason`), `point.passed`, `eta.updated` (every point's `PointEta`; `stale` entries carry no
prediction) and `alert.emitted`. They are published only after the transaction commits.

### Persistence

PostgreSQL 16 + PostGIS through Kysely. Migrations are registered in code
(`shared/infrastructure/db/migrations`) and run by `db:migrate` or on API start. Integrity rules live in
the database: one active trip per vehicle (partial unique index), one pass and one alert per (trip, point),
and unique Traccar position ids. The `instrument1_route_log` view produces the Instrument 1 rows (dates in
America/Lima); the alert columns and the ETA error stay null when no alert was sent.
