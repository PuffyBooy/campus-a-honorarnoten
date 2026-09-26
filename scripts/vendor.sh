#!/usr/bin/env bash
# Baut die Fremdbibliotheken als einzelne ES-Module nach public/vendor/
# (kein externes CDN zur Laufzeit – besser für Datenschutz und funktioniert offline).
set -euo pipefail
JSZIP_VERSION=3.10.1
APPWRITE_VERSION=28.1.0
QRCODE_VERSION=2.0.4
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "jszip@$JSZIP_VERSION" "qrcode-generator@$QRCODE_VERSION" \
  "appwrite@$APPWRITE_VERSION" esbuild
mkdir -p "$ROOT/public/vendor"
echo "import JSZip from 'jszip'; export default JSZip;" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 \
  --legal-comments=eof --outfile="$ROOT/public/vendor/jszip.mjs"
echo "export { Client, Account, Databases, Functions, Teams, ID, Query, Permission, Role, AppwriteException } from 'appwrite';" > appwrite-entry.js
npx esbuild appwrite-entry.js --bundle --format=esm --minify --platform=browser --target=es2020 \
  --legal-comments=eof --outfile="$ROOT/public/vendor/appwrite.mjs"
cp node_modules/qrcode-generator/dist/qrcode.mjs "$ROOT/public/vendor/qrcode-generator.mjs"
cat > "$ROOT/public/vendor/VERSIONS.txt" <<TXT
jszip $JSZIP_VERSION (MIT)
qrcode-generator $QRCODE_VERSION (MIT)
appwrite $APPWRITE_VERSION (BSD-3-Clause)
Neu erzeugen: bash scripts/vendor.sh
TXT
ls -la "$ROOT/public/vendor"
