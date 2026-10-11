#!/bin/sh
# Starts Traccar with configuration derived from the shared .env file.
#
# Traccar reads a config key from the environment when CONFIG_USE_ENVIRONMENT_VARIABLES=true, using
# the key name upper-cased with dots replaced by underscores (forward.header -> FORWARD_HEADER).
# Java runs with a clean environment (env -i) so unrelated .env variables, such as the API's
# DATABASE_URL, can never be mistaken for Traccar settings.
set -eu

: "${INGEST_TOKEN:?INGEST_TOKEN must be set in .env}"
: "${POSTGRES_USER:?POSTGRES_USER must be set in .env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}"

cd /opt/traccar
exec env -i \
  PATH="$PATH" \
  CONFIG_USE_ENVIRONMENT_VARIABLES=true \
  DATABASE_URL="jdbc:postgresql://db:5432/traccar" \
  DATABASE_USER="$POSTGRES_USER" \
  DATABASE_PASSWORD="$POSTGRES_PASSWORD" \
  FORWARD_URL="${TRACCAR_FORWARD_URL:-http://host.docker.internal:3000/ingest/traccar/positions}" \
  FORWARD_HEADER="X-Ingest-Token: ${INGEST_TOKEN}" \
  JAVA_TOOL_OPTIONS="${TRACCAR_JAVA_OPTS:--Xms64m -Xmx320m}" \
  /opt/traccar/jre/bin/java -XX:+ExitOnOutOfMemoryError -jar tracker-server.jar conf/traccar.xml
