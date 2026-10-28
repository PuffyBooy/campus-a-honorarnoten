// Autor:in: eingereichte Prämienabrechnungen eines Jahres mit Verlauf, Zurückziehen und Download als Word
import {
  KATEGORIE_LABEL, artText, esc, formatDatum, formatEuro, formatMonat, formatZeitpunkt,
} from '../lib/format.js';
import { honorarnoteHerunterladen } from '../lib/beleg.js';
import { downloadBlob } from '../lib/csv.js';
import { standardBetrag, weichtAb } from '../lib/honorarsaetze.js';
import { hatArtikel, mediumBadge, mediumName, titelLink } from '../lib/campus.js';
import { bestaetigen, fehlerText, meldung, mitSperre, statusBadge } from '../lib/ui.js';
import { kannZurueckziehen, schritteHtml } from '../lib/schritte.js';

/**
 * Tabelle der Leistungen einer Prämienabrechnung. Jeder Titel ist ein Link (neuer Tab): zum verknüpften
 * Artikel oder zur Suche nach dem Titel auf campus-a-college.at.
 * saetze: wenn angegeben, wird markiert, wo der eingereichte Betrag vom Standardsatz abweicht (für die Redaktion)
 * pruefen: Leistungen ohne Artikel-Link kennzeichnen (für Redaktion und Buchhaltung)
 */
export function positionenTabelle(note, { mitKorrektur = false, saetze = null, pruefen = false } = {}) {
  return `
    <table class="tabelle positionen-tabelle">
      <thead><tr><th>Titel des Beitrags</th><th>Kategorie</th><th>Veröffentlichung</th><th class="rechts">Betrag</th>
        ${mitKorrektur ? '<th><span class="sr-only">Aktion</span></th>' : ''}</tr></thead>
      <tbody>${note.positionen.map((p) => `
        <tr>
          <td data-label="Titel"><span>${p.kategorie === 'redigieren' ? `<strong>${esc(p.titel)}</strong>` : `<strong>${titelLink(p.artikel_url, p.titel, 'artikel-titel', note.medium)}</strong> <span aria-hidden="true">↗</span>
            ${!hatArtikel(p.artikel_url) && pruefen ? '<br><span class="ohne-link">nicht verknüpft – Klick sucht den Titel</span>' : ''}`}
            ${p.ausgabe ? `<br><span class="klein">${esc(p.ausgabe)}</span>` : ''}
            ${p.notiz ? `<br><span class="klein">Notiz: ${esc(p.notiz)}</span>` : ''}</span></td>
          <td data-label="Kategorie"><span>${esc(KATEGORIE_LABEL[p.kategorie])}<br><span class="klein">${esc(artText(p))}${
            p.vereinbart_mit ? ` · vereinbart mit ${esc(p.vereinbart_mit)}` : ''}</span></span></td>
          <td data-label="Veröffentlichung">${esc(formatDatum(p.veroeffentlichung))}</td>
          <td data-label="Betrag" class="rechts"><span>${esc(formatEuro(p.betrag))}
            ${p.betrag !== p.betrag_eingereicht ? `<br><span class="durchgestrichen">${esc(formatEuro(p.betrag_eingereicht))}</span>` : ''}
            ${saetze && weichtAb({ ...p, medium: note.medium }, saetze) ? `<br><span class="abweichung" title="Eingereichter Betrag weicht vom Standardsatz ab">⚠ Standardsatz ${esc(formatEuro(standardBetrag(saetze, { ...p, medium: note.medium })))}</span>` : ''}</span></td>
          ${mitKorrektur ? `<td data-label="">${note.status !== 'bezahlt'
            ? `<button type="button" class="btn btn-klein" data-korrigieren="${esc(p.id)}">Betrag ändern</button>` : ''}</td>` : ''}
        </tr>
        ${p.betrag_vermerk ? `<tr class="vermerk-zeile"><td colspan="${mitKorrektur ? 5 : 4}">
          <span class="hinweisbox">Betrag angepasst: ${esc(p.betrag_vermerk)}</span></td></tr>` : ''}`).join('')}
      </tbody>
      <tfoot><tr><td colspan="3" class="rechts">Gesamtbetrag</td>
        <td class="rechts"><strong>${esc(formatEuro(note.betrag))}</strong></td>${mitKorrektur ? '<td></td>' : ''}</tr></tfoot>
    </table>`;
}

