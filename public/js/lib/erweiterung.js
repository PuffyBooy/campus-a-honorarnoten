// „Automatisch zählen“ (Karte im Profil): redigierte Artikel direkt aus dem CMS zählen –
//   1. Lesezeichen (jeder Browser, auch Safari und iPhone): öffnet ein kleines Fenster der App, ohne Schlüssel
//   2. Chrome-Erweiterung (Dateien in public/erweiterung/): Schlüssel und Adresse sind schon eingetragen
//   3. Claude, Kurzbefehle-App oder eigene Programme: mit dem persönlichen Schlüssel über die Schnittstelle
import JSZip from '../../vendor/jszip.mjs';
import { esc, formatZeitpunkt } from './format.js';
import { bestaetigen, fehlerText, kopierenMitFeedback, meldung, mitSperre } from './ui.js';
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

/** Lesezeichen: Artikel-Nummer wie in der Erweiterung (letzte Zahl der Adresse, sonst Kürzel), Titel ohne „| CMS“ */
export function lesezeichenCode(app) {
  const code = String.raw`(()=>{const u=location;const z=u.pathname.match(/\d{2,}/g)||u.search.match(/\d{2,}/g);let i;if(z){i=z[z.length-1].slice(0,40)}else{let h=2166136261;for(const c of u.host+u.pathname){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}i='u'+(h>>>0).toString(36)}`
    + String.raw`const t=document.title.split(/\s[|–—-]\s/)[0].trim().slice(0,200);`
    + `window.open(${JSON.stringify(`${app}#/melden/`)}+encodeURIComponent(i)+'/'+encodeURIComponent(encodeURIComponent(t)),'redigiert','popup,width=420,height=380')})();`;
  return `javascript:${code}`;
}

const befehl = (app, schluessel, name, args) => `curl -s -X POST '${app}api/${name}' -H 'Content-Type: application/json' -H 'X-Honorare: 1' `
  + `-H 'X-Honorare-Schluessel: ${schluessel}' -d '${JSON.stringify({ args })}'`;

/** Text zum Einfügen bei Claude (oder einem anderen Assistenten, der Befehle ausführen darf) */
export function claudeText(app, schluessel) {
  return `Du hilfst mir, meine redigierten Texte für campus a mitzuzählen. Wenn ich dir sage, dass ich einen Artikel redigiert habe,
meldest du ihn mit diesem Befehl (Artikel-Nummer aus dem CMS – oder ein kurzes Kürzel ohne Leerzeichen –, dazu der Titel).
Jeder Artikel zählt pro Monat nur einmal; "neu": false heißt, er war schon gezählt.

${befehl(app, schluessel, 'redigiertMelden', ['ARTIKEL-NUMMER', 'TITEL'])}

Stand dieses Monats abfragen:

${befehl(app, schluessel, 'redigierStand', [])}

Antworte danach kurz mit der Anzahl dieses Monats (Feld "anzahl"). Der Schlüssel ist persönlich – gib ihn nicht weiter.`;
}

const ANLEITUNG_CHROME = `
  <ol class="anleitung">
    <li>ZIP-Datei entpacken (Doppelklick bzw. „Alle extrahieren“).</li>
    <li>In Chrome (oder Edge) <code>chrome://extensions</code> öffnen und rechts oben den <strong>Entwicklermodus</strong> einschalten.</li>
    <li><strong>„Entpackte Erweiterung laden“</strong> und den Ordner <code>redigier-zaehler</code> wählen.</li>
    <li>Das Symbol anheften (Puzzle-Teil → Pinnadel). Nach dem Redigieren im CMS: Symbol anklicken oder
      <kbd>Alt</kbd> + <kbd>Umschalt</kbd> + <kbd>R</kbd>.</li>
  </ol>`;

let frisch = null; // in dieser Sitzung erstellter Schlüssel (wird nur einmal angezeigt)

