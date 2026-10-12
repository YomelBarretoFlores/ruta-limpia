# Production configuration

The production stack (`infra/prod/docker-compose.prod.yml`) reads its secrets from two files the
operator creates on the server, outside the repository. Nothing secret is ever committed. This page
lists every variable: what it does, whether it is required, and how to produce its value.

## Quick path

1. Create the directory and the two files, readable by root only:

   ```bash
   sudo install -d -m 700 /etc/ruta-limpia
   sudo install -m 600 /dev/null /etc/ruta-limpia/ruta-limpia.env
   sudo install -m 600 /dev/null /etc/ruta-limpia/caddy.env
   ```

2. Fill them with an editor (`sudo nano /etc/ruta-limpia/ruta-limpia.env`), one `NAME=value` per
   line, using the tables below. Never paste a secret into a shell command or a chat.
3. Check that compose reads them; this prints nothing when everything resolves:

   ```bash
   RUTA_LIMPIA_VERSION=<release> docker compose -f infra/prod/docker-compose.prod.yml config --quiet
   ```

   Without `--quiet` it prints the secrets: never run it where others see the screen or the logs.

## The two files

| File                               | Read by                          | Holds                                      |
| ---------------------------------- | -------------------------------- | ------------------------------------------ |
| `/etc/ruta-limpia/ruta-limpia.env` | `db`, `api`, `traccar`, `backup` | Database, ingest token, VAPID keys, origin |
| `/etc/ruta-limpia/caddy.env`       | `caddy` only                     | Domain and certificate e-mail              |