const cent = (b) => Math.round(b * 100);
const euroSumme = (noten) => noten.reduce((s, n) => s + cent(n.betrag), 0) / 100;
const jahrVon = (n) => Number(String(n.monat).slice(0, 4));

/**
 * Abrechnung zurückziehen (nach Rückfrage). Die Leistungen kommen zurück in „Mein Monat“.
 * Liefert true, wenn zurückgezogen wurde.
 */
export async function zurueckziehen(store, n) {
  const ok = await bestaetigen({
    titel: `${n.nummer} zurückziehen?`,
    html: `<p>Die Prämienabrechnung ${esc(mediumName(n.medium))} über <strong>${esc(formatEuro(n.betrag))}</strong>
      geht nicht mehr an die Redaktion. Die ${n.positionen.length === 1 ? 'Leistung kommt' : `${n.positionen.length} Leistungen kommen`}
      zurück in <strong>Mein Monat</strong>. Dort kannst du sie ändern und neu einreichen.</p>`,
    ja: 'Zurückziehen',
    gefahr: true,
  });
  if (!ok) return false;
  try {
    await store.abrechnungZurueckziehen(n.id);
    meldung(`${n.nummer} zurückgezogen. Die Leistungen sind wieder in „Mein Monat“.`, 'erfolg');
    return true;
  } catch (e) {
    meldung(fehlerText(e), 'fehler');
    return false;
  }
}

/** Karte einer Abrechnung mit Verlauf (auch in „Mein Monat“ verwendet) */
export function noteKarte(n, { neu = false, kompakt = false } = {}) {
  return `
      <li class="karte note-karte${neu ? ' neu' : ''}" data-id="${esc(n.id)}">
        <div class="note-kopf">
          <span class="nummer">${esc(n.nummer)}</span>
          <span>${mediumBadge(n.medium)} ${statusBadge(n.status)}</span>
        </div>
        <p class="meta">Monatsabrechnung ${esc(formatMonat(n.monat))} · abgeschickt am ${esc(formatZeitpunkt(n.eingereicht_am))}</p>
        ${schritteHtml(n)}
        <p class="betrag">${esc(formatEuro(n.betrag))} <span class="klein">(${n.positionen.length}
          ${n.positionen.length === 1 ? 'Leistung' : 'Leistungen'})</span></p>
        ${n.status === 'abgelehnt' ? `<div class="fehlerbox"><strong>Begründung der Ablehnung:</strong> ${esc(n.ablehnungsgrund)}
          ${n.zurueckgeholt_am
            ? '<p>Die Leistungen sind zurück in <a href="#/leistungen">Mein Monat</a>. Dort überarbeiten und neu einreichen.</p>'
            : '<p><button type="button" class="btn btn-klein" data-zurueck>Leistungen überarbeiten und neu abschicken</button></p>'}
          </div>` : ''}
        ${kompakt ? '' : `<details class="aufklapp">
          <summary>Leistungen anzeigen</summary>
          ${positionenTabelle(n)}
        </details>`}
        <div class="aktionen">
          ${kannZurueckziehen(n) ? '<button type="button" class="btn btn-klein" data-zurueckziehen>Zurückziehen und bearbeiten</button>' : ''}
          <button type="button" class="btn btn-klein" data-word>Word herunterladen</button>
          ${n.status === 'bezahlt' ? '<button type="button" class="btn btn-klein" data-avis>Zahlungsavis (PDF)</button>' : ''}
        </div>
      </li>`;
}

