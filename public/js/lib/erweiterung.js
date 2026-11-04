// Chrome-Erweiterung „Redigier-Zähler“: Karte im Profil. Beim Herunterladen wird ein neuer persönlicher Schlüssel
// erstellt und mit der Adresse der App in die Erweiterung geschrieben – nichts muss abgetippt werden.
// Die Dateien der Erweiterung liegen in public/erweiterung/.
import JSZip from '../../vendor/jszip.mjs';
import { esc, formatZeitpunkt } from './format.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from './ui.js';
import { downloadBlob } from './csv.js';

const DATEIEN = ['hintergrund.js', 'popup.html', 'popup.js', 'popup.css'];

/** Manifest (Version 3); Zugriff nur auf die eigene App */
export function erweiterungManifest(app) {
  return {
    manifest_version: 3,
    name: 'Redigier-Zähler – campus a',
    short_name: 'Redigier-Zähler',
    version: '1.0',
    description: 'Zählt redigierte Texte mit einem Klick oder Alt+Umschalt+R und meldet sie an die Anerkennungsprämien-App.',
    permissions: ['activeTab'],
    host_permissions: [`${new URL(app).protocol}//${new URL(app).hostname}/*`], // Muster ohne Port (gilt für jeden Port)
    background: { service_worker: 'hintergrund.js' },
    action: { default_title: 'Redigier-Zähler', default_popup: 'popup.html', default_icon: { 128: 'icon.png' } },
    icons: { 128: 'icon.png' },
    commands: {
      zaehlen: { suggested_key: { default: 'Alt+Shift+R' }, description: 'Offene Seite als redigiert zählen' },
    },
  };
}

async function zipBauen(app, schluessel) {
  const zip = new JSZip();
  const ordner = zip.folder('redigier-zaehler');
  const holen = async (pfad) => {
    const r = await fetch(pfad, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Datei ${pfad} fehlt (${r.status}).`);
    return r;
  };
  await Promise.all(DATEIEN.map(async (d) => ordner.file(d, await (await holen(`erweiterung/${d}`)).text())));
  ordner.file('icon.png', await (await holen('img/icon-192.png')).arrayBuffer());
  ordner.file('manifest.json', JSON.stringify(erweiterungManifest(app), null, 2));
  ordner.file('einstellungen.js', `// Persönlich – nicht weitergeben. Neu herunterladen macht diesen Schlüssel ungültig.\nself.HONORARE = ${
    JSON.stringify({ app, schluessel })};\n`);
  return zip.generateAsync({ type: 'blob' });
}

const ANLEITUNG = `
  <ol class="anleitung">
    <li>ZIP-Datei entpacken (Doppelklick bzw. „Alle extrahieren“).</li>
    <li>In Chrome <code>chrome://extensions</code> öffnen und rechts oben den <strong>Entwicklermodus</strong> einschalten.</li>
    <li><strong>„Entpackte Erweiterung laden“</strong> und den Ordner <code>redigier-zaehler</code> wählen.</li>
    <li>Das Symbol anheften (Puzzle-Teil → Pinnadel). Nach dem Redigieren im CMS: Symbol anklicken oder
      <kbd>Alt</kbd> + <kbd>Umschalt</kbd> + <kbd>R</kbd>. Jeder Artikel zählt pro Monat nur einmal.</li>
  </ol>`;

/** Karte „Chrome-Erweiterung“ im Profil (nur wenn der Redigier-Zähler eingeschaltet ist und man redigieren darf) */
export async function erweiterungKarte(box, { store, istDemo }) {
  let s;
  try {
    s = await store.redigierSchluessel();
  } catch (e) {
    box.innerHTML = `<h2>Chrome-Erweiterung</h2><p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    return;
  }
  box.innerHTML = `
    <h2>Chrome-Erweiterung <span class="badge">Test</span></h2>
    <p>Zählt redigierte Texte direkt im CMS: Artikel offen lassen, auf das Symbol klicken – fertig. Die Redaktion sieht es sofort in „Redigieren live“.</p>
    ${istDemo ? '<p class="hinweisbox">Die Erweiterung braucht die echte App (mit Server) – in der Demo lässt sie sich nicht herunterladen.</p>' : ''}
    ${s.vorhanden ? `<p class="klein">Schlüssel erstellt ${esc(formatZeitpunkt(s.erstellt_am))}${s.zuletzt_am
      ? ` · zuletzt benutzt ${esc(formatZeitpunkt(s.zuletzt_am))}` : ' · noch nicht benutzt'}</p>` : ''}
    <p class="aktionen">
      <button type="button" class="btn btn-primaer" id="ew-laden" ${istDemo ? 'disabled' : ''}>Erweiterung herunterladen</button>
      ${s.vorhanden ? '<button type="button" class="btn btn-gefahr" id="ew-weg">Schlüssel widerrufen</button>' : ''}
    </p>
    <details class="aufklapp"><summary>So wird sie installiert</summary>${ANLEITUNG}</details>`;
  box.querySelector('#ew-laden')?.addEventListener('click', async (ev) => {
    if (s.vorhanden && !await bestaetigen({
      titel: 'Neue Erweiterung herunterladen?',
      html: '<p>Die Erweiterung bekommt einen neuen Schlüssel. Eine früher installierte hört dann auf zu zählen – bitte durch die neue ersetzen.</p>',
      ja: 'Herunterladen',
    })) return;
    await mitSperre(ev.currentTarget, async () => {
      try {
        const { schluessel } = await store.redigierSchluesselErstellen();
        const app = new URL('.', location.href).href;
        downloadBlob('redigier-zaehler.zip', await zipBauen(app, schluessel));
        meldung('Erweiterung heruntergeladen – jetzt entpacken und in Chrome laden.', 'erfolg');
        erweiterungKarte(box, { store, istDemo });
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
  box.querySelector('#ew-weg')?.addEventListener('click', async (ev) => {
    if (!await bestaetigen({ titel: 'Schlüssel widerrufen?', html: '<p>Die installierte Erweiterung kann danach nichts mehr zählen.</p>', ja: 'Widerrufen', gefahr: true })) return;
    await mitSperre(ev.currentTarget, async () => {
      try {
        await store.redigierSchluesselWiderrufen();
        meldung('Schlüssel widerrufen.');
        erweiterungKarte(box, { store, istDemo });
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
}
