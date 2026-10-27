// Buchhaltung: angenommene Prämienabrechnungen nach Kalenderwoche. Pro Woche alle als ein PDF
// herunterladen oder an sich selbst mailen, SEPA-Datei für die Sammelüberweisung, Woche als bezahlt markieren.
import { esc, formatDatum, formatEuro, formatMonat, heuteIso, vollerName } from '../lib/format.js';
import { kalenderwoche, nachWoche, wocheText } from '../lib/woche.js';
import { base64, honorarnotenPdfBytes, honorarnotenPdfHerunterladen } from '../lib/beleg.js';
import { downloadText } from '../lib/csv.js';
import { sepaXml } from '../lib/sepa.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from '../lib/ui.js';
import { mediumBadge, mediumName } from '../lib/campus.js';

const WOCHEN_ZURUECK = 12; // so viele Wochen zeigt der Reiter „Bezahlt“

// Gruppiert wird nach der Woche, in der die Redaktion die Prämienabrechnung angenommen hat
const angenommenAm = (n) => n.entschieden_am ?? n.eingereicht_am;
const summe = (noten) => noten.reduce((s, n) => s + Math.round(n.betrag * 100), 0) / 100;
const anzahl = (noten) => `${noten.length} ${noten.length === 1 ? 'Prämienabrechnung' : 'Prämienabrechnungen'}`;
const kw = (w) => `${w.jahr}_KW${String(w.kw).padStart(2, '0')}`;
const pdfName = (w) => `Praemienabrechnungen_${kw(w)}.pdf`;
const sepaName = (w) => `Sammelueberweisung_${kw(w)}.xml`;
const SEPA_FORMAT = 'pain.001.001.09'; // aktuelles SEPA-Regelwerk, nehmen österreichische Banken an

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
            <td data-label="Name"><span>${esc(vollerName(n.autor))}<br>${mediumBadge(n.medium)}</span></td>
            ${bezahlt ? `<td data-label="Bezahlt am">${esc(formatDatum(n.bezahlt_am))}</td>` : ''}
            <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="aktionen">
        <button type="button" class="btn" data-pdf>PDF herunterladen</button>
        <button type="button" class="btn" data-mailen>PDF an mich mailen</button>
        ${bezahlt ? '' : `<button type="button" class="btn" data-sepa>SEPA-Datei</button>
        <button type="button" class="btn btn-erfolg" data-bezahlt>Woche als bezahlt markieren</button>`}
      </div>
    </section>`;
}

/** PDF erstellen und als Anhang an die eigene Adresse schicken */
async function pdfMailen(store, noten, dateiname, titel) {
  const bytes = await honorarnotenPdfBytes(noten);
  const r = await store.pdfMailen(dateiname, base64(bytes), titel);
  meldung(`PDF an ${r.an} geschickt.`, 'erfolg');
}

/** SEPA-Datei (pain.001) für die Noten einer Woche: Ausführungsdatum abfragen, dann herunterladen */
async function sepaDatei(konto, g, { nutzer }) {
  if (!konto.iban) {
    meldung(nutzer.rollen.includes('admin')
      ? 'Zuerst das Zahlungskonto eintragen: Admin → Einstellungen.'
      : 'Es ist noch kein Zahlungskonto eingetragen. Bitte den Admin, es unter Admin → Einstellungen einzutragen.', 'fehler');
    return;
  }
  const datum = await bestaetigen({
    titel: `SEPA-Datei ${wocheText(g.woche)}`,
    html: `<p>${esc(anzahl(g.noten))} über <strong>${esc(formatEuro(summe(g.noten)))}</strong> von
      <strong>${esc(konto.name)}</strong>. Die Datei im Online-Banking (z. B. George, ELBA) als Sammelauftrag hochladen und dort freigeben.</p>
      <p class="klein">Format ${esc(SEPA_FORMAT)}. Danach hier „Woche als bezahlt markieren“.</p>`,
    eingabe: { label: 'Ausführungsdatum', wert: heuteIso(), typ: 'date' },
    ja: 'SEPA-Datei herunterladen',
  });
  if (!datum) return;
  const xml = sepaXml({
    auftraggeber: konto,
    ausfuehrung: datum,
    format: SEPA_FORMAT,
    nachrichtId: `PRAEMIEN-${kw(g.woche)}-${Date.now().toString(36)}`,
    zahlungen: g.noten.map((n) => ({
      referenz: n.nummer, name: n.zahlung?.kontoinhaber || vollerName(n.autor), iban: n.zahlung?.iban, bic: n.zahlung?.bic ?? '',
      betrag: n.betrag, zweck: `Anerkennungspraemie ${n.nummer} ${mediumName(n.medium)} ${formatMonat(n.monat)}`,
    })),
  });
  downloadText(sepaName(g.woche), xml, 'application/xml;charset=utf-8');
  meldung('SEPA-Datei heruntergeladen.', 'erfolg');
}

async function anzeigen(inhalt, ctx, bezahlt) {
  const { store, neuLaden, istAktuell } = ctx;
  const jahr = heuteIso().slice(0, 4);
  let noten, imJahr, konto;
  try {
    [noten, imJahr, konto] = await Promise.all([
      bezahlt ? store.bezahlteNotenSeit(kalenderwoche(Date.now() - WOCHEN_ZURUECK * 7 * 86400000).montag) : store.offeneZahlungen(),
      store.bezahlteNotenSeit(`${jahr}-01-01`),
      store.zahlungskonto(),
    ]);
  } catch (e) {
    inhalt.innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`;
    return;
  }
  if (!istAktuell()) return;
  const offen = bezahlt ? [] : noten;
  const wochen = nachWoche(noten, angenommenAm);
  if (bezahlt) wochen.reverse(); // bezahlt: neueste Woche zuerst, offen: älteste zuerst

  inhalt.innerHTML = `
    ${bezahlt ? '' : `<section class="kennzahlen" aria-label="Überblick">
      <div class="kennzahl kennzahl-marke"><span class="kennzahl-titel">Offen zur Zahlung</span>
        <strong>${esc(formatEuro(summe(offen)))}</strong><span class="klein">${esc(anzahl(offen))}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">${esc(jahr)} ausgezahlt</span>
        <strong>${esc(formatEuro(summe(imJahr)))}</strong><span class="klein">${esc(anzahl(imJahr))}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Zahlungskonto</span>
        ${konto.iban ? `<strong class="kennzahl-text">${esc(konto.name)}</strong><span class="klein mono">…${esc(konto.iban.slice(-4))}</span>`
          : '<span class="klein">Noch nicht eingetragen (Admin → Einstellungen). Nötig für die SEPA-Datei.</span>'}</div>
    </section>`}
    ${wochen.length ? `
      <div class="kopfzeile">
        <p class="tipp">${bezahlt
          ? `Bezahlte Prämienabrechnungen der letzten ${WOCHEN_ZURUECK} Wochen, nach der Woche, in der sie angenommen wurden.`
          : 'Nach der Woche, in der sie angenommen wurden: PDF und SEPA-Datei holen, im Online-Banking überweisen, Woche als bezahlt markieren.'}</p>
        ${wochen.length > 1 ? `<button type="button" class="btn btn-klein" id="z-alle-pdf">Alle ${esc(anzahl(noten))} als ein PDF</button>` : ''}
      </div>
      ${wochen.map((g) => wochenKarte(g, bezahlt)).join('')}`
    : `<section class="karte"><p>${bezahlt ? `In den letzten ${WOCHEN_ZURUECK} Wochen wurde nichts bezahlt.` : 'Keine offenen Prämienabrechnungen. 🎉'}</p></section>`}`;

  const pdfFehler = (e) => { console.error(e); meldung(`PDF konnte nicht erstellt werden: ${fehlerText(e)}`, 'fehler'); };
  inhalt.querySelector('#z-alle-pdf')?.addEventListener('click', (ev) => mitSperre(ev.currentTarget,
    () => honorarnotenPdfHerunterladen(noten, `Praemienabrechnungen_${bezahlt ? 'bezahlt' : 'offen'}_${heuteIso()}.pdf`).catch(pdfFehler)));

  const nachSchluessel = new Map(wochen.map((g) => [g.woche.schluessel, g]));
  inhalt.addEventListener('click', (ev) => {
    const knopf = ev.target.closest('button');
    const karte = knopf?.closest('.woche');
    const g = karte && nachSchluessel.get(karte.dataset.woche);
    if (!g) return;

    if ('pdf' in knopf.dataset) {
      mitSperre(knopf, () => honorarnotenPdfHerunterladen(g.noten, pdfName(g.woche)).catch(pdfFehler));
    } else if ('mailen' in knopf.dataset) {
      mitSperre(knopf, () => pdfMailen(store, g.noten, pdfName(g.woche), `Prämienabrechnungen ${wocheText(g.woche)}`)
        .catch((e) => meldung(fehlerText(e), 'fehler')));
    } else if ('sepa' in knopf.dataset) {
      sepaDatei(konto, g, ctx).catch((e) => meldung(`SEPA-Datei: ${fehlerText(e)}`, 'fehler'));
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
    <h1>Buchhaltung</h1>
    <nav class="reiter" aria-label="Ansicht">
      <a href="#/zahlung"${tab === 'offen' ? ' aria-current="page"' : ''}>Offen</a>
      <a href="#/zahlung/bezahlt"${tab === 'bezahlt' ? ' aria-current="page"' : ''}>Bezahlt</a>
    </nav>
    <div id="z-inhalt"></div>`;
  await anzeigen(el.querySelector('#z-inhalt'), ctx, tab === 'bezahlt');
}
