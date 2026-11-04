// Admin → Server: Kommandozentrale. Wie geht es dem Server? Ampel, Auslastung je Stunde, Leistungstest,
// technische Details und Wartungsaktionen. Lädt erst, wenn man den Bereich öffnet.
import { esc, formatZeitpunkt } from '../lib/format.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from '../lib/ui.js';
import { letzteWechsel, letzterStart, messungenLeeren, pingSerie } from '../lib/messung.js';
import { tippBinden } from '../lib/diagramm.js';

const STUFE_ZEICHEN = { ok: '✓', warnung: '!', fehler: '✕', info: 'i' };
const STUFE_TEXT = { ok: 'in Ordnung', warnung: 'Warnung', fehler: 'Problem', info: 'Hinweis' };
const groesse = (b) => (b == null ? '–' : b < 1048576 ? `${Math.round(b / 1024)} KB`
  : b < 1073741824 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${(b / 1073741824).toFixed(1).replace('.', ',')} GB`);
const zahl = (n) => Number(n ?? 0).toLocaleString('de-AT');
const ms = (n) => (n == null ? '–' : `${zahl(Math.round(n))} ms`);
const stundeText = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}., ${s.slice(11, 13)} Uhr`;

let automatisch = null; // Intervall für „automatisch aktualisieren“
// Ergebnisse von Funktions- und Leistungstest bleiben beim Aktualisieren der Seite stehen
const ergebnisse = {};

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


const liste = (paare) => `<dl class="angaben kompakt">${paare.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

// ------------------------------------------------------------------ Engpass-Analyse (jede Anfrage am Server)

let analyseStunden = 24;
let pingErgebnis = null;

/** schmaler Balken (SVG, weil Inline-Styles per CSP gesperrt sind) */
const balken = (wert, max) => `<svg class="balken" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
  <rect class="balken-grund" width="100" height="6" rx="3"/><rect class="balken-wert" width="${Math.max(wert ? 2 : 0, Math.min(100, (wert / Math.max(max, 1)) * 100)).toFixed(1)}" height="6" rx="3"/></svg>`;
const zelle = (n, grenze = 1000) => `<td class="rechts mono${n >= grenze ? ' wert-langsam' : n >= grenze / 3 ? ' wert-mittel' : ''}">${esc(ms(n))}</td>`;
const uhrzeit = (iso) => new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function analyseHtml(a) {
  const gesamt = a.phasen.find((p) => p.schluessel === 'ms_gesamt')?.avg || 1;
  const funktionen = a.je_funktion;
  const funktionZeile = (f) => `<tr><td class="mono">${esc(f.funktion)}</td><td class="rechts">${esc(zahl(f.anzahl))}</td>
    ${zelle(f.avg)}${zelle(f.p95)}${zelle(f.max)}<td class="rechts mono">${esc(String(f.sql_anzahl).replace('.', ','))} · ${esc(ms(f.sql_ms))}</td></tr>`;
  return `
    <ul class="pruefliste">${a.befunde.map((b) => `<li class="pruef-${esc(b.stufe)}">${ampel(b.stufe)}<span><strong>${esc(b.titel)}</strong><br>
      <span class="klein">${esc(b.text)}</span></span></li>`).join('')}</ul>
    ${a.anzahl ? `
    <h4>Wohin die Zeit geht – ${esc(zahl(a.anzahl))} Anfragen</h4>
    <div class="tabelle-scroll"><table class="tabelle kompakt engpass">
      <thead><tr><th>Phase</th><th class="rechts">Ø</th><th class="rechts">Median</th><th class="rechts">95 %</th><th class="rechts">Max</th>
        <th>Anteil (Ø)</th><th>Was passiert da?</th></tr></thead>
      <tbody>${a.phasen.map((p) => `<tr${p.schluessel === 'ms_gesamt' ? ' class="summe"' : ''}><td><strong>${esc(p.titel)}</strong></td>
        ${zelle(p.avg, p.schluessel === 'ms_gesamt' || p.schluessel === 'ms_hintergrund' ? 1000 : 300)}${zelle(p.p50, 1000)}${zelle(p.p95, 1000)}${zelle(p.max, 2000)}
        <td>${p.schluessel === 'ms_hintergrund' ? '' : balken(p.avg, gesamt)}</td><td class="klein">${esc(p.text)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="klein">„95 %“: so lange dauern 95 von 100 Anfragen höchstens – zeigt, wie oft es langsam ist. „Max“: die eine langsamste.</p>

    <h4>Je Funktion (die langsamsten zuerst)</h4>
    <div class="tabelle-scroll"><table class="tabelle kompakt">
      <thead><tr><th>Funktion</th><th class="rechts">Anzahl</th><th class="rechts">Ø</th><th class="rechts">95 %</th><th class="rechts">Max</th><th class="rechts">SQL Ø Anzahl · Zeit</th></tr></thead>
      <tbody>${funktionen.slice(0, 12).map(funktionZeile).join('')}</tbody>
    </table></div>
    ${funktionen.length > 12 ? `<details class="aufklapp"><summary>Alle ${funktionen.length} Funktionen</summary>
      <div class="tabelle-scroll"><table class="tabelle kompakt"><tbody>${funktionen.slice(12).map(funktionZeile).join('')}</tbody></table></div></details>` : ''}

    <h4>Nach der Antwort im Hintergrund</h4>
    ${a.hintergrund.length ? `<div class="tabelle-scroll"><table class="tabelle kompakt">
      <thead><tr><th>Aufgabe</th><th class="rechts">Anzahl</th><th class="rechts">Ø</th><th class="rechts">95 %</th><th class="rechts">Max</th></tr></thead>
      <tbody>${a.hintergrund.map((h) => `<tr><td>${esc(h.aufgabe)}</td><td class="rechts">${esc(zahl(h.anzahl))}</td>${zelle(h.avg)}${zelle(h.p95)}${zelle(h.max, 2000)}</tr>`).join('')}</tbody>
    </table></div>` : '<p class="klein">Nichts Nennenswertes (unter 5 ms).</p>'}

    <h4>Die langsamsten Anfragen</h4>
    <div class="tabelle-scroll"><table class="tabelle kompakt">
      <thead><tr><th>Zeit</th><th>Funktion</th><th class="rechts">Gesamt</th><th class="rechts">Start</th><th class="rechts">Datenbank</th>
        <th class="rechts">Anmeldung</th><th class="rechts">Funktion</th><th class="rechts">SQL</th><th>Danach</th></tr></thead>
      <tbody>${a.langsamste.map((z) => `<tr><td class="klein">${esc(uhrzeit(z.zeit))}</td><td class="mono">${esc(z.funktion)}${z.status >= 400 ? ` <span class="klein">(${esc(String(z.status))})</span>` : ''}</td>
        ${zelle(z.ms_gesamt)}${zelle(z.ms_start, 300)}${zelle(z.ms_db, 300)}${zelle(z.ms_sitzung, 300)}${zelle(z.ms_funktion)}
        <td class="rechts mono">${esc(String(z.sql_anzahl))} · ${esc(ms(z.sql_ms))}</td><td class="klein">${esc(z.hintergrund || '–')}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;
}

// ------------------------------------------------------------------ Browser-Messung (dieser Browser, dieses Netz)

const SEITEN = { leistungen: 'Mein Monat', noten: 'Meine Abrechnungen', redaktion: 'Redaktion', zahlung: 'Buchhaltung', admin: 'Admin',
  profil: 'Profil', neu: 'Was ist neu?', start: 'Start' };
const seiteName = (p) => {
  const [a, b] = String(p).split('/');
  return `${SEITEN[a] ?? a}${b ? ` · ${/^[\w-]{20,}$/.test(b) ? 'Abrechnung' : b}` : ''}`;
};

function browserHtml() {
  const st = letzterStart();
  const w = letzteWechsel();
  const p = pingErgebnis;
  const bewertung = !p ? '' : p.warten_median != null && p.warten_median > 150
    ? `<p class="hinweisbox"><strong>Der Browser wartet nach dem Server noch Ø ${esc(ms(p.warten_median))}.</strong>
        Das ist mehr als Netz und Server zusammen erklären – typisch, wenn die Antwort erst nach der Hintergrundarbeit
        (Mails, Sicherung) losgeschickt wird. Bitte die Engpass-Analyse oben und „Antwort vor Hintergrundarbeit“ im Leistungstest ansehen.</p>`
    : p.datei_median > 300
      ? `<p class="hinweisbox"><strong>Das Netz ist langsam:</strong> schon eine kleine Datei braucht Ø ${esc(ms(p.datei_median))}.
          Der Server ist nicht schuld – WLAN, Mobilnetz oder Entfernung zum Rechenzentrum.</p>`
      : p.ausreisser
        ? `<p class="hinweisbox">${esc(String(p.ausreisser))} von ${esc(String(p.anzahl))} Anfragen waren deutlich langsamer als die anderen (Ausreißer).
            Kommt das öfter vor, zeigt die Engpass-Analyse oben bei „Die langsamsten Anfragen“, was da am Server lief.</p>`
        : '<p class="erfolgbox">Netz und Server antworten gleichmäßig schnell.</p>';
  return `
    <div class="spalten">
      <div>
        <h4>Seite laden (letzter Start in diesem Tab)</h4>
        ${st ? liste([
          ['Seite (HTML)', esc(ms(st.html_ms))],
          ['Programmdateien', esc(`${st.dateien} Dateien, ${zahl(st.kb)} KB übertragen${st.aus_cache ? `, ${st.aus_cache} aus dem Cache` : ''}`)],
          ['… alle geladen nach', esc(ms(st.skripte_ms))],
          ['Erste Seite fertig nach', `<strong>${esc(ms(st.bis_fertig_ms))}</strong>`],
        ]) : '<p class="klein">Noch nicht gemessen – einmal die Seite neu laden.</p>'}
      </div>
      <div>
        <h4>Ping-Serie</h4>
        ${p ? liste([
          ['Anfrage an die App', esc(`Ø ${ms(p.median)} (schnellste ${ms(p.min)}, langsamste ${ms(p.max)})`)],
          ['davon am Server', esc(p.server_median == null ? '–' : `${ms(p.server_median)} (Datenbank, Anmeldung)`)],
          ['kleine Datei ohne PHP', esc(`${ms(p.datei_median)} (reines Netz)`)],
          ['Warten darüber hinaus', `<strong>${esc(p.warten_median == null ? '–' : ms(p.warten_median))}</strong>`],
        ]) : '<p class="klein">15 Anfragen nacheinander: zeigt, wie viel das Netz kostet, wie viel der Server und ob der Browser zusätzlich wartet.</p>'}
        ${bewertung}
      </div>
    </div>
    <h4>Deine letzten Seitenwechsel</h4>
    ${w.length ? `<div class="tabelle-scroll"><table class="tabelle kompakt">
      <thead><tr><th>Zeit</th><th>Seite</th><th class="rechts">Dauer</th><th class="rechts">Anfragen</th><th class="rechts">Server</th>
        <th class="rechts">Netz/Warten</th><th>Langsamste Anfrage</th></tr></thead>
      <tbody>${w.map((x) => `<tr><td class="klein">${esc(uhrzeit(x.zeit))}</td>
        <td>${esc(seiteName(x.pfad))}${x.art === 'schnell' ? ' <span class="klein">(schnell)</span>' : ''}</td>${zelle(x.ms)}
        <td class="rechts">${esc(String(x.anfragen))}</td><td class="rechts mono">${esc(ms(x.server_ms))}</td>
        <td class="rechts mono">${esc(ms(Math.max(0, x.ms - x.server_ms)))}</td>
        <td class="klein">${x.langsamste ? `<span class="mono">${esc(x.langsamste.name)}</span> ${esc(ms(x.langsamste.ms))}${x.langsamste.server != null ? ` (Server ${esc(ms(x.langsamste.server))})` : ''}` : '–'}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="klein">„Netz/Warten“ = Dauer minus Server-Zeit: Netz, Zeichnen im Browser und Anfragen, die nacheinander statt gleichzeitig laufen.</p>`
    : '<p class="klein">Noch keine – einfach ein paar Seiten öffnen, dann hier wieder vorbeischauen.</p>'}`;
}

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
      <div class="kopfzeile"><h3>Engpass-Analyse</h3>
        <label class="check">Zeitraum <select id="k-zeitraum">${[[1, 'letzte Stunde'], [24, 'letzte 24 Stunden'], [168, 'letzte 7 Tage']]
          .map(([h, t]) => `<option value="${h}"${h === analyseStunden ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <p class="klein">Jede Anfrage wird am Server in Phasen gemessen: Programmstart, Datenbank, Anmeldung, die eigentliche Funktion
        und was danach im Hintergrund läuft. So sieht man, wo die Zeit hängt.</p>
      <div id="k-analyse"><p class="laden">Wird ausgewertet …</p></div>
    </section>

    <section class="karte">
      <div class="kopfzeile"><h3>Browser-Messung</h3>
        <span class="aktionen eng"><button type="button" class="btn" id="k-ping">Ping-Serie starten</button>
          <button type="button" class="btn btn-klein" id="k-messung-leeren">Liste leeren</button></span></div>
      <p class="klein">Misst in diesem Browser: wie lange das Laden der Seite und jeder Seitenwechsel dauert und wie viel davon
        Netz und wie viel Server ist. Bleibt nur in diesem Tab.</p>
      <div id="k-browser">${browserHtml()}</div>
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

  for (const id of ['k-funktion-ergebnis', 'k-test-ergebnis']) {
    const box = inhalt.querySelector(`#${id}`);
    if (ergebnisse[id]) box.innerHTML = ergebnisse[id];
    // Ergebnis merken (nicht den Zwischenstand „Test läuft …“). Wurde die Seite während des Tests
    // aktualisiert, landet das Ergebnis im alten Feld – dann auch ins aktuelle schreiben
    new MutationObserver(() => {
      if (box.querySelector('.laden')) return;
      ergebnisse[id] = box.innerHTML;
      const jetzt = document.getElementById(id);
      if (!box.isConnected && jetzt && jetzt !== box) jetzt.innerHTML = box.innerHTML;
    }).observe(box, { childList: true, subtree: true });
  }
  tippBinden(inhalt);
  inhalt.querySelector('#k-neu').addEventListener('click', neuLaden);

  // Engpass-Analyse lädt nach (die Seite wartet nicht darauf)
  const analyse = inhalt.querySelector('#k-analyse');
  const analyseLaden = async () => {
    try {
      const a = await store.anfrageAnalyse(analyseStunden);
      analyse.innerHTML = analyseHtml(a); // auch wenn der Reiter noch nicht eingesetzt ist (Admin baut ihn erst losgelöst auf)
    } catch (e) {
      analyse.innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    }
  };
  analyseLaden();
  inhalt.querySelector('#k-zeitraum').addEventListener('change', (ev) => {
    analyseStunden = Number(ev.target.value);
    analyse.innerHTML = '<p class="laden">Wird ausgewertet …</p>';
    analyseLaden();
  });

  const browser = inhalt.querySelector('#k-browser');
  inhalt.querySelector('#k-ping').addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    const knopf = ev.currentTarget;
    try {
      pingErgebnis = await pingSerie(store, 15, (i, n) => { knopf.textContent = `${i} / ${n} …`; });
      browser.innerHTML = browserHtml();
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    } finally {
      knopf.textContent = 'Ping-Serie starten';
    }
  }));
  inhalt.querySelector('#k-messung-leeren').addEventListener('click', () => { messungenLeeren(); browser.innerHTML = browserHtml(); });
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
        await neuLaden();
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });
}
