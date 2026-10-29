// Autor:in „Mein Monat“: Leistungen laufend speichern, am Monatsende als Prämienabrechnung einreichen,
// darunter die eingereichten Abrechnungen, die noch unterwegs sind
import {
  KATEGORIE_LABEL, artText, esc, formatBetragPlain, formatDatum, formatEuro, formatMonat, heuteIso, parseBetrag, summe,
} from '../lib/format.js';
import { formatIban } from '../lib/iban.js';
import {
  MEDIEN, MEDIUM_KEYS, STANDARD_MEDIUM, artikelLink, verbundeneMedien, hatArtikel, mediumBadge, mediumName, mediumOder,
} from '../lib/campus.js';
import { satzFuer } from '../lib/honorarsaetze.js';
import { darfRedigieren } from '../lib/konto.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from '../lib/ui.js';
import { noteKarte, notenAktionen } from './noten.js';
import { nummerAendern } from '../lib/nummer-aendern.js';
import {
  NACHWEISE_PRO_LEISTUNG, NACHWEIS_ACCEPT, NACHWEIS_MAX_MB, nachweisFehler, nachweiseHochladen, nachweiseHtml,
} from '../lib/nachweise.js';

let bearbeiteId = null; // Leistung, die gerade im Formular bearbeitet wird

const euroSumme = (noten) => noten.reduce((s, n) => s + Math.round(n.betrag * 100), 0) / 100;
const anzahlText = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;

/** Tage bis zum Monatsletzten (0 = heute ist der letzte Tag) */
function tageBisMonatsende(iso) {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m, 0)).getUTCDate() - t;
}

function monatsHinweis(heute) {
  const tage = tageBisMonatsende(heute);
  const wann = tage === 0 ? 'Heute ist Monatsende.' : tage <= 3 ? `Noch ${anzahlText(tage, 'Tag', 'Tage')} bis Monatsende.` : '';
  return `<p class="hinweisbox monat-hinweis"><strong>Bitte nur einmal am Monatsende einreichen.</strong>
    Alles hier ist schon sicher am Server gespeichert. Du kannst den ganzen Monat weiter sammeln und ändern. ${esc(wann)}</p>`;
}

const satzText = (satz) => (satz != null ? formatBetragPlain(satz) : '');

function satzHinweis(medium, kategorie, saetze) {
  const satz = satzFuer(saetze, medium, kategorie);
  if (kategorie === 'redigieren') return `Wird berechnet: Anzahl × ${formatEuro(satz ?? 0)} pro Text`;
  if (satz == null) return kategorie === 'ausserordentlich' ? 'Betrag laut Vereinbarung mit der Redaktion.' : '';
  return `Standardsatz ${mediumName(medium)}: ${formatEuro(satz)}`;
}

const artikelVermerk = (url, medium) => `Verknüpft mit ${artikelLink(url, 'dem Artikel', '', medium)} ·
  <button type="button" class="link-knopf" id="l-artikel-loesen">Verknüpfung lösen</button>`;

/**
 * Medien, die man im Formular wählen kann: nur die mit Profil-Link. Eine ältere Leistung behält beim
 * Bearbeiten ihr Medium, auch wenn dafür (nicht mehr) ein Link hinterlegt ist.
 */
function waehlbareMedien(nutzer, p) {
  const m = verbundeneMedien(nutzer.profil);
  if (p && !m.includes(mediumOder(p.medium))) m.push(mediumOder(p.medium));
  return m.length ? m : [STANDARD_MEDIUM];
}

// Filter der Artikelliste (bleiben beim Neuzeichnen erhalten)
const artikelFilter = { medium: '', suche: '', nurOffen: false };

function artikelListeHtml(daten) {
  const q = artikelFilter.suche.trim().toLowerCase();
  const treffer = daten.artikel.map((a, i) => ({ a, i }))
    .filter(({ a }) => !artikelFilter.medium || a.medium === artikelFilter.medium)
    .filter(({ a }) => !artikelFilter.nurOffen || !a.erfasst)
    .filter(({ a }) => !q || [a.titel, a.ressort, a.kategorie].some((x) => String(x ?? '').toLowerCase().includes(q)));
  if (!treffer.length) return '<p class="klein">Keine Artikel gefunden.</p>';
  return `<ul class="artikel-liste">
      ${treffer.map(({ a, i }) => `
        <li class="artikel${a.erfasst ? ' erfasst' : ''}">
          <span>
            <strong>${artikelLink(a.url, a.titel, '', a.medium)}</strong><br>
            <span class="klein">${(daten.medien ?? []).length > 1 ? `${mediumBadge(a.medium)} ` : ''}${[a.datum ? formatDatum(a.datum) : 'Datum unbekannt', a.ressort, a.kategorie].filter(Boolean).map(esc).join(' · ')}</span>
          </span>
          ${a.erfasst ? '<span class="badge badge-bezahlt">erfasst</span>'
            : `<button type="button" class="btn btn-klein" data-uebernehmen="${i}">Übernehmen</button>`}
        </li>`).join('')}
    </ul>`;
}

