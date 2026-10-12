# Deploying Ruta Limpia to a VPS

One small VPS runs everything with Docker Compose: PostGIS, Traccar, the API, Caddy (HTTPS and the
web app) and a daily backup job. This guide takes an operator from an empty server to a working
pilot, then covers upgrades. Every variable is in [`configuration.md`](configuration.md); daily
operations and incidents are in [`runbook.md`](runbook.md).

## Quick path

1. Rent the VPS and point the domain at it ([1](#1-server-and-domain), [2](#2-prepare-the-server)).
2. Write the two secret files ([3](#3-secrets)).
3. Build, migrate, seed, start ([4](#4-first-start)).
4. Create the Traccar administrator and the truck's device through an SSH tunnel ([5](#5-traccar)).
5. Create the first panel administrator ([6](#6-first-panel-administrator)).
6. Check everything ([7](#7-verify)).

## 1. Server and domain

The budget (proposal, Tabla 14, p. 24) covers a VPS from a provider that issues Peruvian receipts
for 3 months (S/ 80 per month) and a domain for 1 year (S/ 60).

| Resource | Minimum                                      | Why                                                                |
| -------- | -------------------------------------------- | ------------------------------------------------------------------ |
| CPU      | 2 vCPU, x86-64 (amd64)                       | The PostGIS image is published for amd64 only.                     |
| Memory   | 2 GB, plus 2 GB of swap                      | Container limits add up to about 1.7 GB (table below).             |
| Disk     | 40 GB SSD                                    | Databases (well under 1 GB for the pilot), 11 backup copies, logs. |
| System   | Ubuntu 24.04 LTS (or Debian 12), public IPv4 | Docker Engine with the Compose plugin.                             |

| Container | Memory limit | Notes                                            |
| --------- | ------------ | ------------------------------------------------ |
| `db`      | 512 MiB      | PostgreSQL 16 + PostGIS 3.5.                     |
| `traccar` | 512 MiB      | JVM heap up to 320 MiB (`TRACCAR_JAVA_OPTS`).    |
| `api`     | 384 MiB      | Node.js 22; password hashing uses up to 256 MiB. |
| `caddy`   | 128 MiB      |                                                  |
| `backup`  | 128 MiB      | Idle except a few seconds a day.                 |

**DNS**: create an `A` record for the domain (for example `rutalimpia.example.pe`) with the VPS
address (and an `AAAA` record if it has IPv6). Caddy requests the certificate on its first start,
so the record must resolve before step 4.

**Firewall**: allow inbound `22/tcp` (SSH), `80/tcp` and `443/tcp`+`443/udp` (web),
`5023/tcp` (GT06 trackers) and `5055/tcp` (OsmAnd: simulator and phone apps). Docker publishes
these ports itself and bypasses `ufw`; ports that are not published (PostgreSQL, the API, Traccar's
web UI on 8082) are never reachable from outside. `5055` accepts positions from anyone who knows a
device identifier: once the GT06 tracker works and the simulator is no longer needed, remove the
`5055` line from the compose file and run `up -d` again.

## 2. Prepare the server

```bash
# As root: Docker Engine and the Compose plugin (https://docs.docker.com/engine/install/ubuntu/)
apt-get update && apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos '' deploy && usermod -aG docker deploy
# Swap, so a memory peak slows the server down instead of killing a container
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Put the repository on the server as the `deploy` user, at a release commit: `git clone` from
wherever the municipality hosts it, or copy an archive made with `git archive`. The examples run
from the repository root.

## 3. Secrets

Create `/etc/ruta-limpia/ruta-limpia.env` and `/etc/ruta-limpia/caddy.env` as described in
[`configuration.md`](configuration.md). Generate the VAPID keys once (the command needs the env
files to exist, not the VAPID lines yet):

```bash
C="docker compose -f infra/prod/docker-compose.prod.yml"
$C build
$C run --rm --no-deps api node dist/alerts/infrastructure/vapid-keys-cli.js mailto:soporte@municipalidad.example
```

Paste the three printed lines into `ruta-limpia.env`.

## 4. First start

```bash
C="docker compose -f infra/prod/docker-compose.prod.yml"
$C up -d db                                                       # wait until healthy: $C ps
$C run --rm api node dist/shared/infrastructure/db/cli.js migrate  # create the schema
$C run --rm api node dist/shared/infrastructure/db/cli.js seed     # RI-01, P01–P15, UNIDAD-A
$C up -d                                                          # everything else
$C ps                                                             # every service "healthy"
```

`seed` gives the truck UNIDAD-A the tracker identifier `SEED_VEHICLE_UNIQUE_ID` (set it to the
tracker's IMEI first). It is idempotent. The backup job takes its first backup right away.

## 5. Traccar

Traccar's web UI is not published. Reach it through an SSH tunnel to its fixed address on the
`edge` network, from your own computer:

```bash
ssh -N -L 8082:172.30.57.10:8082 deploy@rutalimpia.example.pe
# then open http://localhost:8082
```

1. **Register the first account right away**: Traccar makes the first registered user its
   administrator. Use a long random password and store it with the other credentials.
2. In **Settings → Server**, untick **Registration**, so nobody else can create accounts.
3. In **Devices**, add the truck: name `Unidad A`, identifier = the tracker's IMEI (the same value as
   `SEED_VEHICLE_UNIQUE_ID`). Traccar refuses positions from unknown devices.
4. Configure the tracker (by SMS or its app, see its manual): server = the domain or the VPS
   address, port `5023` (GT06), the data SIM's APN, a report interval of 15–30 s.

The simulator can do steps 1 and 3 through the same tunnel, from a computer with the repository:
`TRACCAR_URL=http://localhost:8082 TRACCAR_ADMIN_EMAIL=… TRACCAR_ADMIN_PASSWORD=… pnpm
sim:bootstrap` ([`docs/simulator.md`](../simulator.md)).

## 6. First panel administrator

```bash
$C run --rm api node dist/auth/infrastructure/user-cli.js \
  --username ana.torres --role admin --display-name "Ana Torres"
```

It asks for the password twice without echo (at least 12 characters). Administrators then create
every other account in the panel (**Usuarios**).

## 7. Verify

- [ ] `curl -fsS https://<domain>/health` answers `{"status":"ok",…}`.
- [ ] `https://<domain>/` shows the citizen page; `https://<domain>/panel` the sign-in page.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://<domain>/ingest/traccar/positions` is `404`.
- [ ] Sign-in works for the administrator.
- [ ] With the tracker on (or `pnpm sim:drive` with `OSMAND_URL=http://<domain>:5055`), **En vivo**
      shows the truck within 30 s.
- [ ] Real Web Push on a phone: [`push-check.md`](push-check.md).
- [ ] `ls /var/backups/ruta-limpia/daily` lists today's two dumps.

## Upgrades

Upgrade outside the collection schedule: while the API is stopped, Traccar keeps each position and
retries the forward (10 times with a growing delay, then it gives up on that position), so a stop
of a few minutes loses nothing, a long one can.

```bash
C="docker compose -f infra/prod/docker-compose.prod.yml"
git fetch && git checkout <release>                       # the new code
$C exec backup sh /opt/backup/backup.sh                   # 1. backup first
RUTA_LIMPIA_VERSION=<release> $C build                    # 2. build while the old version serves
$C stop api                                               # 3. stop the old API
RUTA_LIMPIA_VERSION=<release> $C run --rm api \
  node dist/shared/infrastructure/db/cli.js migrate       # 4. migrate with the new image
RUTA_LIMPIA_VERSION=<release> $C up -d                    # 5. start the new version
```

Then repeat the checks of step 7. **Rolling back**: migrations cannot be undone from the command
line; restore the backup of step 1 ([`backup-restore.md`](backup-restore.md#restore-in-place))
and start the previous image tag.

### Why migrations are a separate step

`MIGRATE_ON_START` is `false` in production. Two migrations require the old API to be stopped
first, a backup should precede any schema change, and a container that restarts on its own must
never change the schema by surprise. The upgrade above runs them in that order.

### Migration notes

| Migration                           | Old API may keep running? | Notes                                                                                                                                                          |
| ----------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0013-known-networks`               | **No**                    | Renames a `users` column in place: an older API fails every sign-in once it commits.                                                                           |
| `0014-indicator-inputs`             | Yes                       | Additive (two columns with defaults, one table).                                                                                                               |
| `0015-positions-without-traccar-id` | **No**                    | An older API answers `5xx` to some replays. Its `DELETE` and unique index lock `positions` until it commits: forwards wait (retried). Seconds at pilot volume. |

Details for developers: [`apps/api/src/README.md`](../../apps/api/src/README.md) (deploy notes).

## Next step

Daily checks and incidents: [`runbook.md`](runbook.md). Backups: [`backup-restore.md`](backup-restore.md).
