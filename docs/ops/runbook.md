# Operations runbook

What to check every day and what to do when something fails. Commands run on the VPS from the
repository root with `C="docker compose -f infra/prod/docker-compose.prod.yml"`.

## Daily check (2 minutes, before the first collection run)

| Check               | Command or place                       | Expected                        |
| ------------------- | -------------------------------------- | ------------------------------- |
| Services            | `$C ps`                                | Five services, all `healthy`.   |
| API through the web | `curl -fsS https://<domain>/health`    | `{"status":"ok",…}`             |
| Truck signal        | Panel → **En vivo** → Señal GPS        | "En vivo" while the truck runs. |
| Backups             | `ls -l /var/backups/ruta-limpia/daily` | Two dumps from today.           |
| Disk                | `df -h /`                              | Under 80 % used.                |

`/health` says the API process answers; it does not check the database. A database problem shows as
`5xx` answers and errors in the API log.

## Logs

```bash
$C logs --since 1h api            # API (JSON lines; never passwords or tokens)
$C logs --since 1h traccar        # tracker connections, decoded positions, forwarding errors
$C logs --since 1h caddy          # web requests, certificates
$C logs backup                    # backup runs
```

Logs rotate automatically (5 files of 10 MB per service).

## Incidents

### Truck without signal ("Sin señal" / "Sin actualización")

Citizens then see "Sin actualización" and the printed schedule: no stale ETA is ever shown, so the
service degrades safely.

1. Is the truck running its route now? Outside the schedule, no signal is normal.
2. `$C logs --since 30m traccar | grep -i <IMEI>`: no lines means the tracker is not reaching the
   server (power, SIM credit or coverage, wrong server or port). Lines with positions but nothing in
   the panel means the forward fails (next section).
3. On the truck: tracker light and power, data SIM recharge (the budget covers 2 chips × 3 months).
   The tracker stores positions while it has no coverage and sends them later.
4. Register an incident in the panel (**Incidencias**, kind "Falla del GPS") so the
   indicators can explain the gap.

### Traccar down, or positions not reaching the API

1. `$C ps traccar` and `$C logs --since 15m traccar`.
2. Forwarding errors (`401`): `INGEST_TOKEN` differs between Traccar and the API; both read the
   same file, so restart both after an edit: `$C up -d --force-recreate traccar api`.
3. Out of memory (`java.lang.OutOfMemoryError`, then exit): `$C restart traccar`; if it repeats,
   lower `TRACCAR_JAVA_OPTS` or add swap.
4. Traccar keeps undelivered positions and retries them (10 times, growing delay).

### Push notifications not arriving

1. Panel → **En vivo** → "Entregas (recibidos / enviados)" per point: `0 / 0` means no subscribed
   household at that point, or no alert yet; failures show as sent without receipts.
2. `$C logs --since 1h api | grep -i push`: `401`/`403` from the push service means the VAPID
   keys changed or are wrong (households must subscribe again after a key change); `410` means the
   browser dropped the subscription (revoked after `PUSH_MAX_CONSECUTIVE_FAILURES`).
3. The API needs outbound HTTPS (it is on the `edge` network). Check the VPS firewall's egress.
4. Re-run the manual check in [`push-check.md`](push-check.md). iPhones receive push only from the
   app added to the home screen.

### Website down or certificate errors

1. `$C ps caddy` and `$C logs --since 1h caddy | grep -i -E 'error|certificate'`.
2. The DNS record must point at this server, and ports 80 and 443 must be open: Caddy renews
   certificates through them. Rate-limited by Let's Encrypt after many failures: fix the cause,
   then wait (the log says until when).
3. `502` from Caddy means the API is down: `$C ps api`, `$C logs --tail 100 api`, `$C up -d api`.

### Disk full

1. `df -h /` and `docker system df`.
2. Old images after upgrades: `docker image prune` (keeps the images in use).
3. Backups: lower `BACKUP_KEEP_DAILY` only after copying them off the server.
4. PostgreSQL stops writing when the disk is full; after freeing space, `$C restart db api`.

### Data damaged or lost

Restore the last good backup: [`backup-restore.md`](backup-restore.md#restore-in-place). Record
the lost period as an incident.

### Panel access

- A user forgot the password: an administrator resets it in **Usuarios**.
- Sign-in paused after failures: it ends by itself (15 minutes for one network).
- No administrator can sign in: create a new one with the command line
  ([`deploy.md`](deploy.md#6-first-panel-administrator)) and deactivate the lost account.

## Routine tasks

| When                        | Task                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Weekly                      | Copy backups off the server ([backup-restore.md](backup-restore.md#copy-backups-off-the-server)). |
| Monthly                     | Restore check into a scratch database; `apt upgrade` and reboot in a quiet hour.                  |
| On each release             | [Upgrade procedure](deploy.md#upgrades).                                                          |
| End of the retention period | [Personal-data purge](data-retention.md).                                                         |
