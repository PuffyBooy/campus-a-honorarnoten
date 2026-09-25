#!/usr/bin/env bash
# Baut die Fremdbibliotheken als einzelne ES-Module nach public/vendor/
# (kein externes CDN zur Laufzeit – besser für Datenschutz und CSP).
set -euo pipefail
SUPABASE_VERSION=2.117.2
QRCODE_VERSION=2.0.4
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "@supabase/supabase-js@$SUPABASE_VERSION" "qrcode-generator@$QRCODE_VERSION" esbuild
mkdir -p "$ROOT/public/vendor"
echo "export { createClient } from '@supabase/supabase-js';" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 \
  --legal-comments=eof --outfile="$ROOT/public/vendor/supabase-js.mjs"
cp node_modules/qrcode-generator/dist/qrcode.mjs "$ROOT/public/vendor/qrcode-generator.mjs"
cat > "$ROOT/public/vendor/VERSIONS.txt" <<TXT
@supabase/supabase-js $SUPABASE_VERSION (MIT)
qrcode-generator $QRCODE_VERSION (MIT)
Neu erzeugen: bash scripts/vendor.sh
TXT
ls -la "$ROOT/public/vendor"
