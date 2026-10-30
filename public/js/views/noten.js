// Autor:in: eingereichte Prämienabrechnungen eines Jahres mit Verlauf, Zurückziehen und Download als Word
import {
  KATEGORIE_LABEL, artText, esc, formatDatum, formatEuro, formatMonat, formatZeitpunkt,
} from '../lib/format.js';
import { honorarnoteHerunterladen, jahresuebersichtHerunterladen } from '../lib/beleg.js';
import { downloadBlob } from '../lib/csv.js';
import { standardBetrag, weichtAb } from '../lib/honorarsaetze.js';
import { hatArtikel, mediumBadge, mediumName, titelLink } from '../lib/campus.js';
import { bestaetigen, fehlerText, meldung, mitSperre, statusBadge } from '../lib/ui.js';
import { kannZurueckziehen, schritteHtml } from '../lib/schritte.js';
import { nachweiseHtml } from '../lib/nachweise.js';
import { chatAnzeigen } from '../lib/rueckfrage.js';

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
            ${p.notiz ? `<br><span class="klein">Notiz: ${esc(p.notiz)}</span>` : ''}
            ${nachweiseHtml(p)}</span></td>
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

/** Rückfrage der Redaktion: offen als Chat zum Antworten, sonst die Nachrichten zum Aufklappen */
function rueckfrageHtml(n, kompakt) {
  if (!n.nachrichten && !n.rueckfrage) return '';
  const offen = n.rueckfrage === 'offen' && ['eingereicht', 'angenommen'].includes(n.status);
  if (kompakt) {
    return offen ? `<p class="rueckfrage-hinweis"><strong>❓ Die Redaktion hat eine Rückfrage.</strong>
      <a href="#/noten" class="btn btn-klein">Antworten</a></p>` : '';
  }
  return `<details class="aufklapp rueckfrage-box${offen ? ' rueckfrage-offen' : ''}" ${offen ? 'open' : ''} data-rueckfrage>
      <summary>${offen ? '<strong>❓ Rückfrage der Redaktion – bitte antworten</strong>'
        : `💬 Nachrichten mit der Redaktion (${n.nachrichten})${n.rueckfrage === 'beantwortet' ? ' · deine Antwort ist angekommen' : ''}`}</summary>
      <div data-chat><p class="laden">Wird geladen …</p></div>
    </details>`;
}

/**
 * Wann kommt das Geld ungefähr? Aus den üblichen Zeiten (ablaufZeiten) – nur solange noch nicht bezahlt.
 */
export function prognoseHtml(n, zeiten) {
  if (!zeiten?.zahlung_tage && zeiten?.zahlung_tage !== 0) return '';
  const plus = (iso, tage) => new Date(new Date(iso).getTime() + tage * 86400000);
  let ziel;
  let text = '';
  if (n.status === 'eingereicht' && zeiten.pruefung_tage != null) {
    ziel = plus(n.eingereicht_am, zeiten.pruefung_tage + zeiten.zahlung_tage);
    text = `Die Redaktion prüft meist innerhalb von ${zeiten.pruefung_tage === 1 ? 'einem Tag' : `${zeiten.pruefung_tage} Tagen`}. `;
  } else if (n.status === 'angenommen' && n.entschieden_am) {
    ziel = plus(n.entschieden_am, zeiten.zahlung_tage);
  } else {
    return '';
  }
  const datum = ziel.toLocaleDateString('de-AT', { day: 'numeric', month: 'long' });
  return `<p class="prognose klein">⏱ ${esc(text)}${ziel < new Date()
    ? 'Die Überweisung sollte bald kommen.' : `Überweisung voraussichtlich bis <strong>${esc(datum)}</strong>.`}</p>`;
}

