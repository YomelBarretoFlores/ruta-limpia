#!/bin/sh
# Scheduler of the `backup` service: one backup at start when there is none from today, then one
# every day at BACKUP_TIME (HH:MM, default 03:30, in the container's TZ; the compose file sets
# America/Lima as UTC-5, which has no daylight saving time).
set -eu

BACKUP=/opt/backup/backup.sh
BACKUP_TIME="${BACKUP_TIME:-03:30}"
case "$BACKUP_TIME" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) echo "backup: BACKUP_TIME must be HH:MM, got '$BACKUP_TIME'" >&2; exit 1 ;;
esac

last=""
if ls /backups/daily/*-"$(date +%Y%m%d)"-*.dump >/dev/null 2>&1; then
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
