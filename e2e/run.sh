#!/usr/bin/env bash
# End-to-end checks: the app's own data code (supabase-js, offline queue,
# sync) against the real migrations, served by PostgREST the way Supabase
# serves them. Needs psql and a Postgres server; downloads PostgREST once.
# Usage: PGURL=postgres://postgres:postgres@localhost:5432 e2e/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$here/.."
base="${PGURL:-postgres://postgres@localhost:5432}"
db="eq_scoreboard_e2e"
port="${PGRST_PORT:-3456}"
version="v12.2.3"

bin="$(command -v postgrest || true)"
if [ -z "$bin" ]; then
  bin="$root/.cache/postgrest-$version/postgrest"
  if [ ! -x "$bin" ]; then
    mkdir -p "$(dirname "$bin")"
    curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$version/postgrest-$version-linux-static-x64.tar.xz" \
      | tar -xJ -C "$(dirname "$bin")"
  fi
fi

MIGRATE_ONLY=1 TEST_DB="$db" PGURL="$base" "$root/supabase/tests/run.sh" >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$base/$db" -f "$here/roles.sql"

secret="e2e-only-secret-that-is-at-least-32-characters"
host_part="${base#*@}"
PGRST_DB_URI="postgres://authenticator:authenticator@$host_part/$db" \
PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$secret" \
PGRST_SERVER_PORT="$port" \
PGRST_LOG_LEVEL=crit \
  "$bin" >/dev/null &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -sf "http://localhost:$port/" >/dev/null && break
  sleep 0.2
done

E2E_REST_URL="http://localhost:$port" E2E_JWT_SECRET="$secret" E2E_PGURL="$base/$db" \
  npx jest --config "$here/jest.config.js" --runInBand "$@"
