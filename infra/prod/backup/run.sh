#!/bin/sh
# Scheduler of the `backup` service: one backup at start unless both databases already have a dump
# from today, then one every day at BACKUP_TIME (HH:MM, 00:00 to 23:59, default 03:30, in the
# container's TZ; the compose file sets America/Lima as UTC-5, which has no daylight saving time).
set -eu

BACKUP=/opt/backup/backup.sh
BACKUP_TIME="${BACKUP_TIME:-03:30}"
APP_DB="${POSTGRES_DB:-ruta_limpia}"
# A time `date +%H:%M` never prints (such as 24:00) would silently never run: refuse it now.
case "$BACKUP_TIME" in
  [01][0-9]:[0-5][0-9] | 2[0-3]:[0-5][0-9]) ;;
  *) echo "backup: BACKUP_TIME must be HH:MM from 00:00 to 23:59, got '$BACKUP_TIME'" >&2; exit 1 ;;
esac

# True when each database has a dump from today.
dumped_today() {
  for db in "$APP_DB" traccar; do
    ls /backups/daily/"$db-$(date +%Y%m%d)"-*.dump >/dev/null 2>&1 || return 1
  done
}

last=""
if dumped_today; then
  last=$(date +%F)
elif sh "$BACKUP"; then
  last=$(date +%F)
else
  echo "backup: first backup FAILED; next try at $BACKUP_TIME" >&2
fi
echo "backup: daily at $BACKUP_TIME (UTC offset $(date +%z))"

while true; do
  if [ "$(date +%H:%M)" = "$BACKUP_TIME" ] && [ "$last" != "$(date +%F)" ]; then
    # A failed run is logged and tried again the next day; the healthcheck turns unhealthy.
    sh "$BACKUP" || echo "backup: FAILED at $(date)" >&2
    last=$(date +%F)
  fi
  sleep 20
done