/** Karte einer Abrechnung mit Verlauf (auch in „Mein Monat“ verwendet) */
export function noteKarte(n, { neu = false, kompakt = false, zeiten = null } = {}) {
  return `
      <li class="karte note-karte${neu ? ' neu' : ''}" data-id="${esc(n.id)}">
        <div class="note-kopf">
          <span class="nummer">${esc(n.nummer)}</span>
          <span>${mediumBadge(n.medium)} ${statusBadge(n.status)}</span>
        </div>
        <p class="meta">Monatsabrechnung ${esc(formatMonat(n.monat))} · abgeschickt am ${esc(formatZeitpunkt(n.eingereicht_am))}</p>
        ${schritteHtml(n)}
        ${prognoseHtml(n, zeiten)}
        <p class="betrag">${esc(formatEuro(n.betrag))} <span class="klein">(${n.positionen.length}
          ${n.positionen.length === 1 ? 'Leistung' : 'Leistungen'})</span></p>
        ${n.status === 'abgelehnt' ? `<div class="fehlerbox"><strong>Begründung der Ablehnung:</strong> ${esc(n.ablehnungsgrund)}
          ${n.zurueckgeholt_am
            ? '<p>Die Leistungen sind zurück in <a href="#/leistungen">Mein Monat</a>. Dort überarbeiten und neu einreichen.</p>'
            : '<p><button type="button" class="btn btn-klein" data-zurueck>Leistungen überarbeiten und neu abschicken</button></p>'}
          </div>` : ''}
        ${rueckfrageHtml(n, kompakt)}
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
export function notenAktionen(liste, noten, { store, neuLaden, navigate }) {
  // Chats der Rückfragen: offene gleich laden, die anderen beim Aufklappen
  liste?.querySelectorAll('[data-rueckfrage]').forEach((box) => {
    const n = noten.find((x) => x.id === box.closest('[data-id]').dataset.id);
    let geladen = false;
    const laden = () => {
      if (geladen || !box.open) return;
      geladen = true;
      chatAnzeigen(box.querySelector('[data-chat]'), { store, note: n, rolle: 'autor', nachAenderung: () => neuLaden() })
        .catch((e) => { box.querySelector('[data-chat]').innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`; });
    };
    box.addEventListener('toggle', laden);
    laden();
  });
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
      // navigate zeichnet auch neu, wenn man schon in „Mein Monat“ ist (dort gibt es keinen hashchange)
      if (await zurueckziehen(store, n)) navigate('leistungen');
    } else if ('zurueck' in knopf.dataset) {
      try {
        await store.leistungenZurueckholen(n.id);
        meldung('Leistungen zurückgeholt.', 'erfolg');
        navigate('leistungen');
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
        neuLaden();
      }
    }
  });
}

let gewaehltesJahr = null; // bleibt beim Neuladen der Seite erhalten

export async function render(el, { store, nutzer, flash, neuLaden, navigate, istAktuell }) {
  const neu = [].concat(flash?.neu ?? []); // eine Nummer oder mehrere (beide Medien auf einmal eingereicht)
  const [alle, zeiten] = await Promise.all([store.meineNoten(), Promise.resolve(store.ablaufZeiten()).catch(() => null)]);
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
      <span class="aktionen eng">
        <button type="button" class="btn" id="n-jahresuebersicht" title="Alle Abrechnungen ${gewaehltesJahr} mit Summen – z. B. für Steuer oder Beihilfe">📄 Jahresübersicht ${gewaehltesJahr}</button>
        <a class="btn" href="#/leistungen">Zu Mein Monat</a></span>
    </div>
    ${neu.length ? `<p class="erfolgbox" role="status">Danke! ${neu.length === 1 ? 'Deine Prämienabrechnung' : 'Deine Prämienabrechnungen'}
      ${neu.map((x) => `<strong>${esc(x)}</strong>`).join(' und ')} ${neu.length === 1 ? 'wurde' : 'wurden'} eingereicht.
      Die Redaktion prüft ${neu.length === 1 ? 'sie' : 'beide'}. Bis dahin kannst du noch zurückziehen und ändern.</p>` : ''}
    <section class="kennzahlen" aria-label="Summen ${gewaehltesJahr}">
      <div class="kennzahl"><span class="kennzahl-titel">${gewaehltesJahr} ausgezahlt</span>
        <strong>${esc(formatEuro(euroSumme(bezahlt)))}</strong><span class="klein">${bezahlt.length} ${bezahlt.length === 1 ? 'Abrechnung' : 'Abrechnungen'}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Unterwegs</span>
        <strong>${esc(formatEuro(euroSumme(unterwegs)))}</strong><span class="klein">eingereicht oder angenommen, noch nicht bezahlt</span></div>
      <div class="kennzahl kennzahl-wahl"><label for="n-jahr" class="kennzahl-titel">Jahr</label>
        <select id="n-jahr">${jahre.map((j) => `<option ${j === gewaehltesJahr ? 'selected' : ''}>${j}</option>`).join('')}</select></div>
    </section>
    ${noten.length ? `<ul class="liste">${noten.map((n) => noteKarte(n, { neu: neu.includes(n.nummer), zeiten })).join('')}</ul>`
    : `<section class="karte"><p>${gewaehltesJahr} noch keine Prämienabrechnungen.</p></section>`}`;

  el.querySelector('#n-jahresuebersicht').addEventListener('click', (ev) => mitSperre(ev.currentTarget, () =>
    jahresuebersichtHerunterladen(alle, gewaehltesJahr, nutzer).catch((e) => meldung(`PDF: ${fehlerText(e)}`, 'fehler'))));
  el.querySelector('#n-jahr').addEventListener('change', (ev) => { gewaehltesJahr = Number(ev.target.value); neuLaden(); });
  notenAktionen(el.querySelector('.liste'), noten, { store, neuLaden, navigate });
}
