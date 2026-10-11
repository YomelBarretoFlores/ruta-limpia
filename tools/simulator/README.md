# @ruta-limpia/simulator

Drives a simulated collection truck along route RI-01 through Traccar, as a real 4G tracker would:
OsmAnd fixes to Traccar on `:5055`, which forwards them to the API. It reuses the API's RI-01 fixture
and route geometry (`apps/api/src/routes/domain`), so it drives exactly the seeded route.

## Quick path (against `infra/docker-compose.yml`)

```bash
pnpm infra:up && pnpm dev            # PostGIS, Traccar, the API and the web app
TRACCAR_ADMIN_EMAIL=admin@example.org TRACCAR_ADMIN_PASSWORD='<a strong password>' \
  pnpm sim:bootstrap                 # first Traccar admin + the truck's device (idempotent)
pnpm sim:drive                       # about 16 minutes, in real time
```

The scripts also read the root `.env` when it exists, so the two `TRACCAR_ADMIN_*` values can live
there instead of on the command line. The password is never printed.

## Commands

| Command                    | What it does                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm sim:bootstrap`       | Creates the first Traccar administrator on a new server, then the device whose `uniqueId` is the vehicle's, only when missing. |
| `pnpm sim:drive`           | Sends one OsmAnd fix every 20 s along RI-01, stopping 40 s at each of P01–P15.                                                 |
| `pnpm sim:drive --dry-run` | Prints the planned fixes without sending them.                                                                                 |

## Settings

| Variable                 | Default                 | Used by   |
| ------------------------ | ----------------------- | --------- |
| `TRACCAR_URL`            | `http://127.0.0.1:8082` | bootstrap |
| `TRACCAR_ADMIN_EMAIL`    | required                | bootstrap |
| `TRACCAR_ADMIN_PASSWORD` | required                | bootstrap |
| `TRACCAR_DEVICE_NAME`    | `Unidad A`              | bootstrap |
| `SEED_VEHICLE_UNIQUE_ID` | `ruta-limpia-unidad-a`  | both      |
| `OSMAND_URL`             | `http://127.0.0.1:5055` | drive     |

Drive options (`pnpm sim:drive --help`): `--interval` 15–30 s, `--speed` m/s, `--dwell` s, `--noise`
metres of GPS error (with `--seed`), `--gap-at`/`--gap-for` for a signal gap (over 60 s turns the ETA
stale), `--speedup` to compress time.

More: [`docs/simulator.md`](../../docs/simulator.md), including the end-to-end smoke test.
