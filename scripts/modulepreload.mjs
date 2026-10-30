#!/usr/bin/env node
// Schreibt in public/index.html eine <link rel="modulepreload">-Zeile für jede Programmdatei, die beim Start
// geladen wird. Ohne diese Liste lädt der Browser die Module Ebene für Ebene (app.js → views → lib → …),
// jede Ebene kostet eine Runde zum Server; mit der Liste lädt er alle gleichzeitig.
// Aufruf: node scripts/modulepreload.mjs   (ein Test prüft, dass die Liste aktuell ist)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ANFANG = '<!-- modulepreload: automatisch erzeugt (node scripts/modulepreload.mjs) -->';
const ENDE = '<!-- /modulepreload -->';

/** Alle Module, die app.js beim Start statisch lädt (dynamische import() kommen erst bei Bedarf, außer api.js) */
export function startModule(datei = join(WURZEL, 'js/app.js'), gesehen = new Set()) {
  if (gesehen.has(datei)) return gesehen;
  gesehen.add(datei);
  const text = readFileSync(datei, 'utf8');
  for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const ziel = m[1] ?? m[2];
    if (ziel.startsWith('.')) startModule(resolve(dirname(datei), ziel), gesehen);
  }
  return gesehen;
}

export function preloadZeilen() {
  const app = join(WURZEL, 'js/app.js');
  // dazu api.js: app.js lädt es im Server-Modus per import() – sonst wäre das eine Runde mehr (in der Demo ungenutzt, 7 KB)
  const module = startModule(join(WURZEL, 'js/api.js'), startModule());
  return [...module].filter((d) => d !== app).map((d) => relative(WURZEL, d).split('\\').join('/')).sort()
    .map((pfad) => `  <link rel="modulepreload" href="${pfad}">`);
}

export function preloadBlock() {
  return [`  ${ANFANG}`, ...preloadZeilen(), `  ${ENDE}`].join('\n');
}

/** index.html mit aktueller Liste (vor <script type="module" src="js/app.js">) */
export function indexMitPreload(html) {
  const ohne = html.replace(new RegExp(`\\n?[ \\t]*${ANFANG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${ENDE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), '');
  return ohne.replace(/(\n[ \t]*<script type="module" src="js\/app\.js)/, `\n${preloadBlock()}$1`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const datei = join(WURZEL, 'index.html');
  const neu = indexMitPreload(readFileSync(datei, 'utf8'));
  writeFileSync(datei, neu);
  console.log(`${preloadZeilen().length} Module in public/index.html eingetragen.`);
}
