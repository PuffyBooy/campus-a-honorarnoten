// Honorarnoten-Generator: Honorarnoten für andere Firmen (externe Auftraggeber).
// Eigene Daten kommen aus dem Profil; der Entwurf bleibt in diesem Browser gespeichert.
import JSZip from '../../vendor/jszip.mjs';
import { esc, formatBetragDokument, formatBetragPlain, formatDatum, heuteIso, parseBetrag } from '../lib/format.js';
import { formatIban, normalizeIban } from '../lib/iban.js';
import { namensteil, initialen } from '../lib/nummer.js';
import { ortAusPlzOrt } from '../lib/honorarnote-docx.js';
import { downloadBlob } from '../lib/csv.js';
import {
  HINWEIS_KLEINUNTERNEHMER, gesamtCent, pruefen, externeHonorarnoteDocx, dateiname,
} from '../lib/externe-honorarnote.js';
import { fehlerText, meldung, mitSperre } from '../lib/ui.js';

// ------------------------------------------------------------------ Entwurf im Browser (pro Person)

const entwurfKey = (uid) => `campus-a-honorare:generator:${uid}`;
const zaehlerKey = (uid, jahr) => `campus-a-honorare:generator-zaehler:${uid}:${jahr}`;

function lesen(key, standard) {
  try {
    const roh = localStorage.getItem(key);
    return roh ? JSON.parse(roh) : standard;
  } catch {
    return standard;
  }
}
function schreiben(key, wert) {
  try {
    if (wert === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(wert));
  } catch { /* Speicher gesperrt – Entwurf geht beim Verlassen verloren */ }
}

/** Vorschlag: eigene Serie für externe Honorarnoten, z. B. MUSTERFRAU-MA-2026-E01 */
function nummerVorschlag(nutzer) {
  const jahr = Number(heuteIso().slice(0, 4));
  const naechste = lesen(zaehlerKey(nutzer.id, jahr), 0) + 1;
  return `${namensteil(nutzer.nachname) || 'NACHNAME'}-${initialen(nutzer.vorname)}-${jahr}-E${String(naechste).padStart(2, '0')}`;
}

function neuerEntwurf(nutzer) {
  const p = nutzer.profil ?? {};
  return {
    absender: {
      name: `${nutzer.vorname} ${nutzer.nachname}`.trim(), strasse: p.strasse ?? '', plz_ort: p.plz_ort ?? '',
      email: nutzer.email ?? '', uid: '', kontoinhaber: p.kontoinhaber ?? '', iban: formatIban(p.iban ?? ''), bic: p.bic ?? '',
    },
    empfaenger: { name: '', zusatz: '', strasse: '', plz_ort: '', uid: '' },
    nummer: nummerVorschlag(nutzer),
    ort: ortAusPlzOrt(p.plz_ort),
    datum: heuteIso(),
    leistungszeitraum: '',
    anmerkung: '',
    positionen: [{ beschreibung: '', datum: heuteIso(), betrag: '' }],
  };
}

// ------------------------------------------------------------------ Formular

function feld(name, label, wert, { pflicht = false, typ = 'text', attrs = '', breit = false } = {}) {
  return `
    <div class="feld${breit ? ' feld-breit' : ''}">
      <label for="g-${name}">${esc(label)}${pflicht ? ' <span class="pflicht" aria-hidden="true">*</span>' : ' <span class="optional">(optional)</span>'}</label>
      <input id="g-${name}" name="${name}" type="${typ}" value="${esc(wert)}" ${attrs}>
      <p class="feldfehler" data-fehler="${name}"></p>
    </div>`;
}

function positionZeile(p, i) {
  return `
    <li class="gen-position" data-index="${i}">
      <span class="gen-nr" aria-hidden="true">${i + 1}.</span>
      <div class="feld gen-beschreibung">
        <label for="g-pos-${i}-b">Leistung</label>
        <input id="g-pos-${i}-b" name="positionen.${i}.beschreibung" value="${esc(p.beschreibung)}" maxlength="300"
               placeholder="z. B. Reportage „Titel“">
        <p class="feldfehler" data-fehler="positionen.${i}.beschreibung"></p>
      </div>
      <div class="feld">
        <label for="g-pos-${i}-d">Datum</label>
        <input id="g-pos-${i}-d" name="positionen.${i}.datum" type="date" value="${esc(p.datum)}">
        <p class="feldfehler" data-fehler="positionen.${i}.datum"></p>
      </div>
      <div class="feld">
        <label for="g-pos-${i}-e">Betrag (EUR)</label>
        <input id="g-pos-${i}-e" name="positionen.${i}.betrag" inputmode="decimal" autocomplete="off" value="${esc(p.betrag)}" placeholder="0,00">
        <p class="feldfehler" data-fehler="positionen.${i}.betrag"></p>
      </div>
      <button type="button" class="btn btn-klein btn-gefahr gen-entfernen" data-entfernen="${i}"
              aria-label="Position ${i + 1} entfernen">✕</button>
    </li>`;
}

