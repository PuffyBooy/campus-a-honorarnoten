// Admin → Server: Kommandozentrale. Wie geht es dem Server? Ampel, Auslastung je Stunde, Leistungstest,
// technische Details und Wartungsaktionen. Lädt erst, wenn man den Bereich öffnet.
import { esc, formatZeitpunkt } from '../lib/format.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from '../lib/ui.js';

const STUFE_ZEICHEN = { ok: '✓', warnung: '!', fehler: '✕' };
const STUFE_TEXT = { ok: 'in Ordnung', warnung: 'Warnung', fehler: 'Problem' };
const groesse = (b) => (b == null ? '–' : b < 1048576 ? `${Math.round(b / 1024)} KB`
  : b < 1073741824 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${(b / 1073741824).toFixed(1).replace('.', ',')} GB`);
const zahl = (n) => Number(n ?? 0).toLocaleString('de-AT');
const ms = (n) => (n == null ? '–' : `${zahl(Math.round(n))} ms`);
const stundeText = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}., ${s.slice(11, 13)} Uhr`;

let automatisch = null; // Intervall für „automatisch aktualisieren“

const ampel = (stufe) => `<span class="ampel ampel-${esc(stufe)}" aria-hidden="true">${STUFE_ZEICHEN[stufe] ?? ''}</span>
  <span class="sr-only">${esc(STUFE_TEXT[stufe] ?? stufe)}:</span>`;

/** Säulen je Stunde (eine Reihe, eine Achse), mit Tooltip beim Drüberfahren und Tabelle als Alternative */
function saeulenHtml(stunden, wert, { titel, einheit, format }) {
  const max = Math.max(1, ...stunden.map(wert));
  const b = 720; const h = 140; const unten = 18; const spalte = b / stunden.length;
  const stufe = (v) => (h - unten) * (v / max);
  const saeulen = stunden.map((s, i) => {
    const v = wert(s);
    const hoehe = Math.max(v ? 2 : 0, stufe(v));
    const x = i * spalte + 1;
    return `<g class="saeule" data-tipp="${esc(`${stundeText(s.stunde)}: ${format(v)}`)}">
      <rect class="saeule-treffer" x="${x - 1}" y="0" width="${spalte}" height="${h}" fill="transparent"/>
      ${hoehe ? `<path class="saeule-wert" d="M${x},${h - unten} v${-(hoehe - 4)} q0,-4 4,-4 h${spalte - 10} q4,0 4,4 v${hoehe - 4} z"/>` : ''}
    </g>`;
  }).join('');
  const marken = stunden.map((s, i) => (s.stunde.endsWith('T00') || i === stunden.length - 1
    ? `<text x="${i * spalte + spalte / 2}" y="${h - 4}" text-anchor="middle">${i === stunden.length - 1 ? 'jetzt' : `${s.stunde.slice(8, 10)}.${s.stunde.slice(5, 7)}.`}</text>` : '')).join('');
  return `
    <figure class="diagramm">
      <figcaption><strong>${esc(titel)}</strong> <span class="klein">letzte 48 Stunden · höchster Wert ${esc(format(max))}</span></figcaption>
      <div class="diagramm-flaeche">
        <svg viewBox="0 0 ${b} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(titel)} je Stunde, letzte 48 Stunden">
          <line class="diagramm-achse" x1="0" x2="${b}" y1="${h - unten}" y2="${h - unten}"/>
          <line class="diagramm-raster" x1="0" x2="${b}" y1="${(h - unten) / 2}" y2="${(h - unten) / 2}"/>
          ${saeulen}${marken}
        </svg>
        <div class="diagramm-tipp" hidden></div>
      </div>
      <details class="aufklapp"><summary>Als Tabelle</summary>
        <table class="tabelle kompakt"><thead><tr><th>Stunde</th><th class="rechts">${esc(einheit)}</th></tr></thead>
          <tbody>${stunden.filter((s) => wert(s)).map((s) => `<tr><td>${esc(stundeText(s.stunde))}</td><td class="rechts">${esc(format(wert(s)))}</td></tr>`).join('')
            || '<tr><td colspan="2" class="klein">Noch keine Werte.</td></tr>'}</tbody></table>
      </details>
    </figure>`;
}

function tippBinden(el) {
  el.querySelectorAll('.diagramm-flaeche').forEach((f) => {
    const tipp = f.querySelector('.diagramm-tipp');
    f.addEventListener('pointermove', (ev) => {
      const g = ev.target.closest('[data-tipp]');
      f.querySelectorAll('.saeule.aktiv').forEach((x) => x !== g && x.classList.remove('aktiv'));
      if (!g) { tipp.hidden = true; return; }
      g.classList.add('aktiv');
      tipp.textContent = g.dataset.tipp;
      tipp.hidden = false;
      const r = f.getBoundingClientRect();
      tipp.style.left = `${Math.min(Math.max(ev.clientX - r.left, 70), r.width - 70)}px`;
    });
    f.addEventListener('pointerleave', () => { tipp.hidden = true; f.querySelectorAll('.saeule.aktiv').forEach((x) => x.classList.remove('aktiv')); });
  });
}

const liste = (paare) => `<dl class="angaben kompakt">${paare.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

function testHtml(t) {
  return `
    <table class="tabelle kompakt leistungstest">
      <thead><tr><th>Test</th><th class="rechts">Zeit</th><th>Ergebnis</th></tr></thead>
      <tbody>${t.ergebnisse.map((e) => `<tr><td data-label="Test"><span class="test-name">${ampel(e.stufe)} <strong>${esc(e.titel)}</strong></span></td>
        <td data-label="Zeit" class="rechts mono">${esc(ms(e.ms))}</td><td data-label="Ergebnis" class="klein">${esc(e.text)}</td></tr>`).join('')}</tbody>
    </table>
    <p class="klein">Gemessen ${esc(formatZeitpunkt(t.zeit))} · zusammen ${esc(ms(t.gesamt_ms))}.
      Grün = schnell, gelb = langsam, aber in Ordnung, rot = bitte ansehen.</p>`;
}

export async function render(inhalt, { store, istDemo, neuLaden, istAktuell }) {
  const s = await store.serverStatus();
  if (!istAktuell()) return;
  const a = s.auslastung;
  const probleme = s.pruefungen.filter((p) => p.stufe !== 'ok');
  inhalt.innerHTML = `
    <div class="kopfzeile kommando-kopf">
      <div><h2>Kommandozentrale</h2>
        <p class="klein">Stand ${esc(formatZeitpunkt(s.zeit))}${istDemo ? ' · Demo: Beispielwerte, kein echter Server' : ''}</p></div>
      <div class="aktionen eng">
        <label class="check"><input type="checkbox" id="k-auto" ${automatisch ? 'checked' : ''}> alle 30 s aktualisieren</label>
        <button type="button" class="btn btn-klein" id="k-neu">Aktualisieren</button>
      </div>
    </div>

    <section class="karte">
      <h3>${probleme.length ? `${probleme.length} ${probleme.length === 1 ? 'Punkt braucht' : 'Punkte brauchen'} Aufmerksamkeit` : 'Alles in Ordnung'}</h3>
      <ul class="pruefliste">${[...probleme, ...s.pruefungen.filter((p) => p.stufe === 'ok')].map((p) => `
        <li class="pruef-${esc(p.stufe)}">${ampel(p.stufe)}<span><strong>${esc(p.titel)}</strong><br><span class="klein">${esc(p.text)}</span></span></li>`).join('')}
      </ul>
    </section>

    <section class="kennzahlen" aria-label="Auslastung der letzten 24 Stunden">
      <div class="kennzahl"><span class="kennzahl-titel">Anfragen (24 h)</span><strong>${esc(zahl(a.anfragen_24h))}</strong>
        <span class="klein">${esc(zahl(a.sitzungen))} angemeldete Sitzungen</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Ø Antwortzeit</span><strong>${esc(ms(a.mittel_ms_24h))}</strong>
        <span class="klein">langsamste ${esc(ms(a.max_ms_24h))} · ${esc(zahl(a.langsam_24h))} über 1 s</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Serverfehler (24 h)</span><strong>${esc(zahl(a.fehler_24h))}</strong>
        <span class="klein">${esc(zahl(a.fehler_protokoll_24h))} Fehler, ${esc(zahl(a.warnungen_24h))} Warnungen im Protokoll</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Server-Last</span>
        <strong>${a.last ? esc(a.last.map((x) => x.toFixed(2).replace('.', ',')).join(' · ')) : '–'}</strong>
        <span class="klein">${a.last ? `1, 5 und 15 Minuten${a.kerne ? ` · ${a.kerne} Kerne` : ''}` : 'vom Hoster nicht freigegeben'}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Anmeldungen (24 h)</span><strong>${esc(zahl(a.anmeldungen_24h))}</strong>
        <span class="klein">${esc(zahl(a.gesperrt_24h))} wegen zu vieler Versuche gebremst</span></div>
    </section>

    <section class="karte">
      ${saeulenHtml(a.stunden, (x) => x.anfragen, { titel: 'Anfragen je Stunde', einheit: 'Anfragen', format: (v) => `${zahl(v)} Anfragen` })}
      ${saeulenHtml(a.stunden, (x) => x.mittel_ms, { titel: 'Ø Antwortzeit je Stunde', einheit: 'ms', format: ms })}
    </section>

    <section class="karte">
      <div class="kopfzeile"><h3>Funktionstest</h3>
        <button type="button" class="btn btn-primaer" id="k-funktion">Funktionstest starten</button></div>
      <p class="klein">Spielt den ganzen Ablauf mit drei Testkonten durch: Leistungen speichern (mit Nachweis), einreichen, Rückfrage,
        prüfen, annehmen, bezahlen, Zahlungsavis. Danach wird alles zurückgenommen – es bleibt nichts übrig und keine E-Mail geht hinaus.
        Gut nach jedem Update.</p>
      <div id="k-funktion-ergebnis"></div>
    </section>

    <section class="karte">
      <div class="kopfzeile"><h3>Leistungstest</h3>
        <button type="button" class="btn" id="k-test">Leistungstest starten</button></div>
      <p class="klein">Misst Datenbank, Rechenleistung, Dateien, PDF und ob campus-a-college.at und der Mailserver erreichbar sind.
        Dauert ein paar Sekunden und belastet den Server dabei kurz.</p>
      <div id="k-test-ergebnis"></div>
    </section>

    <section class="karte">
      <h3>Wartung</h3>
      <div class="kommando-aktionen">
        <button type="button" class="btn" data-aktion="mails_senden">Mail-Warteschlange jetzt senden <span class="klein">(${esc(zahl(s.mail.offen))} offen)</span></button>
        <button type="button" class="btn" data-aktion="mails_wiederholen" ${s.mail.fehlgeschlagen ? '' : 'disabled'}>Fehlgeschlagene E-Mails neu versuchen <span class="klein">(${esc(zahl(s.mail.fehlgeschlagen))})</span></button>
        <button type="button" class="btn" data-aktion="artikel_neu">Artikellisten neu holen</button>
        <button type="button" class="btn" data-aktion="aufraeumen">Aufräumen</button>
        <button type="button" class="btn btn-gefahr" data-aktion="sitzungen_beenden">Alle abmelden (außer mich)</button>
      </div>
      <p class="klein">Sicherungen, Export und Wartungsmodus: unter <a href="#/admin/daten">Daten</a> und <a href="#/admin/einstellungen">Einstellungen</a>.</p>
    </section>

    <div class="spalten">
      <section class="karte"><h3>PHP und Webserver</h3>${liste([
        ['PHP', esc(`${s.php.version} (${s.php.sapi}, ${s.php.betriebssystem})`)],
        ['Webserver', esc(s.php.server || '–')],
        ['Speichergrenze', esc(s.php.memory_limit)],
        ['Speicher dieser Anfrage', esc(`${groesse(s.php.speicher_jetzt)} (Spitze ${groesse(s.php.speicher_spitze)})`)],
        ['Max. Laufzeit', esc(s.php.max_execution_time ? `${s.php.max_execution_time} s` : 'unbegrenzt')],
        ['Upload / Anfrage', esc(`${s.php.upload_max_filesize} / ${s.php.post_max_size}`)],
        ['OPcache', esc(s.php.opcache ? `${s.php.opcache.an ? 'an' : 'aus'}${s.php.opcache.an ? `, Trefferquote ${String(s.php.opcache.trefferquote).replace('.', ',')} %` : ''}` : 'nicht verfügbar')],
        ['Zeitzone', esc(s.php.zeitzone)],
        ['Erweiterungen', Object.entries(s.php.erweiterungen).map(([k, v]) => `<span class="badge ${v ? 'badge-bezahlt' : 'badge-abgelehnt'}">${esc(k)}</span>`).join(' ')],
      ])}</section>
      <section class="karte"><h3>Datenbank und Speicher</h3>${liste([
        ['Datenbank', esc(`${s.datenbank.typ} ${s.datenbank.version}`)],
        ['Schema-Version', esc(String(s.datenbank.schema))],
        ['Größe', esc(groesse(s.datenbank.groesse))],
        ['Speicherplatz', esc(s.speicher.frei == null ? 'unbekannt' : `${groesse(s.speicher.frei)} frei${s.speicher.gesamt ? ` von ${groesse(s.speicher.gesamt)}` : ''}`)],
        ['Sicherungen', esc(`${s.speicher.sicherungen} (${groesse(s.speicher.sicherungen_groesse)})`)],
        ['E-Mail', esc(s.mail.aktiv ? s.mail.server : 'aus')],
      ])}
        <details class="aufklapp"><summary>Einträge je Tabelle</summary>
          <table class="tabelle kompakt"><tbody>${Object.entries(s.datenbank.tabellen).map(([t, n]) => `<tr><td class="mono">${esc(t)}</td><td class="rechts">${esc(zahl(n))}</td></tr>`).join('')}</tbody></table>
        </details>
      </section>
    </div>`;

  tippBinden(inhalt);
  inhalt.querySelector('#k-neu').addEventListener('click', neuLaden);
  inhalt.querySelector('#k-auto').addEventListener('change', (ev) => {
    clearInterval(automatisch);
    automatisch = ev.target.checked ? setInterval(() => {
      // nur solange die Kommandozentrale offen ist
      if (!location.hash.startsWith('#/admin/server')) { clearInterval(automatisch); automatisch = null; return; }
      if (!document.hidden && !document.querySelector('dialog[open]')) neuLaden();
    }, 30000) : null;
  });

  const funktion = inhalt.querySelector('#k-funktion-ergebnis');
  inhalt.querySelector('#k-funktion').addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    funktion.innerHTML = '<p class="laden">Test läuft …</p>';
    try {
      const r = await store.funktionstest();
      funktion.innerHTML = `
        ${r.ok === null ? '' : `<p class="${r.ok ? 'erfolgbox' : 'fehlerbox'}"><strong>${r.ok ? `Alles funktioniert${r.schritte.some((x) => x.stufe === 'warnung') ? ' (mit Hinweis)' : ''}.` : 'Ein Schritt ist fehlgeschlagen.'}</strong>
          ${r.ok ? '' : 'Details stehen auch im Protokoll.'}</p>`}
        <ol class="funktion-schritte">${r.schritte.map((x) => `<li>${ampel(x.stufe)}<span><strong>${esc(x.titel)}</strong>
          <span class="klein">${esc(x.text)}${x.ms != null ? ` · ${esc(ms(x.ms))}` : ''}</span></span></li>`).join('')}</ol>`;
    } catch (e) {
      funktion.innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    }
  }));

  const ergebnis = inhalt.querySelector('#k-test-ergebnis');
  inhalt.querySelector('#k-test').addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    ergebnis.innerHTML = '<p class="laden">Test läuft …</p>';
    try {
      ergebnis.innerHTML = testHtml(await store.leistungstest());
    } catch (e) {
      ergebnis.innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    }
  }));

  inhalt.querySelector('.kommando-aktionen').addEventListener('click', async (ev) => {
    const knopf = ev.target.closest('[data-aktion]');
    if (!knopf) return;
    if (knopf.dataset.aktion === 'sitzungen_beenden' && !(await bestaetigen({
      titel: 'Alle abmelden?', html: '<p>Alle Konten außer deinem werden sofort abgemeldet und müssen sich neu anmelden. Nicht gespeicherte Eingaben gehen dabei verloren.</p>',
      ja: 'Alle abmelden', gefahr: true,
    }))) return;
    await mitSperre(knopf, async () => {
      try {
        meldung(await store.serverAktion(knopf.dataset.aktion), 'erfolg');
        neuLaden();
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
}
