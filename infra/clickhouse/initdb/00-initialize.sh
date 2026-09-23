#!/usr/bin/env bash

# The ClickHouse entrypoint creates CLICKHOUSE_DB before running this script,
# but its SQL-file runner otherwise uses the `default` database. Keep the SQL
# below a subdirectory so it is executed only by this database-aware wrapper.
# A subshell also keeps this safe when the entrypoint sources a non-executable
# bind-mounted script rather than executing it directly.
(
  set -euo pipefail

  init_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  database="${CLICKHOUSE_DB:-columnpilot}"
  password="${CLICKHOUSE_PASSWORD:-}"
  if [[ -n "${CLICKHOUSE_PASSWORD_FILE:-}" ]]; then
    password="$(<"${CLICKHOUSE_PASSWORD_FILE}")"
  fi
  native_port="$(clickhouse extract-from-config \
    --config-file "${CLICKHOUSE_CONFIG:-/etc/clickhouse-server/config.xml}" \
    --key=tcp_port)"

  # The official entrypoint skips initdb scripts for existing data volumes.
  # Do not force reinitialization: seed data must be inserted only once.
  for sql_file in "${init_directory}"/sql/*.sql; do
    printf 'ColumnPilot: initializing %s from %s\n' "$database" "${sql_file##*/}"
    clickhouse-client \
      --host 127.0.0.1 \
      --port "$native_port" \
      --user "${CLICKHOUSE_USER:-default}" \
      --password "$password" \
      --database "$database" \
      --multiquery < "$sql_file"
  done
)
