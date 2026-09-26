#!/usr/bin/env bash
# Holt die neueste Version aus GitHub, prüft sie und startet den Dienst neu.
#   sudo bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }

echo "==> Sicherung vor dem Update"
systemctl start honorarnoten-backup.service

echo "==> Neueste Version holen"
git -c safe.directory="$APP_DIR" pull --ff-only

echo "==> Tests"
node --disable-warning=ExperimentalWarning --test tests/*.test.mjs >/dev/null \
  || { echo "Tests fehlgeschlagen – Dienst wird NICHT neu gestartet. Details: npm test" >&2; exit 1; }

chmod -R a+rX "$APP_DIR"
# Service-Dateien aktualisieren (falls geändert)
for datei in honorarnoten.service honorarnoten-backup.service honorarnoten-backup.timer; do
  sed "s|__APP_DIR__|$APP_DIR|g" "deploy/$datei" > "/etc/systemd/system/$datei"
done
systemctl daemon-reload
systemctl restart honorarnoten.service
sleep 1
if systemctl is-active --quiet honorarnoten.service; then
  echo "==> Update fertig, Dienst läuft."
else
  echo "Dienst läuft nicht! journalctl -u honorarnoten -n 50" >&2
  exit 1
fi
