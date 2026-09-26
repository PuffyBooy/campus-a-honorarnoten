#!/usr/bin/env bash
# Installiert die Honorarnoten-App auf einem Debian- oder Ubuntu-Server (VPS).
#
#   sudo bash deploy/install.sh honorare.deine-domain.at admin@deine-domain.at
#
# Voraussetzungen: frischer Server mit Debian 12 / Ubuntu 22.04 oder neuer,
# ein DNS-Eintrag (A/AAAA) der Domain zeigt auf diesen Server, Ports 80 und 443 offen.
#
# Das Skript kann gefahrlos mehrfach ausgeführt werden (z. B. nach einem Update).
set -euo pipefail

DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"
PORT="${PORT:-3000}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATEN_DIR=/var/lib/honorarnoten
NUTZER=honorarnoten

schritt() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fehler() { printf '\033[31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fehler "Bitte mit sudo ausführen: sudo bash deploy/install.sh <domain> [admin-email]"
command -v apt-get >/dev/null || fehler "Dieses Skript unterstützt nur Debian/Ubuntu (apt)."
if [ -z "$DOMAIN" ]; then
  read -rp "Domain für die App (z. B. honorare.campus-a-college.at): " DOMAIN
fi
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fehler "Ungültige Domain: $DOMAIN"
case "$APP_DIR" in
  /root/*) fehler "Bitte das Repository nicht unter /root ablegen, sondern z. B. nach /opt/honorarnoten klonen." ;;
esac

schritt "Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg git debian-keyring debian-archive-keyring apt-transport-https

node_ok() {
  command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'
}
if ! node_ok; then
  schritt "Node.js 22 installieren (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node_ok || fehler "Node.js 22.13 oder neuer konnte nicht installiert werden."
echo "Node.js $(node -v)"

if ! command -v caddy >/dev/null; then
  schritt "Caddy installieren (Webserver mit automatischem HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

schritt "Systembenutzer und Datenverzeichnis"
id "$NUTZER" >/dev/null 2>&1 || useradd --system --home-dir "$DATEN_DIR" --shell /usr/sbin/nologin "$NUTZER"
install -d -m 750 -o "$NUTZER" -g "$NUTZER" "$DATEN_DIR" "$DATEN_DIR/backups"
# Programmdateien gehören root, der Dienst darf sie nur lesen
chmod -R a+rX "$APP_DIR"
runuser -u "$NUTZER" -- test -r "$APP_DIR/server/server.js" \
  || fehler "Der Dienst kann $APP_DIR nicht lesen. Bitte das Repository nach /opt/honorarnoten klonen."

schritt "Konfiguration /etc/honorarnoten.env"
if [ ! -f /etc/honorarnoten.env ]; then
  cat > /etc/honorarnoten.env <<EOF
PORT=$PORT
HOST=127.0.0.1
DATENBANK=$DATEN_DIR/honorarnoten.sqlite
TRUST_PROXY=1
COOKIE_SECURE=1
BACKUP_TAGE=30
EOF
  chmod 640 /etc/honorarnoten.env
  chown root:"$NUTZER" /etc/honorarnoten.env
else
  echo "Vorhanden, bleibt unverändert."
  PORT="$(grep -E '^PORT=' /etc/honorarnoten.env | cut -d= -f2 || echo 3000)"
fi

schritt "systemd-Dienste einrichten"
for datei in honorarnoten.service honorarnoten-backup.service honorarnoten-backup.timer; do
  sed "s|__APP_DIR__|$APP_DIR|g" "$APP_DIR/deploy/$datei" > "/etc/systemd/system/$datei"
done
systemctl daemon-reload
systemctl enable --now honorarnoten.service
systemctl restart honorarnoten.service
systemctl enable --now honorarnoten-backup.timer

schritt "Caddy für $DOMAIN einrichten"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q "Honorarnoten" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.vorher-$(date +%Y%m%d%H%M%S)"
fi
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  schritt "Firewall: Ports 80 und 443 freigeben"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

schritt "Warten, bis der Server antwortet"
for _ in $(seq 1 20); do
  curl -fs "http://127.0.0.1:$PORT/" >/dev/null && break
  sleep 0.5
done
curl -fs "http://127.0.0.1:$PORT/" >/dev/null || fehler "Der Server startet nicht. Details: journalctl -u honorarnoten -n 50"

# Verwaltungsbefehl als Dienst-Benutzer mit den Einstellungen aus /etc/honorarnoten.env
als_dienst() {
  local einstellungen
  mapfile -t einstellungen < <(grep -E '^[A-Z_]+=' /etc/honorarnoten.env)
  runuser -u "$NUTZER" -- env "${einstellungen[@]}" \
    node --disable-warning=ExperimentalWarning "$APP_DIR/server/cli.js" "$@"
}

if [ "$(als_dienst anzahl)" = "0" ]; then
  if [ -z "$ADMIN_EMAIL" ]; then
    read -rp "E-Mail-Adresse für das erste Admin-Konto: " ADMIN_EMAIL
  fi
  schritt "Erstes Admin-Konto anlegen"
  als_dienst admin "$ADMIN_EMAIL" Admin
fi

schritt "Fertig!"
cat <<EOF
Die App läuft unter:  https://$DOMAIN
(Das HTTPS-Zertifikat holt Caddy beim ersten Aufruf automatisch – das kann eine Minute dauern.)

Nützliche Befehle:
  Status:            systemctl status honorarnoten
  Protokoll:         journalctl -u honorarnoten -f
  Neu starten:       systemctl restart honorarnoten
  Backup jetzt:      systemctl start honorarnoten-backup
  Backups liegen in: $DATEN_DIR/backups  (30 Tage aufbewahrt)
  Passwort vergessen: sudo bash $APP_DIR/deploy/passwort.sh <email>
  Update:            sudo bash $APP_DIR/deploy/update.sh
EOF
