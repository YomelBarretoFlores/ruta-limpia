#!/bin/sh
# Healthcheck of the `backup` service: healthy only while EACH database, the application's and
# Traccar's, has a dump younger than 26 hours. One database whose dumps keep failing turns the
# service unhealthy even when the other one is backed up.
set -eu

for db in "${POSTGRES_DB:-ruta_limpia}" traccar; do
  if ! find /backups/daily -name "$db-*.dump" -mmin -1560 | grep -q .; then
    echo "backup: no dump of $db in the last 26 hours" >&2
    exit 1
  fi
done
