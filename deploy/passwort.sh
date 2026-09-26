#!/usr/bin/env bash
# Setzt für ein Konto ein neues Startpasswort (z. B. wenn der einzige Admin sein Passwort vergessen hat).
#   sudo bash deploy/passwort.sh email@beispiel.at
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }
[ -n "${1:-}" ] || { echo "Aufruf: sudo bash deploy/passwort.sh email@beispiel.at" >&2; exit 1; }
mapfile -t einstellungen < <(grep -E '^[A-Z_]+=' /etc/honorarnoten.env)
runuser -u honorarnoten -- env "${einstellungen[@]}" \
  node --disable-warning=ExperimentalWarning "$APP_DIR/server/cli.js" passwort "$1"