function artikelKarteHtml(daten) {
  if (!daten) return '<p class="klein" role="status">Artikel werden geladen … Beim ersten Mal kann das bis zu einer Minute dauern.</p>';
  if (daten.fehler) return `<p class="fehlerbox" role="alert">${esc(daten.fehler)}</p><button type="button" class="link-knopf" id="artikel-neu">Erneut versuchen</button>`;
  if (!daten.verknuepft) {
    return '<p class="klein">Trag im <a href="#/profil">Profil</a> den Link zu deiner Profilseite auf campus-a-college.at oder campus-a.at ein, dann erscheinen hier alle deine Artikel.</p>';
  }
  const offen = daten.artikel.filter((a) => !a.erfasst).length;
  const medien = daten.medien ?? [];
  const seiten = medien.map((m) => MEDIEN[m].seite).join(' und ');
  return `
    ${daten.demo ? `<p class="tipp">Demo: Beispielartikel. Im echten Betrieb stehen hier deine Artikel von ${esc(seiten)}.</p>` : ''}
    ${daten.warnung ? `<p class="hinweisbox">${esc(daten.warnung)}</p>` : ''}
    <p class="klein">${daten.artikel.length} Artikel von ${esc(seiten)}, davon ${offen} noch nicht erfasst.</p>
    ${daten.artikel.length ? `<div class="artikel-filter">
      <label class="sr-only" for="artikel-suche">Artikel suchen</label>
      <input id="artikel-suche" type="search" placeholder="Titel suchen …" autocomplete="off" value="${esc(artikelFilter.suche)}">
      ${medien.length > 1 ? `<label class="sr-only" for="artikel-medium">Medium</label>
      <select id="artikel-medium"><option value="">Beide Medien</option>
        ${medien.map((m) => `<option value="${m}" ${artikelFilter.medium === m ? 'selected' : ''}>${esc(MEDIEN[m].name)}</option>`).join('')}</select>` : ''}
      <label class="check"><input type="checkbox" id="artikel-offen" ${artikelFilter.nurOffen ? 'checked' : ''}> nur noch nicht erfasste</label>
    </div>
    <div id="artikel-treffer">${artikelListeHtml(daten)}</div>` : ''}
    <button type="button" class="link-knopf" id="artikel-neu">Liste aktualisieren</button>`;
}

// Titel einer Redigier-Leistung ohne eigene Beschreibung (wird beim Bearbeiten nicht als Beschreibung angezeigt)
const AUTO_REDIGIER_TITEL = /^Redigieren \(\d+ Texte?\)$/;

/** Betrag fürs Redigieren: Anzahl × Satz pro Text */
const redigierBetrag = (anzahl, saetze) => Math.round((Number(anzahl) || 0) * (satzFuer(saetze, 'college', 'redigieren') ?? 0) * 100) / 100;

/**
 * „Wie letzten Monat“: wiederkehrende Leistungen aus den Abrechnungen der letzten drei Monate
 * (je Medium, Kategorie und Art eine, neueste zuerst) – zum schnellen Übernehmen ins Formular.
 */
function wiederkehrende(noten, nutzer) {
  const seit = new Date(Date.now() - 92 * 86400000).toISOString().slice(0, 7);
  const gesehen = new Set();
  const liste = [];
  const sortiert = noten.filter((n) => n.status !== 'abgelehnt' && n.monat >= seit).sort((a, b) => b.eingereicht_am.localeCompare(a.eingereicht_am));
  for (const n of sortiert) {
    for (const p of n.positionen) {
      if (p.kategorie === 'redigieren' && !darfRedigieren(nutzer)) continue;
      const v = { ...p, medium: mediumOder(n.medium) };
      const schluessel = [v.medium, v.kategorie, v.art, v.kolumnenart, v.vereinbart_mit].join('|');
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      liste.push(v);
    }
  }
  return liste.slice(0, 6);
}

const vorlageText = (v) => [KATEGORIE_LABEL[v.kategorie], v.kategorie === 'redigieren' ? `${v.anzahl} Texte` : artText(v) || v.kolumnenart,
  formatEuro(v.betrag_eingereicht ?? v.betrag)].filter(Boolean).join(' · ');

