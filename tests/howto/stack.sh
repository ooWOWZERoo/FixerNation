#!/bin/bash
# Local throwaway test site for recording how-to videos. Nothing here touches production.
#
#   tests/howto/stack.sh up      start MariaDB + a mail catcher, build the schema, seed demo data, start the site
#   tests/howto/stack.sh down    stop everything and delete the throwaway data
#   tests/howto/stack.sh status
#
# Site:  http://localhost:3002      Mail catcher (every email the site sends): http://localhost:8026
# Needs Docker running. Ports used: 3002 (site), 3307 (database), 1026 (SMTP), 8026 (mail web).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DB=fne-howto-db
MAIL=fne-howto-mail
PIDFILE="$HERE/.site.pid"

env_vars() {
  export PORT=3002 SESSION_SECRET=howto-local-only-secret SITE_URL=http://localhost:3002 SERVE_STATIC=true
  export DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=howto DB_NAME=fne_howto
  export SMTP_HOST=127.0.0.1 SMTP_PORT=1026 SMTP_SECURE=false SMTP_USER=howto@example.com SMTP_PASSWORD=howto
  export UPLOADS_DIR="$HERE/.uploads" UPLOADS_URL_PREFIX=/uploads/ NODE_ENV=development
}

up() {
  # The database must use the same clock offset as this Mac: the site compares a login's timestamp with a
  # database timestamp (sessions are revoked when a password is reset), and a mismatch looks like a revoked session.
  docker rm -f "$DB" "$MAIL" >/dev/null 2>&1 || true
  docker run -d --name "$DB" -p 3307:3306 -e MARIADB_ROOT_PASSWORD=howto -e MARIADB_DATABASE=fne_howto mariadb:10.11 --default-time-zone="$(date +%z | sed -E 's/(.{3})(.{2})/\1:\2/')" >/dev/null
  docker run -d --name "$MAIL" -p 1026:1025 -p 8026:8025 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit >/dev/null
  echo -n "Waiting for the database"
  for i in $(seq 1 60); do
    docker exec "$DB" mariadb -uroot -phowto -e 'select 1' fne_howto >/dev/null 2>&1 && break
    echo -n "."; sleep 2
  done
  echo
  env_vars; mkdir -p "$UPLOADS_DIR"
  # schema.sql alone is not a complete schema (classroom tables and others come from the alter-* scripts),
  # so build it the way production got it: apply, run every alter script, repeat until nothing new appears.
  (cd "$ROOT/server" && {
    node scripts/migrate.js >/dev/null 2>&1 || true
    for pass in 1 2 3; do
      for f in scripts/alter-*.js; do node "$f" >/dev/null 2>&1 || true; done
      node scripts/migrate.js >/dev/null 2>&1 || true
    done
    node scripts/migrate.js
    node scripts/seed.js >/dev/null
    for f in seed-license-products seed-email-automations seed-content-safety-default-rules; do node "scripts/$f.js" >/dev/null; done
  })
  (cd "$ROOT/server" && NODE_PATH="$ROOT/server/node_modules" node "$HERE/seed-demo.js")
  stop_site
  # exec makes the background process BE node (so its pid is the one we stop later) and its own
  # stdout/stderr go to the log, so this script's output pipe is not held open.
  (cd "$ROOT/server" && exec node app.js) > "$HERE/.site.log" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  for i in $(seq 1 30); do curl -fs -o /dev/null http://localhost:3002/index.html && break; sleep 1; done
  echo "Site is up: http://localhost:3002   Mail catcher: http://localhost:8026"
}

stop_site() { [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; }
down() { stop_site; docker rm -f "$DB" "$MAIL" >/dev/null 2>&1 || true; rm -rf "$HERE/.uploads"; echo "Stopped and cleaned up."; }
status() { docker ps --filter name=fne-howto --format '{{.Names}} {{.Status}}'; curl -fs -o /dev/null http://localhost:3002/index.html && echo "site: up" || echo "site: down"; }

case "${1:-}" in up) up;; down) down;; status) status;; *) echo "usage: $0 up|down|status"; exit 1;; esac
