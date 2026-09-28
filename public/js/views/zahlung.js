// Bezahl-Terminal (Buchhaltung): angenommene Honorarnoten nach Kalenderwoche.
// Pro Woche alle Honorarnoten als ein PDF herunterladen und die Woche als bezahlt markieren.
import { esc, formatDatum, formatEuro, heuteIso, vollerName } from '../lib/format.js';
import { kalenderwoche, nachWoche, wocheText } from '../lib/woche.js';
import { honorarnotenPdfHerunterladen } from '../lib/beleg.js';
import { fehlerText, meldung, mitSperre } from '../lib/ui.js';

const WOCHEN_ZURUECK = 12; // so viele Wochen zeigt der Reiter „Bezahlt“

// Gruppiert wird nach der Woche, in der die Redaktion die Honorarnote angenommen hat
const angenommenAm = (n) => n.entschieden_am ?? n.eingereicht_am;
const summe = (noten) => noten.reduce((s, n) => s + Math.round(n.betrag * 100), 0) / 100;
const anzahl = (noten) => `${noten.length} ${noten.length === 1 ? 'Honorarnote' : 'Honorarnoten'}`;
const pdfName = (w) => `Honorarnoten_${w.jahr}_KW${String(w.kw).padStart(2, '0')}.pdf`;

function wochenKarte({ woche, noten }, bezahlt) {
  return `
    <section class="karte woche" data-woche="${esc(woche.schluessel)}">
      <div class="woche-kopf">
        <h2>${esc(wocheText(woche))}</h2>
        <p class="woche-summe">${esc(anzahl(noten))} · <strong>${esc(formatEuro(summe(noten)))}</strong></p>
      </div>
      <table class="tabelle">
        <thead><tr><th>Nummer</th><th>Name</th>${bezahlt ? '<th>Bezahlt am</th>' : ''}<th class="rechts">Betrag</th></tr></thead>
        <tbody>${noten.map((n) => `
          <tr>
            <td data-label="Nummer" class="nummer">${esc(n.nummer)}</td>
            <td data-label="Name">${esc(vollerName(n.autor))}</td>
            ${bezahlt ? `<td data-label="Bezahlt am">${esc(formatDatum(n.bezahlt_am))}</td>` : ''}
            <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="aktionen">
        <button type="button" class="btn${bezahlt ? ' btn-primaer' : ''}" data-pdf>PDF herunterladen</button>
        ${bezahlt ? '' : '<button type="button" class="btn btn-erfolg" data-bezahlt>Woche als bezahlt markieren</button>'}
      </div>
    </section>`;
}

async function anzeigen(inhalt, { store, neuLaden, istAktuell }, bezahlt) {
  let noten;
  try {
    noten = bezahlt
      ? await store.bezahlteNotenSeit(kalenderwoche(Date.now() - WOCHEN_ZURUECK * 7 * 86400000).montag)
      : await store.offeneZahlungen();
  } catch (e) {
    inhalt.innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    return;
  }
  if (!istAktuell()) return;
  const wochen = nachWoche(noten, angenommenAm);
  if (bezahlt) wochen.reverse(); // bezahlt: neueste Woche zuerst, offen: älteste zuerst

  inhalt.innerHTML = wochen.length
    ? `<p class="tipp">${bezahlt
      ? `Bezahlte Honorarnoten der letzten ${WOCHEN_ZURUECK} Wochen, nach der Woche, in der sie angenommen wurden.`
      : 'Angenommene Honorarnoten nach der Woche, in der sie angenommen wurden. PDF herunterladen, überweisen, Woche als bezahlt markieren.'}</p>
       ${wochen.map((g) => wochenKarte(g, bezahlt)).join('')}`
    : `<section class="karte"><p>${bezahlt ? `In den letzten ${WOCHEN_ZURUECK} Wochen wurde nichts bezahlt.` : 'Keine offenen Honorarnoten. 🎉'}</p></section>`;

  const nachSchluessel = new Map(wochen.map((g) => [g.woche.schluessel, g]));
  inhalt.addEventListener('click', (ev) => {
    const knopf = ev.target.closest('button');
    const karte = knopf?.closest('.woche');
    const g = karte && nachSchluessel.get(karte.dataset.woche);
    if (!g) return;

    if ('pdf' in knopf.dataset) {
      mitSperre(knopf, () => honorarnotenPdfHerunterladen(g.noten, pdfName(g.woche))
        .catch((e) => { console.error(e); meldung(`PDF konnte nicht erstellt werden: ${fehlerText(e)}`, 'fehler'); }));
    } else if ('bezahlt' in knopf.dataset) {
      if (!confirm(`${wocheText(g.woche)}: ${anzahl(g.noten)} über ${formatEuro(summe(g.noten))} `
        + `mit heutigem Datum (${formatDatum(heuteIso())}) als bezahlt markieren?`)) return;
      mitSperre(knopf, async () => {
        try {
          await store.alleAlsBezahltMarkieren(g.noten.map((n) => n.id), heuteIso());
          meldung(`KW ${g.woche.kw}: ${anzahl(g.noten)} als bezahlt markiert.`, 'erfolg');
          neuLaden();
        } catch (e) {
          meldung(fehlerText(e), 'fehler');
        }
      });
    }
  });
}

export async function render(el, ctx) {
  const tab = ctx.params.tab === 'bezahlt' ? 'bezahlt' : 'offen';
  el.innerHTML = `
    <h1>Bezahl-Terminal</h1>
    <nav class="reiter" aria-label="Ansicht">
      <a href="#/zahlung"${tab === 'offen' ? ' aria-current="page"' : ''}>Offen</a>
      <a href="#/zahlung/bezahlt"${tab === 'bezahlt' ? ' aria-current="page"' : ''}>Bezahlt</a>
    </nav>
    <div id="z-inhalt"></div>`;
  await anzeigen(el.querySelector('#z-inhalt'), ctx, tab === 'bezahlt');
}
