#!/usr/bin/env bash
# Baut die Fremdbibliotheken als einzelne ES-Module nach public/vendor/
# (kein externes CDN zur Laufzeit – besser für Datenschutz und funktioniert offline).
set -euo pipefail
JSZIP_VERSION=3.10.1
PDFLIB_VERSION=1.17.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "jszip@$JSZIP_VERSION" "pdf-lib@$PDFLIB_VERSION" esbuild
mkdir -p "$ROOT/public/vendor"
echo "import JSZip from 'jszip'; export default JSZip;" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 \
  --legal-comments=eof --outfile="$ROOT/public/vendor/jszip.mjs"
echo "export { PDFDocument, StandardFonts, rgb } from 'pdf-lib';" > pdf-entry.js
npx esbuild pdf-entry.js --bundle --format=esm --minify --platform=browser --target=es2020 \
  --legal-comments=eof --outfile="$ROOT/public/vendor/pdf-lib.mjs"
cat > "$ROOT/public/vendor/VERSIONS.txt" <<TXT
jszip $JSZIP_VERSION (MIT)
pdf-lib $PDFLIB_VERSION (MIT)
Neu erzeugen: bash scripts/vendor.sh
TXT
ls -la "$ROOT/public/vendor"
