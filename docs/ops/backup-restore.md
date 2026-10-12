# Backups and restore

The `backup` service dumps both databases every day and keeps a rotating set of copies on the VPS.
A copy that stays on the same server does not survive the loss of that server, so someone must
also take copies off it. This page shows how backups work, how to check one, and how to restore.

## At a glance

| What       | Detail                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- |
| Databases  | `ruta_limpia` (the application) and `traccar` (Traccar's devices and positions).       |
| Format     | `pg_dump --format=custom` (compressed; restored with `pg_restore`).                    |
| When       | At start when there is no dump from today, then daily at `BACKUP_TIME` (03:30 Lima).   |
| Where      | `/var/backups/ruta-limpia/daily` and `/weekly` on the host (`BACKUP_DIR`), mode `600`. |
| Rotation   | 7 daily and 4 weekly (Sunday) copies per database, about one month of history.         |
| Integrity  | Each dump is read back with `pg_restore --list` before it replaces the partial file.   |
| Monitoring | The service turns `unhealthy` when the newest dump is more than 26 hours old.          |
| Scripts    | `infra/prod/backup/` (`run.sh` scheduler, `backup.sh`, `restore.sh`).                  |

The dumps contain personal data (household codes, subscriptions): treat every copy like the
database itself, and delete copies older than the retention period
([`data-retention.md`](data-retention.md)).

## Take a backup now

Before an upgrade, a purge or any manual change:

```bash
C="docker compose -f infra/prod/docker-compose.prod.yml"
$C exec backup sh /opt/backup/backup.sh
```

## Copy backups off the server

Pull them from a municipal computer (never push credentials to the VPS), for example weekly:

```bash
rsync -a --delete deploy@rutalimpia.example.pe:/var/backups/ruta-limpia/ ./ruta-limpia-backups/
```

The `deploy` user needs read access (`sudo setfacl -R -m u:deploy:rX /var/backups/ruta-limpia`
plus a default ACL), or run `rsync` with `sudo` on the server side. Keep that computer's copy
encrypted.

## Check a backup (restore into a scratch database)

A backup is only proven by restoring it. Once a month, and after any change to the stack:

```bash
C="docker compose -f infra/prod/docker-compose.prod.yml"
$C exec backup ls -1 /backups/daily
$C exec backup sh /opt/backup/restore.sh /backups/daily/ruta_limpia-YYYYMMDD-HHMM.dump ruta_limpia_restore_check
$C exec db sh -c 'psql -U "$POSTGRES_USER" -d ruta_limpia_restore_check -c "SELECT count(*) FROM positions"'
$C exec db sh -c 'dropdb -U "$POSTGRES_USER" ruta_limpia_restore_check'
```

`restore.sh` refuses to touch an existing database unless `--replace` is given.

**Rehearsal result (2026-10-11, local production stack):** a dump of `ruta_limpia` restored into
`ruta_limpia_restore_check` with identical counts (49 positions, 1 trip, 15 passes, 6 alerts,
1 user, 2 audit events, 15 migrations), the same PostGIS version (3.5.2) and the same route length
(1 280 m, a geography computation); `traccar` restored into `traccar_restore_check` with 1 device,
1 user and 50 positions. A rotation run with `BACKUP_KEEP_DAILY=2` kept the two newest dumps.

## Restore in place

Use this after a bad upgrade or data loss. Everything written after the dump is lost.

```bash
C="docker compose -f infra/prod/docker-compose.prod.yml"
$C stop api traccar caddy                 # nothing may write meanwhile
$C exec backup sh /opt/backup/restore.sh /backups/daily/ruta_limpia-YYYYMMDD-HHMM.dump ruta_limpia --replace
$C exec backup sh /opt/backup/restore.sh /backups/daily/traccar-YYYYMMDD-HHMM.dump traccar --replace
$C up -d                                  # with the image that matches the dump's schema
```

Restore both databases from the same run, so Traccar's devices and the application agree.

## Restore on a new server

1. Follow [`deploy.md`](deploy.md) steps 1–3 with the **same** secret files (the same
   `POSTGRES_PASSWORD`, `INGEST_TOKEN` and VAPID keys keep the trackers' setup and the households'
   subscriptions working).
2. `$C up -d db backup`, then copy the dumps into `/var/backups/ruta-limpia/daily/`.
3. Restore both databases with `--replace` as above (the empty databases already exist).
4. `$C up -d`. Do not run `seed` before the restore. Point the DNS record at the new address.

## Checklist

- [ ] `docker compose … ps` shows `backup` healthy.
- [ ] Off-server copy taken this week.
- [ ] A restore into a scratch database checked this month.