function formularHtml(p, einstellungen, nutzer, vorlagen = []) {
  const saetze = einstellungen.honorarsaetze;
  const kat = p?.kategorie ?? 'kolumne';
  const red = kat === 'redigieren';
  const medien = waehlbareMedien(nutzer, p);
  const medium = p ? mediumOder(p.medium) : medien[0];
  // Redigieren nur mit der Rolle vom Admin (oder beim Bearbeiten einer vorhandenen Redigier-Leistung)
  const redigierenMoeglich = darfRedigieren(nutzer) || red;
  return `
    <form class="karte" id="l-form" novalidate>
      <h2>${p ? 'Leistung bearbeiten' : 'Neue Leistung speichern'}</h2>
      ${!p && vorlagen.length ? `<div class="wiederholen" aria-label="Wie letzten Monat">
        <span class="klein">Wie letzten Monat:</span>
        ${vorlagen.map((v, i) => `<button type="button" class="vorlage" data-wiederholen="${i}" title="Übernehmen – nur noch Titel und Datum eintragen">
          ${new Set(vorlagen.map((x) => x.medium)).size > 1 ? mediumBadge(v.medium) : ''} ${esc(vorlageText(v))}</button>`).join('')}
      </div>` : ''}
      <p class="medium-fest" id="l-redigieren-medium" ${red ? '' : 'hidden'}>Für ${mediumBadge('college')}
        <span class="klein">Redigieren gibt es nur bei campus a college.</span></p>
      <div id="l-medium-bereich" ${red ? 'hidden' : ''}>
      ${medien.length > 1 ? `
      <fieldset class="kategorie medium-wahl">
        <legend>Für</legend>
        ${medien.map((m) => `
        <label class="radio"><input type="radio" name="medium" value="${m}" ${m === medium ? 'checked' : ''}>
          <span><strong>${esc(MEDIEN[m].name)}</strong></span></label>`).join('')}
      </fieldset>` : `
      <input type="hidden" name="medium" value="${esc(medium)}">
      <p class="medium-fest">Für ${mediumBadge(medium)}</p>
      <p class="klein medium-fest-hinweis">Schreibst du auch für ${esc(mediumName(MEDIUM_KEYS.find((m) => m !== medium)))}?
        Dann im <a href="#/profil">Profil</a> den zweiten Profil-Link eintragen.</p>`}
      </div>
      <fieldset class="kategorie">
        <legend class="sr-only">Kategorie</legend>
        <label class="radio"><input type="radio" name="kategorie" value="kolumne" ${kat === 'kolumne' ? 'checked' : ''}>
          <span><strong>Kolumne</strong></span></label>
        <label class="radio"><input type="radio" name="kategorie" value="ausserordentlich" ${kat === 'ausserordentlich' ? 'checked' : ''}>
          <span><strong>Außerordentliche Anerkennungsprämie</strong></span></label>
        ${redigierenMoeglich ? `
        <label class="radio"><input type="radio" name="kategorie" value="redigieren" ${red ? 'checked' : ''}>
          <span><strong>Redigieren</strong><br><span class="klein">campus a college · ${esc(formatEuro(satzFuer(saetze, 'college', 'redigieren')))} pro Text</span></span></label>` : ''}
      </fieldset>
      <div class="feld" id="l-anzahl-feld" ${red ? '' : 'hidden'}>
        <label for="l-anzahl">Anzahl redigierter Texte <span class="pflicht" aria-hidden="true">*</span></label>
        <input id="l-anzahl" name="anzahl" type="number" inputmode="numeric" min="1" max="1000" step="1" value="${red ? esc(p.anzahl) : ''}">
        <p class="feldfehler" data-fehler="anzahl"></p>
      </div>
      <div class="feld" id="l-nachweis-feld" ${red ? '' : 'hidden'}>
        <label for="l-nachweis">Nachweis <span class="optional">(optional)</span></label>
        <div id="l-nachweise">${nachweiseHtml(p, { loeschen: true })}</div>
        <input id="l-nachweis" name="nachweis" type="file" multiple accept="${NACHWEIS_ACCEPT}">
        <p class="hinweis">z. B. ein PDF oder Word-Dokument, in dem steht, was du redigiert hast.
          Bis ${NACHWEIS_MAX_MB} MB je Datei, höchstens ${NACHWEISE_PRO_LEISTUNG} Dateien.</p>
        <p class="feldfehler" data-fehler="nachweis"></p>
      </div>
      <div class="feld">
        <label for="l-titel"><span id="l-titel-label">${red ? 'Beschreibung' : 'Titel des Beitrags'}</span>
          <span class="pflicht" aria-hidden="true" ${red ? 'hidden' : ''}>*</span><span class="optional" ${red ? '' : 'hidden'}>(optional)</span></label>
        <input id="l-titel" name="titel" maxlength="200" value="${esc(red && AUTO_REDIGIER_TITEL.test(p.titel) ? '' : p?.titel)}"
               placeholder="${red ? 'z. B. Redigieren September' : ''}">
        <p class="feldfehler" data-fehler="titel"></p>
        <input type="hidden" name="artikel_url" value="${esc(p?.artikel_url)}">
        <p class="klein" id="l-artikel" ${p?.artikel_url ? '' : 'hidden'}>${p?.artikel_url ? artikelVermerk(p.artikel_url, medium) : ''}</p>
      </div>
      <div class="zeile">
        <div class="feld" id="l-art-feld" ${kat === 'ausserordentlich' ? '' : 'hidden'}>
          <label for="l-art">Art der Anerkennungsprämie <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-art" name="art" maxlength="100" autocomplete="off" placeholder="z. B. Interview, Reportage, Fotostrecke"
                 value="${esc(p ? artText(p) : '')}">
          <p class="feldfehler" data-fehler="art"></p>
        </div>
        <div class="feld" id="l-kolumnenart-feld" ${kat === 'kolumne' ? '' : 'hidden'}>
          <label for="l-kolumnenart">Art der Kolumne <span class="optional">(optional)</span></label>
          <input id="l-kolumnenart" name="kolumnenart" maxlength="100" autocomplete="off" value="${esc(p?.kolumnenart)}">
          <p class="feldfehler" data-fehler="kolumnenart"></p>
        </div>
        <div class="feld">
          <label for="l-datum"><span id="l-datum-label">${red ? 'Datum' : 'Veröffentlichung'}</span> <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-datum" name="veroeffentlichung" type="date" required value="${esc(p?.veroeffentlichung ?? heuteIso())}">
          <p class="feldfehler" data-fehler="veroeffentlichung"></p>
        </div>
      </div>
      <div class="zeile">
        <div class="feld">
          <label for="l-betrag">Betrag in EUR <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-betrag" name="betrag" inputmode="decimal" autocomplete="off" placeholder="15,00" required ${red ? 'readonly' : ''}
                 value="${p ? esc(formatBetragPlain(p.betrag)) : esc(satzText(satzFuer(saetze, medium, kat)))}" aria-describedby="l-satz-hinweis">
          <p class="hinweis" id="l-satz-hinweis">${esc(satzHinweis(red ? 'college' : medium, kat, saetze))}</p>
          <p class="feldfehler" data-fehler="betrag"></p>
        </div>
        <div class="feld" id="l-vereinbart-feld" ${kat === 'ausserordentlich' ? '' : 'hidden'}>
          <label for="l-vereinbart">Vereinbart mit <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-vereinbart" name="vereinbart_mit" maxlength="100" placeholder="Name aus der Redaktion" value="${esc(p?.vereinbart_mit)}">
          <p class="feldfehler" data-fehler="vereinbart_mit"></p>
        </div>
      </div>
      <details class="aufklapp" ${p?.ausgabe || p?.notiz ? 'open' : ''}>
        <summary>Ausgabe und Notiz (optional)</summary>
        <div class="feld">
          <label for="l-ausgabe">Ausgabe</label>
          <input id="l-ausgabe" name="ausgabe" maxlength="100" placeholder="z. B. Ausgabe 3/2026" value="${esc(p?.ausgabe)}">
        </div>
        <div class="feld">
          <label for="l-notiz">Notiz an die Redaktion</label>
          <textarea id="l-notiz" name="notiz" rows="2" maxlength="1000">${esc(p?.notiz)}</textarea>
        </div>
      </details>
      <p class="feldfehler" data-fehler="formular" role="alert"></p>
      <div class="aktionen">
        <button class="btn btn-primaer" type="submit">${p ? 'Änderung speichern' : 'Leistung speichern'}</button>
        ${p ? '<button class="btn" type="button" id="l-abbrechen">Abbrechen</button>' : ''}
      </div>
    </form>`;
}

