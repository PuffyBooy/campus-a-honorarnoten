#!/usr/bin/env bash
# Baut das Paket zum Hochladen auf World4You (oder jeden anderen Webspace mit Apache und PHP 8.1+):
#   dist/world4you/                 Inhalt für den Hauptordner der Domain
#   dist/honorarnoten-world4you.zip dasselbe als ZIP
# Aufruf: scripts/world4you-paket.sh [version]
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:-$(git rev-parse --short=8 HEAD 2>/dev/null || date +%Y%m%d)}"
ziel=dist/world4you
rm -rf "$ziel" dist/honorarnoten-world4you.zip
mkdir -p "$ziel"

# App (Browser-Teil)
cp -R public/. "$ziel/"
rm -f "$ziel/.nojekyll"
printf "// Betriebsart: Server (Daten auf dem eigenen Webspace)\nexport const MODUS = 'server';\n" > "$ziel/js/modus.js"
scripts/cache-bust.sh "$ziel" "$version"

# Server-Teil (PHP) im geschützten Ordner app/
mkdir -p "$ziel/app/daten"
cp -R server/lib "$ziel/app/lib"
cp server/api.php server/einrichten.php server/cli.php "$ziel/app/"
cp deploy/world4you/htaccess-gesperrt "$ziel/app/.htaccess"
cp deploy/world4you/htaccess-gesperrt "$ziel/app/daten/.htaccess"
cp deploy/world4you/htaccess "$ziel/.htaccess"
cp deploy/world4you/api.php deploy/world4you/einrichten.php deploy/world4you/LIESMICH.txt "$ziel/"
echo "$version" > "$ziel/app/version.txt"

(cd "$ziel" && zip -qr -X ../honorarnoten-world4you.zip .)
echo "Paket gebaut: $ziel (Version $version) und dist/honorarnoten-world4you.zip"