/** Formularwerte -> Entwurf (Beträge bleiben Text, damit Eingaben erhalten bleiben) */
function formularLesen(form) {
  const d = { absender: {}, empfaenger: {}, positionen: [] };
  for (const el of form.elements) {
    if (!el.name) continue;
    const teile = el.name.split('.');
    if (teile[0] === 'positionen') {
      const i = Number(teile[1]);
      d.positionen[i] ??= {};
      d.positionen[i][teile[2]] = el.value;
    } else if (teile.length === 2) {
      d[teile[0]][teile[1]] = el.value;
    } else {
      d[el.name] = el.value;
    }
  }
  d.positionen = d.positionen.filter(Boolean);
  return d;
}

/** Entwurf -> Daten für Prüfung und Word (Beträge als Zahl, IBAN normalisiert) */
function fuerDokument(entwurf) {
  return {
    ...entwurf,
    absender: { ...entwurf.absender, iban: normalizeIban(entwurf.absender.iban) },
    positionen: entwurf.positionen.map((p) => ({ ...p, betrag: parseBetrag(p.betrag) ?? 0 })),
  };
}

// ------------------------------------------------------------------ Vorschau (auch zum Drucken / PDF)

function vorschauHtml(d) {
  const a = d.absender;
  const e = d.empfaenger;
  const gesamt = gesamtCent(d.positionen);
  const zeile = (label, links, rechts) => (links || rechts
    ? `<tr><th scope="row">${esc(label)}</th><td>${esc(links)}</td><td>${esc(rechts)}</td></tr>` : '');
  return `
    <article class="hn-dok" aria-label="Vorschau der Honorarnote">
      <h2>Honorarnote</h2>
      <table class="hn-tab">
        <thead><tr><th></th><th>Von</th><th>An</th></tr></thead>
        <tbody>
          ${zeile('Name / Firma', a.name, e.name)}${zeile('z. H.', '', e.zusatz)}
          ${zeile('Straße und Hausnummer', a.strasse, e.strasse)}${zeile('PLZ und Ort', a.plz_ort, e.plz_ort)}
          ${zeile('UID-Nummer', a.uid, e.uid)}${zeile('E-Mail', a.email, '')}
        </tbody>
      </table>
      <table class="hn-tab hn-info">
        <tr><th>Ort und Datum</th><td>${esc(d.ort)}${d.ort ? ', ' : ''}${esc(formatDatum(d.datum))}</td>
            <th>Honorarnote Nr.</th><td>${esc(d.nummer)}</td></tr>
        ${d.leistungszeitraum ? `<tr><th>Leistungszeitraum</th><td colspan="3">${esc(d.leistungszeitraum)}</td></tr>` : ''}
      </table>
      <p>Sehr geehrte Damen und Herren, für folgende Leistungen berechne ich wie vereinbart:</p>
      <table class="hn-tab hn-pos">
        <thead><tr><th>Nr.</th><th>Leistung</th><th>Datum</th><th class="rechts">Betrag in Euro</th></tr></thead>
        <tbody>${d.positionen.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.beschreibung)}</td>
          <td>${esc(formatDatum(p.datum))}</td><td class="rechts">${p.betrag ? esc(formatBetragDokument(p.betrag)) : ''}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr class="hn-summe"><td colspan="3" class="rechts">Gesamtbetrag in Euro</td><td class="rechts">${esc(formatBetragDokument(gesamt / 100))}</td></tr>
        </tfoot>
      </table>
      <p>${esc(HINWEIS_KLEINUNTERNEHMER)}</p>
      <p>Bitte überweisen Sie den Gesamtbetrag auf folgendes Konto:</p>
      <table class="hn-tab hn-bank">
        <tr><th>Kontoinhaber:in</th><td>${esc(a.kontoinhaber)}</td></tr>
        <tr><th>IBAN</th><td>${esc(formatIban(a.iban))}</td></tr>
        ${a.bic ? `<tr><th>BIC</th><td>${esc(a.bic.toUpperCase())}</td></tr>` : ''}
        <tr><th>Verwendungszweck</th><td>Honorarnote ${esc(d.nummer)}</td></tr>
      </table>
      ${d.anmerkung ? `<p class="hn-anmerkung">${esc(d.anmerkung)}</p>` : ''}
      <p class="hn-gruss">Mit freundlichen Grüßen</p>
      <p>${esc(a.name)}</p>
    </article>`;
}

// ------------------------------------------------------------------ Seite