Caddy is the only service facing the web, so it never receives the database password or the VAPID
private key, and it shares a Docker network (`frontend`) with the API only: it cannot reach the
database or Traccar's admin UI. Different paths can be chosen with `RUTA_LIMPIA_ENV_FILE` and `CADDY_ENV_FILE` (see
[Compose variables](#compose-variables)).

## `ruta-limpia.env`: required

| Variable            | Example / format                                        | How to produce it                                                                     |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `ruta_limpia`                                           | Any name.                                                                             |
| `POSTGRES_PASSWORD` | 48 hex characters                                       | `openssl rand -hex 24`. Hex keeps it safe inside `DATABASE_URL`.                      |
| `POSTGRES_DB`       | `ruta_limpia`                                           | The application database. Traccar's `traccar` database is created next to it.         |
| `DATABASE_URL`      | `postgres://ruta_limpia:<password>@db:5432/ruta_limpia` | The three values above, host `db`.                                                    |
| `INGEST_TOKEN`      | 64 hex characters                                       | `openssl rand -hex 32`. Shared by Traccar (header `X-Ingest-Token`) and the API.      |
| `PUBLIC_ORIGIN`     | `https://rutalimpia.example.pe`                         | `https://` + the domain in `caddy.env`. The panel refuses changes from other origins. |

Set the database values **before the first start**: PostgreSQL creates the user with this password
only when its data volume is empty. Changing `POSTGRES_PASSWORD` later needs an `ALTER ROLE` too.

## `ruta-limpia.env`: Web Push (set all three or none)

| Variable            | Format                          | How to produce it                                                                                                                                                              |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VAPID_PUBLIC_KEY`  | 87 characters                   | `RUTA_LIMPIA_VERSION=<release> docker compose -f infra/prod/docker-compose.prod.yml run --rm --no-deps api node dist/alerts/infrastructure/vapid-keys-cli.js mailto:<contact>` |
| `VAPID_PRIVATE_KEY` | 43 characters                   | Same command (it prints the three lines). Secret.                                                                                                                              |
| `VAPID_SUBJECT`     | `mailto:soporte@municipalidad…` | A real contact the push services can write to.                                                                                                                                 |

Generate them **once** per deployment and keep them with the other credentials: new keys invalidate
every existing browser subscription. Without them, alerts are logged but not sent.

## `ruta-limpia.env`: optional

| Variable                 | Default                | When to set it                                                                |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------- |
| `SEED_VEHICLE_UNIQUE_ID` | `ruta-limpia-unidad-a` | Before `seed`: the truck's tracker identifier in Traccar (usually its IMEI).  |
| `LOG_LEVEL`              | `info`                 | `debug` while investigating an incident.                                      |
| `TRACCAR_JAVA_OPTS`      | `-Xms64m -Xmx320m`     | Traccar's JVM memory; keep the maximum under the container limit (512 MiB).   |
| `BACKUP_TIME`            | `03:30`                | Daily backup time, `HH:MM` (00:00–23:59), Lima time; refused at start if not. |
| `BACKUP_KEEP_DAILY`      | `7`                    | Daily copies kept per database.                                               |
| `BACKUP_KEEP_WEEKLY`     | `4`                    | Weekly (Sunday) copies kept per database.                                     |

The API's tunables (trip start zone, inactivity timeout, ETA refresh, session lifetimes, rate
limits, push concurrency) keep their defaults unless the municipality asks otherwise; the full
list is in the root [`README.md`](../../README.md#configuration).

## `caddy.env`

| Variable             | Example                 | Notes                                                                       |
| -------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `RUTA_LIMPIA_DOMAIN` | `rutalimpia.example.pe` | The DNS name pointing at the VPS. Caddy gets its certificate automatically. |
| `ACME_EMAIL`         | `soporte@example.pe`    | Let's Encrypt writes here about expiring certificates.                      |

## Fixed by the compose file

These are not configurable on purpose; changing them breaks the security model.

| Variable                | Value                                      | Why                                                                                      |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `production`                               |                                                                                          |
| `HOST` / `PORT`         | `0.0.0.0` / `3000`                         | Reached by Caddy and Traccar on the Docker networks only; no published port.             |
| `TRUST_PROXY`           | `true`                                     | Caddy replaces `X-Forwarded-For` with the real client address (rate limits, throttling). |
| `SESSION_COOKIE_SECURE` | `true`                                     | The panel cookie travels over HTTPS only.                                                |
| `MIGRATE_ON_START`      | `false`                                    | Migrations are an explicit upgrade step ([deploy.md](deploy.md#upgrades)).               |
| `TRACCAR_FORWARD_URL`   | `http://api:3000/ingest/traccar/positions` | Ingestion stays on the internal network; Caddy answers `404` for `/ingest/*`.            |
| `TZ` (backup)           | `<-05>5` (UTC−5, Lima)                     | The backup schedule and file names use Lima time.                                        |

## Compose variables

Read from the shell that runs `docker compose`, not from the files above. `RUTA_LIMPIA_VERSION` has
no default on purpose: every compose command refuses to run without it, so no command can fall
back to an older build after a migration. The deployed release is kept in `/etc/ruta-limpia/release`.

| Variable               | Default                            | Purpose                                                           |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `RUTA_LIMPIA_ENV_FILE` | `/etc/ruta-limpia/ruta-limpia.env` | Path of the main file.                                            |
| `CADDY_ENV_FILE`       | `/etc/ruta-limpia/caddy.env`       | Path of Caddy's file.                                             |
| `BACKUP_DIR`           | `/var/backups/ruta-limpia`         | Host directory of the dumps (`daily/`, `weekly/`).                |
| `RUTA_LIMPIA_VERSION`  | none (required)                    | Tag of the built images; read it from `/etc/ruta-limpia/release`. |

## Checklist

- [ ] Both files exist, owned by root, mode `600`, outside the repository.
- [ ] `POSTGRES_PASSWORD` and `INGEST_TOKEN` are long random hex strings, not reused elsewhere.
- [ ] `PUBLIC_ORIGIN` is `https://` + `RUTA_LIMPIA_DOMAIN`.
- [ ] VAPID keys generated once and stored with the other credentials.
- [ ] A copy of both files is kept in the municipality's credential store (see the handover record).
