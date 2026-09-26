#!/usr/bin/env bash
# Startet den Honorarnoten-Server (ohne systemd, z. B. zum Ausprobieren).
# Einstellungen optional in einer Datei .env im selben Ordner, z. B.:
#   PORT=3000
#   HOST=127.0.0.1
#   DATENBANK=/var/lib/honorarnoten/honorarnoten.sqlite
#   COOKIE_SECURE=1      # 0 nur für lokale Tests ohne HTTPS
#   TRUST_PROXY=1        # 1 wenn Caddy/nginx davor läuft
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null; then
  echo "Node.js fehlt. Bitte Node.js 22 (oder neuer) installieren: https://nodejs.org" >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node.js $(node -v) ist zu alt – benötigt wird 22.13 oder neuer." >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec node --disable-warning=ExperimentalWarning server/server.js