/** Klicks in einer Liste von noteKarte(): Word, Zurückholen, Zurückziehen */
export function notenAktionen(liste, noten, { store, neuLaden }) {
  liste?.addEventListener('click', async (ev) => {
    const karte = ev.target.closest('[data-id]');
    const n = noten.find((x) => x.id === karte?.dataset.id);
    const knopf = ev.target.closest('button');
    if (!n || !knopf) return;
    if ('word' in knopf.dataset) {
      await mitSperre(knopf, () => honorarnoteHerunterladen(n).catch((e) => meldung(fehlerText(e), 'fehler')));
    } else if ('avis' in knopf.dataset) {
      await mitSperre(knopf, async () => {
        try {
          const r = await store.zahlungsavis(n.id);
          downloadBlob(r.name, new Blob([Uint8Array.from(atob(r.inhalt), (c) => c.charCodeAt(0))], { type: 'application/pdf' }));
        } catch (e) {
          meldung(fehlerText(e), 'fehler');
        }
      });
    } else if ('zurueckziehen' in knopf.dataset) {
      if (await zurueckziehen(store, n)) location.hash = '#/leistungen';
    } else if ('zurueck' in knopf.dataset) {
      try {
        await store.leistungenZurueckholen(n.id);
        meldung('Leistungen zurückgeholt.', 'erfolg');
        location.hash = '#/leistungen';
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
        neuLaden();
      }
    }
  });
}

let gewaehltesJahr = null; // bleibt beim Neuladen der Seite erhalten

export async function render(el, { store, flash, neuLaden, istAktuell }) {
  const alle = await store.meineNoten();
  if (!istAktuell()) return;
  const diesesJahr = new Date().getFullYear();
  const jahre = [...new Set([diesesJahr, ...alle.map(jahrVon)])].sort((a, b) => b - a);
  if (!jahre.includes(gewaehltesJahr)) gewaehltesJahr = diesesJahr;
  const noten = alle.filter((n) => jahrVon(n) === gewaehltesJahr);
  const bezahlt = noten.filter((n) => n.status === 'bezahlt');
  const unterwegs = noten.filter((n) => ['eingereicht', 'angenommen'].includes(n.status));

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Meine Abrechnungen</h1>
      <a class="btn" href="#/leistungen">Zu Mein Monat</a>
    </div>
    ${flash?.neu ? `<p class="erfolgbox" role="status">Danke! Deine Prämienabrechnung <strong>${esc(flash.neu)}</strong>
      wurde eingereicht. Die Redaktion prüft sie. Bis dahin kannst du sie noch zurückziehen und ändern.</p>` : ''}
    <section class="kennzahlen" aria-label="Summen ${gewaehltesJahr}">
      <div class="kennzahl"><span class="kennzahl-titel">${gewaehltesJahr} ausgezahlt</span>
        <strong>${esc(formatEuro(euroSumme(bezahlt)))}</strong><span class="klein">${bezahlt.length} ${bezahlt.length === 1 ? 'Abrechnung' : 'Abrechnungen'}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Unterwegs</span>
        <strong>${esc(formatEuro(euroSumme(unterwegs)))}</strong><span class="klein">eingereicht oder angenommen, noch nicht bezahlt</span></div>
      <div class="kennzahl kennzahl-wahl"><label for="n-jahr" class="kennzahl-titel">Jahr</label>
        <select id="n-jahr">${jahre.map((j) => `<option ${j === gewaehltesJahr ? 'selected' : ''}>${j}</option>`).join('')}</select></div>
    </section>
    ${noten.length ? `<ul class="liste">${noten.map((n) => noteKarte(n, { neu: flash?.neu === n.nummer })).join('')}</ul>`
    : `<section class="karte"><p>${gewaehltesJahr} noch keine Prämienabrechnungen.</p></section>`}`;

  el.querySelector('#n-jahr').addEventListener('change', (ev) => { gewaehltesJahr = Number(ev.target.value); neuLaden(); });
  notenAktionen(el.querySelector('.liste'), noten, { store, neuLaden });
}