export function render(el, { nutzer }) {
  let entwurf = lesen(entwurfKey(nutzer.id), null) ?? neuerEntwurf(nutzer);

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Externe Honorarnote</h1>
    </div>
    <p class="tipp">Für Honorarnoten an andere Firmen. Der Entwurf bleibt nur in diesem Browser.</p>
    <div class="spalten gen-spalten">
      <form id="gen-form" class="gen-formular" novalidate>
        <section class="karte">
          <h2>An wen?</h2>
          ${feld('empfaenger.name', 'Firma / Name', entwurf.empfaenger.name, { pflicht: true, attrs: 'maxlength="150" autocomplete="organization"' })}
          ${feld('empfaenger.zusatz', 'z. H. (Abteilung oder Person)', entwurf.empfaenger.zusatz, { attrs: 'maxlength="150"' })}
          ${feld('empfaenger.strasse', 'Straße und Hausnummer', entwurf.empfaenger.strasse, { pflicht: true, attrs: 'maxlength="150"' })}
          <div class="zeile">
            ${feld('empfaenger.plz_ort', 'PLZ und Ort', entwurf.empfaenger.plz_ort, { pflicht: true, attrs: 'maxlength="100"' })}
            ${feld('empfaenger.uid', 'UID-Nummer', entwurf.empfaenger.uid, { attrs: 'maxlength="30"' })}
          </div>
        </section>

        <section class="karte">
          <h2>Leistungen</h2>
          <ol class="gen-positionen" id="gen-positionen">${entwurf.positionen.map(positionZeile).join('')}</ol>
          <p class="feldfehler" data-fehler="positionen"></p>
          <button type="button" class="btn" id="gen-plus">+ Weitere Leistung</button>
        </section>

        <section class="karte">
          <h2>Rechnungsdaten</h2>
          <div class="zeile">
            ${feld('nummer', 'Honorarnote Nr.', entwurf.nummer, { pflicht: true, attrs: 'maxlength="60"' })}
            ${feld('datum', 'Datum', entwurf.datum, { pflicht: true, typ: 'date' })}
          </div>
          <div class="zeile">
            ${feld('ort', 'Ort', entwurf.ort, { pflicht: true, attrs: 'maxlength="60"' })}
            ${feld('leistungszeitraum', 'Leistungszeitraum', entwurf.leistungszeitraum, { attrs: 'maxlength="60" placeholder="z. B. September 2026"' })}
          </div>
          <div class="feld">
            <label for="g-anmerkung">Anmerkung <span class="optional">(optional)</span></label>
            <textarea id="g-anmerkung" name="anmerkung" rows="2" maxlength="1000">${esc(entwurf.anmerkung)}</textarea>
          </div>
        </section>

        <details class="karte aufklapp" id="gen-absender" ${Object.keys(pruefen(fuerDokument(entwurf))).some((k) => k.startsWith('absender.')) ? 'open' : ''}>
          <summary>Meine Daten (aus dem Profil)</summary>
          ${feld('absender.name', 'Name', entwurf.absender.name, { pflicht: true, attrs: 'maxlength="100"' })}
          ${feld('absender.strasse', 'Straße und Hausnummer', entwurf.absender.strasse, { pflicht: true, attrs: 'maxlength="150"' })}
          <div class="zeile">
            ${feld('absender.plz_ort', 'PLZ und Ort', entwurf.absender.plz_ort, { pflicht: true, attrs: 'maxlength="100"' })}
            ${feld('absender.uid', 'UID-Nummer', entwurf.absender.uid, { attrs: 'maxlength="30"' })}
          </div>
          ${feld('absender.email', 'E-Mail', entwurf.absender.email, { typ: 'email', attrs: 'maxlength="200"' })}
          ${feld('absender.kontoinhaber', 'Kontoinhaber:in', entwurf.absender.kontoinhaber, { pflicht: true, attrs: 'maxlength="70"' })}
          <div class="zeile">
            ${feld('absender.iban', 'IBAN', entwurf.absender.iban, { pflicht: true, attrs: 'maxlength="42" spellcheck="false" autocapitalize="characters"' })}
            ${feld('absender.bic', 'BIC', entwurf.absender.bic, { attrs: 'maxlength="11" spellcheck="false" autocapitalize="characters"' })}
          </div>
        </details>

        <section class="karte gen-aktionen">
          <p class="feldfehler" id="gen-fehler" role="alert"></p>
          <div class="aktionen">
            <button type="submit" class="btn btn-primaer">Word-Datei herunterladen</button>
            <button type="button" class="btn" id="gen-drucken">Drucken / als PDF speichern</button>
            <button type="button" class="btn btn-link" id="gen-neu">Neu beginnen</button>
          </div>
        </section>
      </form>

      <section class="gen-vorschau-bereich" aria-label="Vorschau">
        <h2 class="gen-vorschau-titel">Vorschau</h2>
        <div id="gen-vorschau"></div>
      </section>
    </div>`;

  const form = el.querySelector('#gen-form');
  const liste = el.querySelector('#gen-positionen');
  const vorschau = el.querySelector('#gen-vorschau');

  const fehlerSetzen = (fehler) => {
    form.querySelectorAll('[data-fehler]').forEach((p) => { p.textContent = fehler[p.dataset.fehler] ?? ''; });
    for (const eingabe of form.elements) {
      if (eingabe.name) eingabe.setAttribute('aria-invalid', fehler[eingabe.name] ? 'true' : 'false');
    }
  };

  function aktualisieren() {
    entwurf = formularLesen(form);
    schreiben(entwurfKey(nutzer.id), entwurf);
    vorschau.innerHTML = vorschauHtml(fuerDokument(entwurf));
  }

  function positionenNeu() {
    liste.innerHTML = entwurf.positionen.map(positionZeile).join('');
    aktualisieren();
  }

  form.addEventListener('input', (ev) => {
    const p = form.querySelector(`[data-fehler="${CSS.escape(ev.target.name ?? '')}"]`);
    if (p) p.textContent = '';
    if (!form.querySelector('[data-fehler]:not(:empty)')) el.querySelector('#gen-fehler').textContent = '';
    aktualisieren();
  });
  // kein Neuzeichnen bei „change“: die Vorschau ist über „input“ schon aktuell, und ein
  // Neuzeichnen beim Verlassen eines Feldes kann den Klick auf einen Knopf verschlucken

  el.querySelector('#gen-plus').addEventListener('click', () => {
    entwurf = formularLesen(form);
    const letzte = entwurf.positionen[entwurf.positionen.length - 1];
    entwurf.positionen.push({ beschreibung: '', datum: letzte?.datum || heuteIso(), betrag: '' });
    positionenNeu();
    liste.querySelector(`[name="positionen.${entwurf.positionen.length - 1}.beschreibung"]`).focus();
  });

  liste.addEventListener('click', (ev) => {
    const knopf = ev.target.closest('[data-entfernen]');
    if (!knopf) return;
    entwurf = formularLesen(form);
    entwurf.positionen.splice(Number(knopf.dataset.entfernen), 1);
    if (!entwurf.positionen.length) entwurf.positionen.push({ beschreibung: '', datum: heuteIso(), betrag: '' });
    positionenNeu();
  });

  // IBAN und Beträge beim Verlassen schön formatieren (die Vorschau ändert sich dadurch nicht)
  form.addEventListener('focusout', (ev) => {
    const t = ev.target;
    if (t.name === 'absender.iban' && t.value.trim()) t.value = formatIban(t.value);
    if (t.name?.endsWith('.betrag') && parseBetrag(t.value)) t.value = formatBetragPlain(parseBetrag(t.value));
  });

  /** prüft alles; zeigt Fehler an und liefert die Daten oder null */
  function geprueft() {
    entwurf = formularLesen(form);
    const daten = fuerDokument(entwurf);
    const fehler = pruefen(daten);
    fehlerSetzen(fehler);
    const erster = Object.keys(fehler)[0];
    el.querySelector('#gen-fehler').textContent = erster ? 'Bitte die markierten Felder prüfen.' : '';
    if (erster) {
      if (erster.startsWith('absender.')) el.querySelector('#gen-absender').open = true;
      form.elements[erster]?.focus?.();
      return null;
    }
    return daten;
  }

  function nummerVerbrauchen(daten) {
    // wurde der Vorschlag benutzt, zählt die Serie weiter
    if (daten.nummer === nummerVorschlag(nutzer)) {
      const jahr = Number(heuteIso().slice(0, 4));
      schreiben(zaehlerKey(nutzer.id, jahr), lesen(zaehlerKey(nutzer.id, jahr), 0) + 1);
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const daten = geprueft();
    if (!daten) return;
    mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        downloadBlob(dateiname(daten), await externeHonorarnoteDocx(daten, { JSZip }));
        nummerVerbrauchen(daten);
        meldung('Honorarnote erstellt.', 'erfolg');
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });

  el.querySelector('#gen-drucken').addEventListener('click', () => {
    const daten = geprueft();
    if (!daten) return;
    nummerVerbrauchen(daten);
    window.print();
  });

  el.querySelector('#gen-neu').addEventListener('click', () => {
    if (!confirm('Neue Honorarnote beginnen? Eingaben werden gelöscht.')) return;
    schreiben(entwurfKey(nutzer.id), null);
    render(el, { nutzer });
  });

  aktualisieren();
}
