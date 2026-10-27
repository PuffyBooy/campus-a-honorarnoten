#!/usr/bin/env bash
# Installieren oder aktualisieren per SSH: neues Paket einspielen – vorher wird die Datenbank gesichert,
# der Ordner app/daten (Datenbank und Sicherungen) bleibt unangetastet.
#
#   1. ZIP hochladen, z. B. vom eigenen Rechner:  scp anerkennungspraemien-world4you.zip BENUTZER@SERVER:
#   2. per SSH im Hauptordner der Domain:         bash app/aktualisieren.sh ~/anerkennungspraemien-world4you.zip
#
# Beim allerersten Mal (noch kein app/ da):       unzip -o ~/anerkennungspraemien-world4you.zip -d <Hauptordner>
#
# Das Paket darf eine .zip- oder .tar.gz-Datei sein (GitHub Actions schickt .tar.gz, siehe
# scripts/world4you-deploy.sh). Optional als zweites Argument der Hauptordner (Standard: der Ordner über app/).
set -euo pipefail

zip="${1:?Aufruf: bash app/aktualisieren.sh <Pfad zum Paket> [Hauptordner]}"
ziel="$(cd "${2:-$(dirname "$0")/..}" && pwd)"
[ -f "$zip" ] || { echo "Datei nicht gefunden: $zip" >&2; exit 1; }

# PHP 8.1 oder neuer suchen (auf World4You ist „php“ auf der Kommandozeile oft eine alte Version)
php=""
for p in php85 php84 php83 php82 php81 php; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -r 'exit(version_compare(PHP_VERSION, "8.1.0") < 0 ? 1 : 0);' 2>/dev/null; then
    php="$p"; break
  fi
done
[ -n "$php" ] || { echo "Kein PHP 8.1 oder neuer gefunden." >&2; exit 1; }

alt="$(cat "$ziel/app/version.txt" 2>/dev/null || echo '–')"
if [ -f "$ziel/app/daten/honorarnoten.sqlite" ] || [ -f "$ziel/app/daten/konfig.php" ]; then
  "$php" "$ziel/app/cli.php" backup
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
case "$zip" in
  *.tar.gz|*.tgz) tar -xzf "$zip" -C "$tmp" ;;
  *) unzip -q "$zip" -d "$tmp" ;;
esac
[ -f "$tmp/app/api.php" ] && [ -f "$tmp/index.html" ] || { echo "Das ist kein Paket der Anerkennungsprämien-App." >&2; exit 1; }
# nur Programm und App kopieren – Datenbank und Sicherungen im Ziel bleiben, wie sie sind
find "$tmp/app/daten" -type f ! -name '.htaccess' -delete 2>/dev/null || true
cp -R "$tmp/." "$ziel/"
chmod 755 "$ziel/app/daten" 2>/dev/null || true

echo "Fertig: Version $alt → $(cat "$ziel/app/version.txt") (PHP auf der Kommandozeile: $php)"
echo "Die Datenbank wird beim nächsten Aufruf der Seite automatisch angepasst."