/** Karte „Automatisch zählen“ im Profil (nur wenn der Redigier-Zähler eingeschaltet ist und man redigieren darf) */
export async function erweiterungKarte(box, { store, istDemo }) {
  let s;
  try {
    s = await store.redigierSchluessel();
  } catch (e) {
    box.innerHTML = `<h2>Automatisch zählen</h2><p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    return;
  }
  const app = new URL('.', location.href).href;
  // nach dem Neuzeichnen offen lassen, was offen war (beim ersten Mal: das Lesezeichen); ein neuer Schlüssel immer zeigen
  const vorher = box.querySelectorAll('details[data-teil]');
  const offen = new Set(vorher.length ? Array.from(box.querySelectorAll('details[data-teil][open]'), (d) => d.dataset.teil) : ['lesezeichen']);
  if (frisch) offen.add('schluessel');
  const schluessel = frisch ?? 'DEIN-SCHLÜSSEL';
  const keinServer = istDemo ? '<p class="hinweisbox">Braucht die echte App mit Server – in der Demo geht nur das Lesezeichen.</p>' : '';
  box.innerHTML = `
    <h2>Automatisch zählen <span class="badge">Test</span></h2>
    <p>Statt selbst zu tippen: direkt aus dem CMS zählen, während der Artikel offen ist. Jeder Artikel zählt pro Monat nur einmal,
      die Redaktion sieht es sofort in „Redigieren live“.</p>

    <details class="aufklapp" data-teil="lesezeichen" ${offen.has('lesezeichen') ? 'open' : ''}>
      <summary>Lesezeichen – Safari, Chrome, Firefox, iPhone</summary>
      <p>Ohne Schlüssel und ohne Installation. Ein Klick darauf im CMS öffnet ein kleines Fenster der App, das den Artikel zählt
        und sich selbst wieder schließt. (Du musst in diesem Browser in der App angemeldet sein.)</p>
      <p><a class="btn lesezeichen-knopf" href="${esc(lesezeichenCode(app))}" id="ew-lesezeichen" draggable="true">＋1 redigiert</a>
        <span class="klein">← in die Lesezeichenleiste ziehen</span></p>
      <p class="klein"><strong>iPhone / iPad:</strong> irgendeine Seite als Lesezeichen sichern, Lesezeichen bearbeiten und als Adresse
        diesen Code einfügen: <button type="button" class="link-knopf" id="ew-lz-kopieren">Code kopieren</button></p>
    </details>

    <details class="aufklapp" data-teil="chrome" ${offen.has('chrome') ? 'open' : ''}>
      <summary>Chrome-Erweiterung – mit Tastenkürzel</summary>
      ${keinServer}
      <p>Symbol anklicken oder <kbd>Alt</kbd> + <kbd>Umschalt</kbd> + <kbd>R</kbd> – zählt im Hintergrund, ohne Fenster.</p>
      <p><button type="button" class="btn btn-primaer" id="ew-laden" ${istDemo ? 'disabled' : ''}>Erweiterung herunterladen</button></p>
      ${ANLEITUNG_CHROME}
    </details>

    <details class="aufklapp" data-teil="schluessel" ${offen.has('schluessel') ? 'open' : ''}>
      <summary>Claude, Kurzbefehle-App oder eigene Programme – mit Schlüssel</summary>
      ${keinServer}
      <p>Mit deinem persönlichen Schlüssel kann jedes Programm für dich zählen – z. B. Claude („Ich habe Artikel 4311 redigiert“),
        ein iPhone-Kurzbefehl oder ein Skript.</p>
      ${s.vorhanden ? `<p class="klein">Schlüssel erstellt ${esc(formatZeitpunkt(s.erstellt_am))}${s.zuletzt_am
        ? ` · zuletzt benutzt ${esc(formatZeitpunkt(s.zuletzt_am))}` : ' · noch nicht benutzt'}</p>` : ''}
      ${frisch ? `<div class="feld"><label for="ew-schluessel">Dein Schlüssel – nur jetzt sichtbar, gut aufheben</label>
        <div class="kopier-zeile"><input id="ew-schluessel" class="mono" readonly value="${esc(frisch)}">
        <button type="button" class="btn" data-kopieren="schluessel">Kopieren</button></div></div>` : ''}
      <p class="aktionen">
        <button type="button" class="btn${frisch ? '' : ' btn-primaer'}" id="ew-neu" ${istDemo ? 'disabled' : ''}>${s.vorhanden ? 'Neuen Schlüssel erstellen' : 'Schlüssel erstellen'}</button>
        ${s.vorhanden ? '<button type="button" class="btn btn-gefahr" id="ew-weg">Schlüssel widerrufen</button>' : ''}
      </p>
      <h3>Für Claude</h3>
      <p class="klein">Diesen Text in ein Gespräch (oder als Projekt-Anweisung) einfügen. Claude braucht dafür die Erlaubnis, Befehle
        auszuführen – z. B. Claude Code oder Cowork; im normalen Chat geht es nicht.${frisch ? '' : ' Statt DEIN-SCHLÜSSEL deinen Schlüssel einsetzen.'}</p>
      <textarea class="mono befehl-text" rows="7" readonly id="ew-claude">${esc(claudeText(app, schluessel))}</textarea>
      <p><button type="button" class="btn btn-klein" data-kopieren="claude">Text kopieren</button></p>
      <h3>iPhone- oder Mac-Kurzbefehl</h3>
      <ol class="anleitung klein">
        <li>Kurzbefehle-App → neuer Kurzbefehl → Aktion <strong>„Inhalte von URL abrufen“</strong>.</li>
        <li>URL: <code>${esc(app)}api/redigiertMelden</code> · Methode <strong>POST</strong>.</li>
        <li>Header: <code>X-Honorare</code> = <code>1</code> und <code>X-Honorare-Schluessel</code> = dein Schlüssel.</li>
        <li>Anfragetext <strong>JSON</strong>: Feld <code>args</code> als Liste mit Artikel-Nummer und Titel
          (z. B. aus „Nach Eingabe fragen“ oder der geteilten Safari-Seite).</li>
      </ol>
    </details>`;

  box.querySelector('#ew-lesezeichen').addEventListener('click', (ev) => {
    ev.preventDefault();
    meldung('Das Lesezeichen wirkt im CMS: in die Lesezeichenleiste ziehen und dort anklicken, während ein Artikel offen ist.');
  });
  box.querySelector('#ew-lz-kopieren').addEventListener('click', (ev) => kopierenMitFeedback(ev.currentTarget, lesezeichenCode(app)));
  box.onclick = (ev) => { // onclick statt addEventListener: die Karte wird neu gezeichnet, der Rahmen bleibt
    const k = ev.target.closest('[data-kopieren]');
    if (k) kopierenMitFeedback(k, k.dataset.kopieren === 'claude' ? claudeText(app, schluessel) : frisch);
  };
  const neuerSchluessel = async () => {
    const { schluessel: neu } = await store.redigierSchluesselErstellen();
    frisch = neu;
    return neu;
  };
  const ersetzenOk = () => !s.vorhanden || bestaetigen({
    titel: 'Neuen Schlüssel erstellen?',
    html: '<p>Der bisherige Schlüssel hört dann auf zu funktionieren – überall, wo er eingetragen ist (Erweiterung, Claude, Kurzbefehl).</p>',
    ja: 'Neuen Schlüssel erstellen',
  });
  box.querySelector('#ew-neu')?.addEventListener('click', async (ev) => {
    const knopf = ev.currentTarget; // nach dem Warten (Rückfrage) ist ev.currentTarget leer
    if (!await ersetzenOk()) return;
    await mitSperre(knopf, async () => {
      try {
        await neuerSchluessel();
        meldung('Neuer Schlüssel erstellt – jetzt kopieren, er wird nur einmal angezeigt.', 'erfolg');
        erweiterungKarte(box, { store, istDemo });
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
  box.querySelector('#ew-laden')?.addEventListener('click', async (ev) => {
    const knopf = ev.currentTarget; // nach dem Warten (Rückfrage) ist ev.currentTarget leer
    // ein gerade erstellter Schlüssel wird mitgenommen, sonst braucht die Erweiterung einen neuen
    if (!frisch && !await ersetzenOk()) return;
    await mitSperre(knopf, async () => {
      try {
        const k = frisch ?? await neuerSchluessel();
        downloadBlob('redigier-zaehler.zip', await zipBauen(app, k));
        meldung('Erweiterung heruntergeladen – jetzt entpacken und in Chrome laden.', 'erfolg');
        erweiterungKarte(box, { store, istDemo });
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
  box.querySelector('#ew-weg')?.addEventListener('click', async (ev) => {
    const knopf = ev.currentTarget; // nach dem Warten (Rückfrage) ist ev.currentTarget leer
    if (!await bestaetigen({ titel: 'Schlüssel widerrufen?', html: '<p>Erweiterung, Claude und Kurzbefehle können danach nichts mehr zählen. Das Lesezeichen geht weiter.</p>', ja: 'Widerrufen', gefahr: true })) return;
    await mitSperre(knopf, async () => {
      try {
        await store.redigierSchluesselWiderrufen();
        frisch = null;
        meldung('Schlüssel widerrufen.');
        erweiterungKarte(box, { store, istDemo });
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
}
