#!/usr/bin/env bash
# Veröffentlicht die App per SSH auf dem Webspace (World4You) – ohne FTP, ohne Hochladen von Hand.
# GitHub Actions ruft das nach jedem Update auf main auf (.github/workflows/pages.yml); es geht auch lokal.
#
# Einstellungen (in GitHub: Settings -> Secrets and variables -> Actions -> Secrets):
#   W4Y_HOST       SSH-Server, z. B. aus dem World4You-Kundenbereich
#   W4Y_BENUTZER   SSH-Benutzer
#   W4Y_SSH_KEY    privater SSH-Schlüssel (Inhalt der Datei) – der öffentliche liegt auf dem Server
#   W4Y_ZIEL       Hauptordner der Domain auf dem Server (im SSH-Terminal mit pwd anzeigen)
#   W4Y_PORT       optional, Standard 22
#   W4Y_ADRESSE    optional, z. B. https://deine-domain.at – danach wird geprüft, ob die Seite antwortet
set -euo pipefail
cd "$(dirname "$0")/.."
: "${W4Y_HOST:?W4Y_HOST fehlt}" "${W4Y_BENUTZER:?W4Y_BENUTZER fehlt}" "${W4Y_ZIEL:?W4Y_ZIEL fehlt}"
port="${W4Y_PORT:-22}"
version="${1:-$(git rev-parse --short=8 HEAD 2>/dev/null || date +%Y%m%d%H%M)}"

scripts/world4you-paket.sh "$version" >/dev/null
tar -czf dist/paket.tar.gz -C dist/world4you .

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [ -n "${W4Y_SSH_KEY:-}" ]; then
  printf '%s\n' "$W4Y_SSH_KEY" > "$tmp/schluessel"
  chmod 600 "$tmp/schluessel"
  schluessel=(-i "$tmp/schluessel")
else
  schluessel=()   # lokal: der eigene Schlüssel aus ~/.ssh
fi
ssh_opt=("${schluessel[@]}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$tmp/known_hosts" -o ConnectTimeout=20)

echo "Lade Version $version auf $W4Y_HOST hoch …"
# direkt über die SSH-Verbindung (braucht kein SFTP/scp auf dem Server)
ssh -p "$port" "${ssh_opt[@]}" "$W4Y_BENUTZER@$W4Y_HOST" 'cat > "$HOME/anerkennungspraemien-update.tar.gz"' < dist/paket.tar.gz

# Auf dem Server: das Update-Skript aus dem NEUEN Paket nehmen (falls sich das Skript selbst geändert hat)
ssh -p "$port" "${ssh_opt[@]}" "$W4Y_BENUTZER@$W4Y_HOST" bash -s -- "$W4Y_ZIEL" <<'AUF_DEM_SERVER'
set -euo pipefail
ziel="$1"
paket="$HOME/anerkennungspraemien-update.tar.gz"
[ -d "$ziel" ] || { echo "Der Hauptordner $ziel existiert nicht (W4Y_ZIEL prüfen)." >&2; exit 1; }
neu="$(mktemp -d)"
trap 'rm -rf "$neu"; rm -f "$paket"' EXIT
tar -xzf "$paket" -C "$neu" ./app/aktualisieren.sh
if [ -d "$ziel/app" ]; then
  bash "$neu/app/aktualisieren.sh" "$paket" "$ziel"
else
  tar -xzf "$paket" -C "$ziel"
  echo "Erstinstallation fertig – jetzt im Browser /einrichten.php öffnen."
fi
AUF_DEM_SERVER

if [ -n "${W4Y_ADRESSE:-}" ]; then
  adresse="${W4Y_ADRESSE%/}"
  if curl -fsS --max-time 20 "$adresse/js/modus.js" | grep -q "'server'"; then
    echo "Online: $adresse antwortet."
  else
    echo "Achtung: $adresse antwortet nicht wie erwartet." >&2
    exit 1
  fi
fi
