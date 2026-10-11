# Ruta Limpia

Pilot system for the municipal waste-collection service in Independencia and Huaraz (Áncash, Peru). It
tracks the collection truck with a GPS tracker, estimates when it reaches each public reference point
(ETA), and sends proximity alerts to the households subscribed to that point. A municipal panel monitors
the route. The system also records the field instruments and computes the pilot's impact indicators.

The requirements come from the project proposal `Proyecto_RSU_Ruta_Limpia_2026.pdf`.

## Architecture

```mermaid
flowchart LR
  tracker["4G GPS tracker<br/>(GT06) or simulator (OsmAnd)"] -->|positions| traccar["Traccar<br/>protocol gateway"]
  traccar -->|"JSON forward<br/>X-Ingest-Token"| api["API<br/>Fastify + TypeScript"]
  api <--> db[("PostgreSQL 16<br/>+ PostGIS")]
  api -->|Web Push VAPID| push["Push services"]
  push --> pwa["Citizen PWA (/)"]
  api -->|"REST + SSE"| pwa
  api -->|"REST + SSE"| panel["Municipal panel (/panel)"]
```

- **Traccar** decodes the tracker protocols and forwards every position as JSON
  (`{ "position": {...}, "device": {...} }`, speed in knots) to `POST /ingest/traccar/positions`. It
  authenticates with the shared secret header `X-Ingest-Token`.
- **API** (`apps/api`) uses a hexagonal architecture organized by bounded context: `routes`, `tracking`,
  `eta`, `alerts`, `field`, `indicators`, `auth`. See [`apps/api/src/README.md`](apps/api/src/README.md).
- **Web** (`apps/web`) is a React app with two areas: the citizen view (`/`) and the municipal panel
  (`/panel`).

## Prerequisites

- Node.js 22 (see `.nvmrc`) and pnpm 10 (`corepack enable` picks the version pinned in `package.json`).
- Docker with Docker Compose v2.

## Setup

```bash
cp .env.example .env    # then set a real INGEST_TOKEN: openssl rand -hex 32
pnpm install
pnpm infra:up           # PostGIS on :5432, Traccar on :8082 (UI), :5055 (OsmAnd), :5023 (GT06)
pnpm dev                # API on http://localhost:3000, web on http://localhost:5173
```

Check the API with `curl http://localhost:3000/health`. Open the Traccar UI at http://localhost:8082. The
first account you register there becomes the administrator. Register each tracker as a device, using its
IMEI or simulator ID as the identifier.

### Local infrastructure notes

- `infra/docker-compose.yml` reads the root `.env` through `env_file`, so the file must exist before
  `docker compose -f infra/docker-compose.yml up -d`.
- Traccar stores its own data in a separate `traccar` database on the same PostGIS server. The database is
  created by `infra/db/init/` the first time the data volume starts. To recreate it, run
  `docker compose -f infra/docker-compose.yml down -v`. This deletes all local data.
- Traccar does not expand `${VAR}` placeholders in `traccar.xml`. It can read each setting from an
  environment variable named after the key (`forward.url` → `FORWARD_URL`) when
  `CONFIG_USE_ENVIRONMENT_VARIABLES=true`. `infra/traccar/entrypoint.sh` builds those variables (database,
  `FORWARD_URL`, `FORWARD_HEADER=X-Ingest-Token: <INGEST_TOKEN>`) from `.env`. It then starts Traccar with
  a clean environment, so unrelated variables such as the API's `DATABASE_URL` cannot leak into Traccar.
- By default, Traccar forwards to the API on the host
  (`http://host.docker.internal:3000/ingest/traccar/positions`). Change `TRACCAR_FORWARD_URL` when the API
  runs elsewhere, for example `http://api:3000/...` inside the same compose project.
- The official PostGIS image is published only for amd64. On Apple Silicon it runs under emulation.

## Scripts

| Command                           | Description                                         |
| --------------------------------- | --------------------------------------------------- |
| `pnpm dev`                        | Run the API (tsx watch) and the web app (Vite).     |
| `pnpm build`                      | Build every app (`tsc` for the API, Vite for web).  |
| `pnpm typecheck`                  | Type-check every package.                           |
| `pnpm lint`                       | ESLint (typescript-eslint, type-aware) on the repo. |
| `pnpm test`                       | Run every Vitest project (`api`, `web`).            |
| `pnpm format` / `format:check`    | Format with Prettier, or check the formatting.      |
| `pnpm infra:up` / `down` / `logs` | Manage the local Docker infrastructure.             |

## Repository layout

```text
apps/
  api/          Fastify API: src/<context>/{domain,application,infrastructure}, shared/, main.ts, config.ts
  web/          Vite + React app: citizen area (/) and municipal panel (/panel)
infra/
  docker-compose.yml   Local PostGIS + Traccar
  db/init/             Database initialization scripts
  traccar/             traccar.xml and the entrypoint wrapper
odd/tasks/      Feature plan and progress
```