export async function render(el, { store, nutzer, navigate, setFlash, neuLaden, istAktuell }) {
  const [liste, meineNoten, naechste, einstellungen, zeiten] = await Promise.all([
    store.meineLeistungen(), store.meineNoten(), store.naechsteNummer(), store.einstellungen(),
    Promise.resolve(store.ablaufZeiten()).catch(() => null),
  ]);
  if (!istAktuell()) return;
  const heute = heuteIso();
  const diesenMonat = meineNoten.filter((n) => n.monat === heute.slice(0, 7));
  // noch nicht bezahlt: eingereicht, angenommen oder abgelehnt und noch nicht überarbeitet
  const unterwegs = meineNoten.filter((n) => ['eingereicht', 'angenommen'].includes(n.status) || (n.status === 'abgelehnt' && !n.zurueckgeholt_am));
  const ausgezahlt = meineNoten.filter((n) => n.status === 'bezahlt' && n.monat.startsWith(heute.slice(0, 4)));
  const bearbeite = liste.find((p) => p.id === bearbeiteId) ?? null;
  const vorlagen = wiederkehrende(meineNoten, nutzer);
  if (!bearbeite) bearbeiteId = null;
  // campus a und campus a college werden getrennt abgerechnet: eine Karte pro Medium
  const gruppen = MEDIUM_KEYS.map((m) => ({ medium: m, positionen: liste.filter((p) => mediumOder(p.medium) === m) }))
    .filter((g) => g.positionen.length);

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Mein Monat <span class="h1-zusatz">${esc(formatMonat(heute))}</span></h1>
      <a href="#/noten" class="btn">Meine Abrechnungen</a>
    </div>
    <section class="kennzahlen" aria-label="Überblick">
      <div class="kennzahl kennzahl-marke"><span class="kennzahl-titel">Gespeichert, noch nicht eingereicht</span>
        <strong>${esc(formatEuro(summe(liste)))}</strong>
        <span class="klein">${esc(anzahlText(liste.length, 'Leistung', 'Leistungen'))}${gruppen.length > 1
          ? ` · ${gruppen.map((g) => `${g.positionen.length} ${mediumName(g.medium)}`).map(esc).join(', ')}` : ''}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Eingereicht, noch nicht bezahlt</span>
        <strong>${esc(formatEuro(euroSumme(unterwegs)))}</strong>
        <span class="klein">${esc(anzahlText(unterwegs.length, 'Abrechnung', 'Abrechnungen'))}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">${esc(heute.slice(0, 4))} ausgezahlt</span>
        <strong>${esc(formatEuro(euroSumme(ausgezahlt)))}</strong>
        <a class="klein" href="#/noten">alle Abrechnungen</a></div>
    </section>
    <p class="tipp">Beiträge speichern, sobald sie erschienen sind. Am Monatsende einmal einreichen,
      getrennt für campus a college und campus a.</p>

    <div class="spalten">
      <div>
        ${formularHtml(bearbeite, einstellungen, nutzer, vorlagen)}
        <section class="karte" id="artikel-karte" aria-live="polite">
          <h2>Meine Artikel</h2>
          <div id="artikel-inhalt">${artikelKarteHtml(null)}</div>
        </section>
      </div>
      <div id="abrechnungen">
        ${gruppen.length > 1 ? `<section class="karte beide-einreichen">
          <p><strong>Beide auf einmal einreichen?</strong><br>
            <span class="klein">Es werden zwei getrennte Prämienabrechnungen – eine für ${gruppen.map((g) => esc(mediumName(g.medium))).join(', eine für ')}.</span></p>
          <button type="button" class="btn btn-primaer btn-breit" data-beide>Beide einreichen …</button>
        </section>` : ''}
        ${gruppen.length ? gruppen.map(({ medium, positionen }) => {
          const schon = diesenMonat.filter((n) => mediumOder(n.medium) === medium);
          return `
        <section class="karte abschicken" data-medium="${esc(medium)}">
          <h2>${mediumBadge(medium)} Noch nicht abgerechnet</h2>
          <ul class="positionen">
            ${positionen.map((p) => `
              <li class="position${p.id === bearbeiteId ? ' in-bearbeitung' : ''}">
                <label class="position-wahl">
                  <input type="checkbox" name="pos" value="${esc(p.id)}" checked aria-label="${esc(p.titel)} abrechnen">
                  <span>
                    <strong>${esc(p.titel)}</strong><br>
                    ${p.zurueck_nummer ? `<span class="zurueck-hinweis">Zurück aus ${esc(p.zurueck_nummer)} zum Überarbeiten${
                      p.zurueck_grund ? `: „${esc(p.zurueck_grund)}“` : ''}</span><br>` : ''}
                    <span class="klein">${[KATEGORIE_LABEL[p.kategorie], artText(p), formatDatum(p.veroeffentlichung)].filter(Boolean).map(esc).join(' · ')}
                      ${p.vereinbart_mit ? ` · vereinbart mit ${esc(p.vereinbart_mit)}` : ''}
                      ${hatArtikel(p.artikel_url) ? ` · ${artikelLink(p.artikel_url, 'Artikel ansehen', '', medium)}` : ''}</span>
                    ${nachweiseHtml(p)}
                  </span>
                </label>
                <span class="position-betrag">${esc(formatEuro(p.betrag))}</span>
                <span class="position-aktionen">
                  <button type="button" class="btn btn-klein" data-bearbeiten="${esc(p.id)}">Bearbeiten</button>
                  <button type="button" class="btn btn-klein btn-gefahr" data-loeschen="${esc(p.id)}">Löschen</button>
                </span>
              </li>`).join('')}
          </ul>
          <p class="summenzeile">Ausgewählt: <strong data-summe>${esc(formatEuro(summe(positionen)))}</strong></p>
          <h3>Monat abschließen · ${esc(mediumName(medium))}</h3>
          ${monatsHinweis(heute)}
          ${schon.length ? `<p class="hinweisbox">Diesen Monat schon eingereicht: ${schon.map((n) => `<strong>${esc(n.nummer)}</strong>`).join(', ')}</p>` : ''}
          <dl class="angaben kompakt">
            <dt>Nummer</dt><dd><span class="nummer">${esc(naechste.nummer)}</span>
              <button type="button" class="link-knopf klein" data-nummer title="Wenn du vor der App schon Prämienabrechnungen geschrieben hast">ändern</button></dd>
            <dt>An</dt><dd>${esc(einstellungen.empfaenger.name)}</dd>
            <dt>Überweisung an</dt><dd>${esc(nutzer.profil.kontoinhaber)}<br><span class="mono">${esc(formatIban(nutzer.profil.iban))}</span></dd>
          </dl>
          <button type="button" class="btn btn-primaer btn-breit" data-abschicken>${esc(formatMonat(heute).split(' ')[0])} einreichen …</button>
        </section>`;
        }).join('') : '<section class="karte"><h2>Noch nicht abgerechnet</h2><p class="klein">Noch keine Leistungen gespeichert.</p></section>'}
      </div>
    </div>
    ${unterwegs.length ? `
    <section class="unterwegs">
      <div class="kopfzeile"><h2>Eingereicht und unterwegs</h2><a href="#/noten" class="klein">Alle Abrechnungen</a></div>
      <ul class="liste" id="unterwegs">${unterwegs.map((n) => noteKarte(n, { kompakt: true, zeiten })).join('')}</ul>
    </section>` : ''}`;
  notenAktionen(el.querySelector('#unterwegs'), unterwegs, { store, neuLaden });

  // ---- Formular
  const form = el.querySelector('#l-form');
  const fehler = (name, t) => { const e = form.querySelector(`[data-fehler="${name}"]`); if (e) e.textContent = t || ''; };
  form.addEventListener('input', (ev) => ev.target.name && fehler(ev.target.name, ''));
  // Medium oder Kategorie gewechselt: Standardsatz übernehmen, solange der Betrag nicht selbst geändert wurde
  const saetze = einstellungen.honorarsaetze ?? {};
  let letzterSatz = form.kategorie.value === 'redigieren' ? null : satzFuer(saetze, form.medium.value, form.kategorie.value);
  const auswahlAnpassen = () => {
    const kat = form.kategorie.value;
    const red = kat === 'redigieren';
    // Redigieren gilt immer für campus a college
    const medium = red ? 'college' : form.medium.value;
    el.querySelector('#l-vereinbart-feld').hidden = kat !== 'ausserordentlich';
    el.querySelector('#l-art-feld').hidden = kat !== 'ausserordentlich';
    el.querySelector('#l-kolumnenart-feld').hidden = kat !== 'kolumne';
    el.querySelector('#l-anzahl-feld').hidden = !red;
    el.querySelector('#l-nachweis-feld').hidden = !red;
    el.querySelector('#l-medium-bereich').hidden = red;
    el.querySelector('#l-redigieren-medium').hidden = !red;
    el.querySelector('#l-titel-label').textContent = red ? 'Beschreibung' : 'Titel des Beitrags';
    el.querySelector('label[for=l-titel] .pflicht').hidden = red;
    el.querySelector('label[for=l-titel] .optional').hidden = !red;
    form.titel.placeholder = red ? 'z. B. Redigieren September' : '';
    el.querySelector('#l-datum-label').textContent = red ? 'Datum' : 'Veröffentlichung';
    el.querySelector('#l-satz-hinweis').textContent = satzHinweis(medium, kat, saetze);
    form.betrag.readOnly = red;
    if (red) {
      if (form.artikel_url.value) artikelSetzen('');
      form.betrag.value = satzText(redigierBetrag(form.anzahl.value, saetze));
      letzterSatz = null;
      return;
    }
    const satz = satzFuer(saetze, medium, kat);
    const bisher = form.betrag.value.trim();
    if (!bisher || parseBetrag(bisher) === letzterSatz || letzterSatz === null) form.betrag.value = satzText(satz);
    letzterSatz = satz;
  };
  form.anzahl.addEventListener('input', () => {
    if (form.kategorie.value === 'redigieren') form.betrag.value = satzText(redigierBetrag(form.anzahl.value, saetze));
  });
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'kategorie') auswahlAnpassen();
    if (ev.target.name === 'medium') {
      auswahlAnpassen();
      // ein verknüpfter Artikel gehört zu einem Medium – passt er nicht mehr, Verknüpfung lösen
      if (form.artikel_url.value && artikelMedium !== form.medium.value) artikelSetzen('');
    }
  });
  el.querySelector('#l-abbrechen')?.addEventListener('click', () => { bearbeiteId = null; neuLaden(); });

  // ---- „Wie letzten Monat“: Kategorie, Art, Betrag usw. übernehmen; Titel und Datum sind neu
  el.querySelector('.wiederholen')?.addEventListener('click', (ev) => {
    const v = vorlagen[ev.target.closest('[data-wiederholen]')?.dataset.wiederholen];
    if (!v) return;
    form.kategorie.value = v.kategorie;
    if (form.medium.type !== 'hidden' || form.medium.value === v.medium) form.medium.value = v.medium;
    auswahlAnpassen();
    artikelSetzen('');
    form.art.value = v.art ? artText(v) : '';
    form.kolumnenart.value = v.kolumnenart ?? '';
    form.vereinbart_mit.value = v.vereinbart_mit ?? '';
    if (v.kategorie === 'redigieren') {
      form.anzahl.value = v.anzahl;
      form.betrag.value = satzText(redigierBetrag(v.anzahl, saetze));
    } else {
      form.betrag.value = formatBetragPlain(v.betrag_eingereicht ?? v.betrag);
      letzterSatz = null; // Betrag nicht beim Umschalten überschreiben
    }
    form.titel.value = '';
    form.veroeffentlichung.value = heuteIso();
    form.titel.focus();
    meldung('Übernommen – jetzt Titel und Datum eintragen.');
  });

  // ---- Nachweise (nur Redigieren): Dateien prüfen, sobald gewählt; vorhandene entfernen
  const nachweisDateien = () => Array.from(form.nachweis.files ?? []);
  const vorhandeneNachweise = () => el.querySelectorAll('#l-nachweise [data-nachweis]').length;
  const nachweiseFehler = () => nachweisDateien().map(nachweisFehler).find(Boolean)
    || (vorhandeneNachweise() + nachweisDateien().length > NACHWEISE_PRO_LEISTUNG
      ? `Höchstens ${NACHWEISE_PRO_LEISTUNG} Nachweise pro Leistung.` : '');
  form.nachweis.addEventListener('change', () => fehler('nachweis', nachweiseFehler()));
  el.querySelector('#l-nachweise').addEventListener('click', async (ev) => {
    const knopf = ev.target.closest('[data-nachweis-loeschen]');
    if (!knopf || !confirm('Nachweis entfernen?')) return;
    await mitSperre(knopf, async () => {
      try {
        await store.nachweisLoeschen(knopf.dataset.nachweisLoeschen);
        knopf.closest('li').remove();
        meldung('Nachweis entfernt.');
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });

  // ---- Artikel von campus-a-college.at und campus-a.at
  const artikelAnzeige = el.querySelector('#l-artikel');
  let artikelMedium = bearbeite ? mediumOder(bearbeite.medium) : null;
  function artikelSetzen(url, medium = form.medium.value) {
    form.artikel_url.value = url;
    artikelMedium = url ? medium : null;
    artikelAnzeige.hidden = !url;
    artikelAnzeige.innerHTML = url ? artikelVermerk(url, medium) : '';
  }
  artikelAnzeige.addEventListener('click', (ev) => {
    if (ev.target.closest('#l-artikel-loesen')) artikelSetzen('');
  });

  const artikelInhalt = el.querySelector('#artikel-inhalt');
  let artikelDaten = null;
  const artikelLaden = async (neu = false) => {
    artikelInhalt.innerHTML = artikelKarteHtml(null);
    try {
      artikelDaten = await store.meineArtikel({ neu });
    } catch (e) {
      artikelDaten = { fehler: fehlerText(e) };
    }
    if (!istAktuell()) return;
    artikelInhalt.innerHTML = artikelKarteHtml(artikelDaten);
  };
  // Suche und Filter: nur die Liste neu zeichnen, damit das Suchfeld den Fokus behält
  const filterAnwenden = () => {
    const ziel = artikelInhalt.querySelector('#artikel-treffer');
    if (ziel && artikelDaten?.artikel) ziel.innerHTML = artikelListeHtml(artikelDaten);
  };
  artikelInhalt.addEventListener('input', (ev) => {
    if (ev.target.id === 'artikel-suche') { artikelFilter.suche = ev.target.value; filterAnwenden(); }
  });
  artikelInhalt.addEventListener('change', (ev) => {
    if (ev.target.id === 'artikel-medium') { artikelFilter.medium = ev.target.value; filterAnwenden(); }
    if (ev.target.id === 'artikel-offen') { artikelFilter.nurOffen = ev.target.checked; filterAnwenden(); }
  });
  artikelInhalt.addEventListener('click', (ev) => {
    if (ev.target.closest('#artikel-neu')) {
      artikelLaden(true);
      return;
    }
    const knopf = ev.target.closest('[data-uebernehmen]');
    const a = knopf && artikelDaten?.artikel?.[Number(knopf.dataset.uebernehmen)];
    if (!a) return;
    if (form.kategorie.value === 'redigieren') {
      form.kategorie.value = 'kolumne';
      auswahlAnpassen();
    }
    form.titel.value = a.titel;
    if (a.datum) form.veroeffentlichung.value = a.datum;
    if (form.medium.value !== a.medium) {
      form.medium.value = a.medium;
      auswahlAnpassen();
    }
    artikelSetzen(a.url, a.medium);
    ['titel', 'veroeffentlichung', 'formular'].forEach((n) => fehler(n, ''));
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.titel.focus({ preventScroll: true });
    meldung('Artikel übernommen – bitte prüfen und speichern.');
  });
  artikelLaden();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    ['titel', 'art', 'anzahl', 'veroeffentlichung', 'betrag', 'vereinbart_mit', 'nachweis', 'formular'].forEach((n) => fehler(n, ''));
    const red = form.kategorie.value === 'redigieren';
    const betrag = parseBetrag(form.betrag.value);
    const anzahl = Number(form.anzahl.value);
    const f = {};
    if (red && !(Number.isInteger(anzahl) && anzahl >= 1 && anzahl <= 1000)) f.anzahl = 'Bitte die Anzahl der Texte angeben (1 bis 1000).';
    if (red && nachweiseFehler()) f.nachweis = nachweiseFehler();
    if (!red && !form.titel.value.trim()) f.titel = 'Bitte den Titel angeben.';
    if (!form.veroeffentlichung.value) f.veroeffentlichung = 'Bitte Datum wählen.';
    if (!red && !betrag) f.betrag = 'Bitte einen Betrag wie 15 oder 15,50 eingeben.';
    if (form.kategorie.value === 'ausserordentlich' && !form.art.value.trim()) f.art = 'Bitte die Art der Anerkennungsprämie angeben.';
    if (form.kategorie.value === 'ausserordentlich' && !form.vereinbart_mit.value.trim()) {
      f.vereinbart_mit = 'Mit wem aus der Redaktion wurde das vereinbart?';
    }
    if (Object.keys(f).length) {
      Object.entries(f).forEach(([n, t]) => fehler(n, t));
      form.elements[Object.keys(f)[0]].focus();
      return;
    }
    const knopf = form.querySelector('button[type=submit]');
    knopf.disabled = true;
    try {
      const positionId = await store.leistungSpeichern({
        id: bearbeiteId ?? undefined,
        medium: form.medium.value, kategorie: form.kategorie.value, art: form.art.value, anzahl: red ? anzahl : undefined, kolumnenart: form.kolumnenart.value, titel: form.titel.value,
        artikel_url: form.artikel_url.value,
        veroeffentlichung: form.veroeffentlichung.value, betrag, vereinbart_mit: form.vereinbart_mit.value,
        ausgabe: form.ausgabe.value, notiz: form.notiz.value,
      });
      if (red && nachweisDateien().length) {
        try {
          await nachweiseHochladen(store, positionId, nachweisDateien());
        } catch (e) {
          // Leistung ist gespeichert – zum Nachreichen offen lassen
          meldung(`Leistung gespeichert, aber der Nachweis fehlt: ${fehlerText(e)}`, 'fehler');
          bearbeiteId = positionId;
          neuLaden();
          return;
        }
      }
      meldung(bearbeiteId ? 'Änderung gespeichert.' : 'Leistung gespeichert.', 'erfolg');
      bearbeiteId = null;
      neuLaden();
    } catch (e) {
      fehler('formular', fehlerText(e));
      knopf.disabled = false;
    }
  });

  // ---- Listen (eine pro Medium)
  const abrechnungen = el.querySelector('#abrechnungen');
  const gewaehlt = (karte) => Array.from(karte.querySelectorAll('input[name=pos]:checked'), (i) => i.value);
  abrechnungen.addEventListener('change', (ev) => {
    const karte = ev.target.closest('[data-medium]');
    if (!karte) return;
    const ids = gewaehlt(karte);
    karte.querySelector('[data-summe]').textContent = formatEuro(summe(liste.filter((p) => ids.includes(p.id))));
    karte.querySelector('[data-abschicken]').disabled = !ids.length;
  });
  abrechnungen.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-bearbeiten]');
    const l = ev.target.closest('[data-loeschen]');
    const a = ev.target.closest('[data-abschicken]');
    const beide = ev.target.closest('[data-beide]');
    if (ev.target.closest('[data-nummer]')) {
      if (await nummerAendern(store, naechste)) neuLaden();
    } else if (b) {
      bearbeiteId = b.dataset.bearbeiten;
      neuLaden();
    } else if (l) {
      const p = liste.find((x) => x.id === l.dataset.loeschen);
      if (!confirm(`„${p.titel}“ wirklich löschen?`)) return;
      try {
        await store.leistungLoeschen(p.id);
        meldung('Leistung gelöscht.');
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
      if (bearbeiteId === p.id) bearbeiteId = null;
      neuLaden();
    } else if (beide) {
      // je Medium die ausgewählten Leistungen; Medien ohne Auswahl bleiben liegen
      const teile = Array.from(abrechnungen.querySelectorAll('section[data-medium]'))
        .map((karte) => ({ medium: karte.dataset.medium, ids: gewaehlt(karte) }))
        .filter((t) => t.ids.length)
        .map((t) => ({ ...t, auswahl: liste.filter((p) => t.ids.includes(p.id)) }));
      if (teile.length < 2) {
        meldung('Bitte bei beiden Medien mindestens eine Leistung auswählen – oder einzeln einreichen.', 'fehler');
        return;
      }
      const tage = tageBisMonatsende(heute);
      const ok = await bestaetigen({
        titel: 'Beide Prämienabrechnungen einreichen?',
        html: `${teile.map((t) => `
          <h3>${mediumBadge(t.medium)} ${esc(anzahlText(t.auswahl.length, 'Leistung', 'Leistungen'))}</h3>
          <ul class="dialog-liste">${t.auswahl.map((p) => `<li><span>${esc(p.titel)}<br><span class="klein">${
            esc([KATEGORIE_LABEL[p.kategorie], formatDatum(p.veroeffentlichung)].join(' · '))}</span></span>
            <span class="mono">${esc(formatEuro(p.betrag))}</span></li>`).join('')}</ul>
          <p class="summenzeile">${esc(mediumName(t.medium))}: <strong>${esc(formatEuro(summe(t.auswahl)))}</strong></p>`).join('')}
          <p class="summenzeile">Zusammen: <strong>${esc(formatEuro(summe(teile.flatMap((t) => t.auswahl))))}</strong></p>
          ${tage > 3 ? `<p class="hinweisbox">Es sind noch ${esc(anzahlText(tage, 'Tag', 'Tage'))} bis Monatsende. Leistungen, die danach dazukommen, brauchen eine eigene Abrechnung.</p>` : ''}
          <p class="klein">Es entstehen zwei Prämienabrechnungen ${esc(formatMonat(heute))} mit eigenen Nummern. Bis die Redaktion sie annimmt, kannst du sie noch zurückziehen und ändern.</p>`,
        ja: 'Beide einreichen',
      });
      if (!ok) return;
      await mitSperre(beide, async () => {
        const nummern = [];
        for (const t of teile) {
          try {
            nummern.push((await store.abrechnungAbschicken(t.ids)).nummer);
          } catch (e) {
            // die erste ist vielleicht schon eingereicht – das sagen, statt es zu verschweigen
            meldung(nummern.length ? `${nummern[0]} ist eingereicht, ${mediumName(t.medium)} aber nicht: ${fehlerText(e)}` : fehlerText(e), 'fehler');
            if (nummern.length) { bearbeiteId = null; neuLaden(); }
            return;
          }
        }
        bearbeiteId = null;
        setFlash({ neu: nummern });
        navigate('noten');
      });
    } else if (a) {
      const karte = a.closest('[data-medium]');
      const medium = karte.dataset.medium;
      const ids = gewaehlt(karte);
      const auswahl = liste.filter((p) => ids.includes(p.id));
      const schon = diesenMonat.some((n) => mediumOder(n.medium) === medium);
      const tage = tageBisMonatsende(heute);
      const ok = await bestaetigen({
        titel: `Prämienabrechnung ${mediumName(medium)} einreichen?`,
        html: `
          <dl class="angaben kompakt"><dt>Nummer</dt><dd class="nummer">${esc(naechste.nummer)}</dd>
            <dt>Monat</dt><dd>${esc(formatMonat(heute))}</dd></dl>
          <ul class="dialog-liste">${auswahl.map((p) => `<li><span>${esc(p.titel)}<br><span class="klein">${
            esc([KATEGORIE_LABEL[p.kategorie], formatDatum(p.veroeffentlichung)].join(' · '))}</span></span>
            <span class="mono">${esc(formatEuro(p.betrag))}</span></li>`).join('')}</ul>
          <p class="summenzeile">Gesamt: <strong>${esc(formatEuro(summe(auswahl)))}</strong></p>
          ${tage > 3 ? `<p class="hinweisbox">Es sind noch ${esc(anzahlText(tage, 'Tag', 'Tage'))} bis Monatsende. Leistungen, die danach dazukommen, brauchen eine eigene Abrechnung.</p>` : ''}
          ${schon ? `<p class="hinweisbox">Du hast diesen Monat schon eine Prämienabrechnung für ${esc(mediumName(medium))} eingereicht.</p>` : ''}
          <p class="klein">Bis die Redaktion sie annimmt, kannst du sie noch zurückziehen und ändern.</p>`,
        ja: 'Jetzt einreichen',
      });
      if (!ok) return;
      await mitSperre(a, async () => {
        try {
          const note = await store.abrechnungAbschicken(ids);
          bearbeiteId = null;
          setFlash({ neu: note.nummer });
          navigate('noten');
        } catch (e) {
          meldung(fehlerText(e), 'fehler');
        }
      });
    }
  });
}
