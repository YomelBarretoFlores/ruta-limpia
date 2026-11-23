# Ruta Limpia: handover guide

Start here if your team is taking over this project. This page explains what the system is, where things
live, what is finished, and what is still open. The full technical reference is the [README](README.md).

## 1. What the system does

Ruta Limpia is a pilot for the municipal waste-collection service in Independencia and Huaraz (Áncash,
Peru):

1. A 4G GPS tracker (GT06) in the collection truck reports its position every 15–30 s.
2. The system estimates when the truck reaches each public reference point on the route (ETA).
3. Households that subscribed to a point get a Web Push alert when the truck is close (one alert per trip
   and point).
4. Municipal staff follow the route live in a panel, log incidents and field observations, and export the
   pilot's impact indicators as CSV.

The requirements come from the project proposal (`Proyecto_RSU_Ruta_Limpia_2026.pdf`). The PDF is not in the
repository. Ask the previous team or the municipality for a copy.

## 2. Architecture in one minute

```text
GPS tracker (GT06, TCP 5023) ──► Traccar ──JSON forward──► API (Fastify, TypeScript) ◄──► PostgreSQL 16 + PostGIS
                                                             │
                                          REST + SSE + Web Push
                                                             ▼
                                   Citizen PWA (/)   ·   Municipal panel (/panel)
```

- **Traccar** (`infra/traccar`) decodes the tracker protocol and forwards every position to
  `POST /ingest/traccar/positions` with the `X-Ingest-Token` header.
- **API** (`apps/api`) uses a hexagonal architecture organized by bounded context (`routes`, `tracking`,
  `eta`, `alerts`, `live`, `field`, `indicators`, `auth`, `privacy`). Each context has `domain/`,
  `application/` and `infrastructure/` layers, and ESLint keeps `domain/` free of framework imports. Read
  [`apps/api/src/README.md`](apps/api/src/README.md) before changing the API.
- **Web** (`apps/web`) is one React app with two areas: the citizen PWA (`/`) and the municipal panel
  (`/panel`). The design rules are in [`docs/design/design-system.md`](docs/design/design-system.md).
- **Simulator** (`tools/simulator`) drives a fake truck along route RI-01 so you can test without the real
  tracker.

## 3. Run it locally (about 10 minutes)

Requirements: Node.js 22, pnpm 10 (`corepack enable`), Docker with Compose v2.

```bash
cp .env.example .env            # set INGEST_TOKEN: openssl rand -hex 32 (at least 32 characters)
pnpm install
pnpm infra:up                   # PostGIS + Traccar
pnpm --filter api db:migrate
pnpm --filter api db:seed       # route RI-01, points P01–P15, truck UNIDAD-A
pnpm dev                        # API http://localhost:3000 · web http://localhost:5173
pnpm sim:bootstrap && pnpm sim:drive   # register and drive the simulated truck
```

To use the panel you need a user. See
[Creating the first administrator](README.md#creating-the-first-administrator).

## 4. Checks before every change

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test        # unit + integration (integration tests start PostGIS with Testcontainers, so Docker must run)
pnpm test:e2e    # end-to-end smoke test over the whole pipeline (Traccar → API → alerts)
```

At handover, all checks pass: 128 test files with 944 tests, plus 2 end-to-end tests.

## 5. Where to find things

| You need to…                                  | Read                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Understand every endpoint and screen          | [`README.md`](README.md)                                              |
| Change the API                                | [`apps/api/src/README.md`](apps/api/src/README.md)                    |
| Deploy to production (one VPS)                | [`docs/ops/deploy.md`](docs/ops/deploy.md)                            |
| Know every environment variable               | [`docs/ops/configuration.md`](docs/ops/configuration.md)              |
| Operate the system day to day, handle outages | [`docs/ops/runbook.md`](docs/ops/runbook.md)                          |
| Back up and restore the databases             | [`docs/ops/backup-restore.md`](docs/ops/backup-restore.md)            |
| Apply the personal-data retention (Ley 29733) | [`docs/ops/data-retention.md`](docs/ops/data-retention.md)            |
| Verify Web Push on real devices               | [`docs/ops/push-check.md`](docs/ops/push-check.md)                    |
| Understand how indicators are computed        | [`docs/indicators.md`](docs/indicators.md)                            |
| Use the simulator                             | [`docs/simulator.md`](docs/simulator.md)                              |
| Train citizens and municipal staff (Spanish)  | [`docs/entrega/`](docs/entrega/) (manuals, escalation, handover acta) |
| See why things were built the way they are    | [`odd/tasks/ruta-limpia-system.md`](odd/tasks/ruta-limpia-system.md)  |

The `odd/tasks/` file is the development log: requirements quoted from the proposal, every task, the review
findings, and the decisions behind them. Search it before you change a behavior that looks odd.

## 6. Status at handover

**Done:** all the software in the repository is built and reviewed: ingestion, ETA, alerts, the citizen
PWA, the municipal panel, the indicators and CSV exports, the simulator, the production stack (Docker
Compose + Caddy HTTPS + daily backups) and the operations and handover documents.

**Not done yet (needs people, accounts or hardware):**

1. Rent the VPS (2 vCPU x86-64, 2 GB RAM + 2 GB swap, 40 GB SSD) and the domain, set up DNS, and do the first
   deploy ([`docs/ops/deploy.md`](docs/ops/deploy.md)).
2. Register the real Traccar administrator and the GT06 tracker (IMEI, the SIM's APN, 15–30 s interval).
3. Run the manual Web Push check in Chrome and on a phone ([`docs/ops/push-check.md`](docs/ops/push-check.md)).
4. Confirm the data retention period with the municipality and change `RETENTION_MONTHS` if needed.
5. Decide the hosting after the three paid months.
6. Hold the handover session and sign
   [`docs/entrega/acta-transferencia.md`](docs/entrega/acta-transferencia.md).
7. Review `.env.example` against [`docs/ops/configuration.md`](docs/ops/configuration.md). Some variables
   added late may be missing from the example file.

**Known open suggestions (not bugs):** tests for an interrupted restore swap, and documenting that a scratch
restore needs twice the database's disk space. See the end of the development log.

## 7. Hosting: why a VPS

The tracker talks raw TCP to Traccar on port `5023`. Platforms that only route HTTP traffic, such as Vercel
or Render, cannot receive it, so the whole stack runs on one VPS with Docker Compose. A split setup (API and
database on a managed platform, Traccar on a small VPS) is possible but costs more and is not prepared.

## 8. Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Test first for behavior changes: write the failing test, then the fix.
- Code, comments, docs and UI copy for developers are in English. Citizen- and staff-facing manuals in
  `docs/entrega/` and the seed's place names are in Spanish.
- Never commit `.env`. Only `.env.example` is tracked.
