#!/usr/bin/env bash
# Hängt ?v=<version> an alle lokalen JS-/CSS-Verweise im Ordner public/ an,
# damit Browser nach einem Update sofort die neuen Dateien laden (GitHub Pages
# lässt Dateien sonst bis zu 10 Minuten oder länger im Cache).
# Aufruf: scripts/cache-bust.sh <ordner> <version>
set -euo pipefail
ordner="${1:?Ordner fehlt}"
version="${2:?Version fehlt}"

# JS-Module: from './x.js', import('./x.js'), '../../vendor/x.mjs'
find "$ordner" -type f \( -name '*.js' -o -name '*.mjs' \) -print0 |
  xargs -0 sed -i -E "s#(['\"])(\.{1,2}/[^'\"?]+\.m?js)\1#\1\2?v=${version}\1#g"

# index.html: <script src="js/app.js">, <link href="css/style.css">, <link rel="modulepreload" href="vendor/x.mjs">
# (die vorab geladenen Module brauchen genau dieselbe Adresse wie beim Import, sonst lädt der Browser doppelt)
sed -i -E "s#(src|href)=\"((js|css|vendor)/[^\"?]+\.(js|mjs|css))\"#\1=\"\2?v=${version}\"#g" "$ordner/index.html"
