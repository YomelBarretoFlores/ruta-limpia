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
