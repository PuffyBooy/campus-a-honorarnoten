// Autor:in: abgeschickte Honorarnoten mit Status, Download als Word
import {
  KATEGORIE_LABEL, artText, esc, formatDatum, formatEuro, formatMonat, formatZeitpunkt,
} from '../lib/format.js';
import { honorarnoteHerunterladen } from '../lib/beleg.js';
import { weichtAb } from '../lib/honorarsaetze.js';
import { fehlerText, meldung, mitSperre, statusBadge } from '../lib/ui.js';

/**
 * Tabelle der Leistungen einer Honorarnote.
 * saetze: wenn angegeben, wird markiert, wo der eingereichte Betrag vom Standardsatz abweicht (für die Redaktion)
 */
export function positionenTabelle(note, { mitKorrektur = false, saetze = null } = {}) {
  return `
    <table class="tabelle positionen-tabelle">
      <thead><tr><th>Titel des Beitrags</th><th>Kategorie</th><th>Veröffentlichung</th><th class="rechts">Betrag</th>
        ${mitKorrektur ? '<th><span class="sr-only">Aktion</span></th>' : ''}</tr></thead>
      <tbody>${note.positionen.map((p) => `
        <tr>
          <td data-label="Titel"><span><strong>${esc(p.titel)}</strong>
            ${p.ausgabe ? `<br><span class="klein">${esc(p.ausgabe)}</span>` : ''}
            ${p.notiz ? `<br><span class="klein">Notiz: ${esc(p.notiz)}</span>` : ''}</span></td>
          <td data-label="Kategorie"><span>${esc(KATEGORIE_LABEL[p.kategorie])}<br><span class="klein">${esc(artText(p))}${
            p.vereinbart_mit ? ` · vereinbart mit ${esc(p.vereinbart_mit)}` : ''}</span></span></td>
          <td data-label="Veröffentlichung">${esc(formatDatum(p.veroeffentlichung))}</td>
          <td data-label="Betrag" class="rechts"><span>${esc(formatEuro(p.betrag))}
            ${p.betrag !== p.betrag_eingereicht ? `<br><span class="durchgestrichen">${esc(formatEuro(p.betrag_eingereicht))}</span>` : ''}
            ${saetze && weichtAb(p, saetze) ? `<br><span class="abweichung" title="Eingereichter Betrag weicht vom Standardsatz ab">⚠ Standardsatz ${esc(formatEuro(saetze[p.kategorie]))}</span>` : ''}</span></td>
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

export async function render(el, { store, flash, neuLaden, istAktuell }) {
  const noten = await store.meineNoten();
  if (!istAktuell()) return;

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Meine Honorarnoten</h1>
      <a class="btn btn-primaer" href="#/leistungen">+ Leistung speichern</a>
    </div>
    ${flash?.neu ? `<p class="erfolgbox" role="status">Danke! Deine Honorarnote <strong>${esc(flash.neu)}</strong>
      wurde abgeschickt. Die Redaktion prüft sie.</p>` : ''}
    ${noten.length ? `<ul class="liste">${noten.map((n) => `
      <li class="karte note-karte${flash?.neu === n.nummer ? ' neu' : ''}" data-id="${esc(n.id)}">
        <div class="note-kopf">
          <span class="nummer">${esc(n.nummer)}</span>
          ${statusBadge(n.status)}
        </div>
        <p class="meta">Monatsabrechnung ${esc(formatMonat(n.monat))} · abgeschickt am ${esc(formatZeitpunkt(n.eingereicht_am))}
          ${n.bezahlt_am ? ` · <strong>überwiesen am ${esc(formatDatum(n.bezahlt_am))}</strong>` : ''}</p>
        <p class="betrag">${esc(formatEuro(n.betrag))} <span class="klein">(${n.positionen.length}
          ${n.positionen.length === 1 ? 'Leistung' : 'Leistungen'})</span></p>
        ${n.status === 'abgelehnt' ? `<div class="fehlerbox"><strong>Begründung der Ablehnung:</strong> ${esc(n.ablehnungsgrund)}
          ${n.zurueckgeholt_am
            ? '<p class="klein">Die Leistungen wurden zur Überarbeitung in „Meine Leistungen“ übernommen.</p>'
            : '<p><button type="button" class="btn btn-klein" data-zurueck>Leistungen überarbeiten und neu abschicken</button></p>'}
          </div>` : ''}
        <details class="aufklapp">
          <summary>Leistungen anzeigen</summary>
          ${positionenTabelle(n)}
        </details>
        <div class="aktionen">
          <button type="button" class="btn btn-klein" data-word>Honorarnote (Word) herunterladen</button>
        </div>
      </li>`).join('')}</ul>`
    : '<section class="karte"><p>Du hast noch keine Honorarnote abgeschickt.</p></section>'}
    <p class="legende">Ablauf: Abgeschickt → Angenommen oder Abgelehnt → Bezahlt</p>`;

  el.querySelector('.liste')?.addEventListener('click', async (ev) => {
    const karte = ev.target.closest('[data-id]');
    const n = noten.find((x) => x.id === karte?.dataset.id);
    const knopf = ev.target.closest('button');
    if (!n || !knopf) return;
    if ('word' in knopf.dataset) {
      await mitSperre(knopf, () => honorarnoteHerunterladen(n).catch((e) => meldung(fehlerText(e), 'fehler')));
    } else if ('zurueck' in knopf.dataset) {
      try {
        await store.leistungenZurueckholen(n.id);
        meldung('Die Leistungen stehen wieder unter „Meine Leistungen“ zum Bearbeiten bereit.', 'erfolg');
        location.hash = '#/leistungen';
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
        neuLaden();
      }
    }
  });
}
