// Bezahl-Terminal (Buchhaltung). Beim Markieren als bezahlt wird die Honorarnote
// automatisch aus der Word-Vorlage erzeugt und heruntergeladen.
import {
  esc, formatBetragPlain, formatDatum, formatEuro, formatMonat, heuteIso, verwendungszweck, vollerName,
} from '../lib/format.js';
import { formatIban, normalizeIban } from '../lib/iban.js';
import { epcPayload, utf8BinaryString } from '../lib/epc.js';
import { toCsv, downloadText } from '../lib/csv.js';
import { honorarnoteHerunterladen, honorarnotenAlsZip } from '../lib/beleg.js';
import { fehlerText, kopierenMitFeedback, meldung, mitSperre } from '../lib/ui.js';
import { positionenTabelle } from './noten.js';

const QR_MODUL = '../../vendor/qrcode-generator.mjs';
let gewaehlterMonat = heuteIso().slice(0, 7);

/** Alle Zahlungsdaten einer Note als Kopierwerte */
function zahlungsdaten(n) {
  return {
    empfaenger: n.zahlung.kontoinhaber,
    iban: normalizeIban(n.zahlung.iban),
    bic: n.zahlung.bic ?? '',
    betrag: formatBetragPlain(n.betrag),
    zweck: verwendungszweck(n.nummer, `${vollerName(n.autor)} ${formatMonat(n.monat)}`),
  };
}

export function textblock(n) {
  const d = zahlungsdaten(n);
  return [
    `Empfänger: ${d.empfaenger}`,
    `IBAN: ${formatIban(d.iban)}`,
    `BIC: ${d.bic || '–'}`,
    `Betrag: ${d.betrag} EUR`,
    `Verwendungszweck: ${d.zweck}`,
  ].join('\n');
}

function kopierzeile(label, anzeige, wert, schluessel) {
  return `
    <div class="kopierzeile">
      <span class="kopier-label">${esc(label)}</span>
      <span class="kopier-wert${schluessel === 'iban' ? ' mono' : ''}">${esc(anzeige || '–')}</span>
      ${wert ? `<button type="button" class="btn btn-klein" data-kopieren="${schluessel}"
                  aria-label="${esc(label)} kopieren">Kopieren</button>` : '<span></span>'}
    </div>`;
}

async function qrZeichnen(box, n) {
  try {
    const { default: qrcode } = await import(QR_MODUL);
    const d = zahlungsdaten(n);
    const qr = qrcode(0, 'M');
    qr.addData(utf8BinaryString(epcPayload({ name: d.empfaenger, iban: d.iban, bic: d.bic, betrag: n.betrag, zweck: d.zweck })), 'Byte');
    qr.make();
    const img = new Image();
    img.src = qr.createDataURL(6, 4);
    img.alt = `GiroCode für ${n.nummer}`;
    const p = document.createElement('p');
    p.className = 'klein';
    p.textContent = 'Mit der Banking-App scannen („Zahlen mit Code“ / GiroCode). Daten vor dem Freigeben prüfen.';
    box.replaceChildren(img, p);
  } catch (e) {
    console.error(e);
    box.textContent = 'QR-Code konnte nicht erstellt werden.';
  }
}

async function offen(inhalt, { store, neuLaden, istAktuell }) {
  const daten = await store.offeneZahlungen();
  if (!istAktuell()) return;
  const summe = daten.reduce((s, n) => s + n.betrag, 0);
  inhalt.innerHTML = daten.length
    ? `<p class="treffer">${daten.length} offene ${daten.length === 1 ? 'Zahlung' : 'Zahlungen'} · Summe ${esc(formatEuro(summe))}</p>
       <ul class="liste">${daten.map((n) => {
         const d = zahlungsdaten(n);
         return `
         <li class="karte zahl-karte" data-id="${esc(n.id)}">
           <div class="note-kopf">
             <span class="nummer">${esc(n.nummer)}</span>
             <span class="klein">angenommen am ${esc(formatDatum(n.entschieden_am?.slice(0, 10)))}</span>
           </div>
           <h2>${esc(vollerName(n.autor))} · ${esc(formatMonat(n.monat))}</h2>
           <div class="kopierblock">
             ${kopierzeile('Empfänger', d.empfaenger, d.empfaenger, 'empfaenger')}
             ${kopierzeile('IBAN', formatIban(d.iban), d.iban, 'iban')}
             ${kopierzeile('BIC', d.bic, d.bic, 'bic')}
             ${kopierzeile('Betrag', formatEuro(n.betrag), d.betrag, 'betrag')}
             ${kopierzeile('Verwendungszweck', d.zweck, d.zweck, 'zweck')}
           </div>
           <div class="aktionen">
             <button type="button" class="btn btn-primaer" data-alles>Alles kopieren</button>
             <button type="button" class="btn" data-qr aria-expanded="false">QR-Code (GiroCode)</button>
           </div>
           <div class="qr" hidden></div>
           <details class="aufklapp"><summary>Leistungen und Adresse</summary>
             ${positionenTabelle(n)}
             <p class="klein">Adresse: ${esc(n.autor.strasse)}, ${esc(n.autor.plz_ort)}</p>
           </details>
           <form class="bezahlt-form" novalidate>
             <label>Bezahlt am
               <input type="date" name="datum" value="${heuteIso()}" max="${heuteIso()}" required>
             </label>
             <button type="submit" class="btn btn-erfolg">Als bezahlt markieren</button>
           </form>
         </li>`;
       }).join('')}</ul>`
    : '<section class="karte"><p>Keine offenen Zahlungen. 🎉</p></section>';

  const nachId = new Map(daten.map((n) => [n.id, n]));

  inhalt.addEventListener('click', async (ev) => {
    const karte = ev.target.closest('.zahl-karte');
    const knopf = ev.target.closest('button');
    if (!karte || !knopf || knopf.type === 'submit') return;
    const n = nachId.get(karte.dataset.id);
    if (knopf.dataset.kopieren) {
      kopierenMitFeedback(knopf, zahlungsdaten(n)[knopf.dataset.kopieren]);
    } else if ('alles' in knopf.dataset) {
      kopierenMitFeedback(knopf, textblock(n));
    } else if ('qr' in knopf.dataset) {
      const box = karte.querySelector('.qr');
      const zeigen = box.hidden;
      box.hidden = !zeigen;
      knopf.setAttribute('aria-expanded', String(zeigen));
      if (zeigen && !box.firstChild) await qrZeichnen(box, n);
    }
  });

  inhalt.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const n = nachId.get(form.closest('.zahl-karte').dataset.id);
    const datum = form.datum.value;
    if (!confirm(`${n.nummer} (${formatEuro(n.betrag)}) als am ${formatDatum(datum)} bezahlt markieren?\n\n`
      + 'Die Honorarnote wird dabei automatisch als Word-Datei erstellt.')) return;
    await mitSperre(form.querySelector('button'), async () => {
      let bezahlt;
      try {
        bezahlt = await store.alsBezahltMarkieren(n.id, datum);
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
        return;
      }
      try {
        await honorarnoteHerunterladen(bezahlt);
        meldung(`${n.nummer} ist bezahlt – Honorarnote wurde erstellt.`, 'erfolg');
      } catch (e) {
        console.error(e);
        meldung(`${n.nummer} ist bezahlt, aber die Honorarnote konnte nicht erstellt werden. Im Reiter „Bezahlt“ erneut versuchen.`, 'fehler');
      }
      neuLaden();
    });
  });
}

async function bezahlt(inhalt, { store }) {
  inhalt.innerHTML = `
    <section class="karte filterleiste filter-zwei">
      <div class="feld">
        <label for="z-monat">Monat der Zahlung</label>
        <input type="month" id="z-monat" value="${esc(gewaehlterMonat)}" max="${heuteIso().slice(0, 7)}">
      </div>
      <div class="feld feld-knopf">
        <button type="button" class="btn btn-primaer" id="z-csv">CSV exportieren</button>
        <button type="button" class="btn" id="z-zip">Alle Honorarnoten (ZIP)</button>
      </div>
    </section>
    <div id="z-liste"></div>`;

  let daten = [];
  const monatInput = inhalt.querySelector('#z-monat');

  async function zeichnen() {
    const monat = gewaehlterMonat;
    let geladen;
    try {
      geladen = await store.bezahlteNoten(monat);
    } catch (e) {
      inhalt.querySelector('#z-liste').innerHTML = `<p class="fehlerbox">${esc(fehlerText(e))}</p>`;
      return;
    }
    if (monat !== gewaehlterMonat) return; // inzwischen anderer Monat gewählt
    daten = geladen;
    inhalt.querySelector('#z-csv').disabled = !daten.length;
    inhalt.querySelector('#z-zip').disabled = !daten.length;
    const summe = daten.reduce((s, n) => s + n.betrag, 0);
    inhalt.querySelector('#z-liste').innerHTML = daten.length
      ? `<p class="treffer">${daten.length} ${daten.length === 1 ? 'Zahlung' : 'Zahlungen'} · Summe ${esc(formatEuro(summe))}</p>
         <table class="tabelle">
           <thead><tr><th>Nummer</th><th>Bezahlt am</th><th>Empfänger</th><th class="rechts">Betrag</th><th>Honorarnote</th></tr></thead>
           <tbody>${daten.map((n) => `
             <tr data-id="${esc(n.id)}">
               <td data-label="Nummer" class="nummer">${esc(n.nummer)}</td>
               <td data-label="Bezahlt am">${esc(formatDatum(n.bezahlt_am))}</td>
               <td data-label="Empfänger">${esc(n.zahlung.kontoinhaber)}</td>
               <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
               <td data-label="Honorarnote"><button type="button" class="btn btn-klein" data-word>Word herunterladen</button></td>
             </tr>`).join('')}</tbody>
         </table>`
      : `<section class="karte"><p>Im ${esc(formatMonat(gewaehlterMonat))} wurde nichts bezahlt.</p></section>`;
  }

  monatInput.addEventListener('change', () => {
    if (!monatInput.value) return;
    gewaehlterMonat = monatInput.value;
    zeichnen();
  });

  inhalt.querySelector('#z-liste').addEventListener('click', (ev) => {
    const knopf = ev.target.closest('[data-word]');
    if (!knopf) return;
    const n = daten.find((x) => x.id === knopf.closest('tr').dataset.id);
    mitSperre(knopf, () => honorarnoteHerunterladen(n).catch((e) => meldung(fehlerText(e), 'fehler')));
  });

  inhalt.querySelector('#z-csv').addEventListener('click', () => {
    const csv = toCsv(
      ['Nummer', 'Bezahlt am', 'Empfänger', 'IBAN', 'BIC', 'Betrag (EUR)', 'Verwendungszweck',
        'Autor:in', 'Adresse', 'Abrechnungsmonat', 'Anzahl Leistungen'],
      daten.map((n) => {
        const d = zahlungsdaten(n);
        return [n.nummer, formatDatum(n.bezahlt_am), d.empfaenger, d.iban, d.bic, d.betrag, d.zweck,
          vollerName(n.autor), `${n.autor.strasse}, ${n.autor.plz_ort}`, formatMonat(n.monat), n.positionen.length];
      }),
    );
    downloadText(`honorare-bezahlt-${gewaehlterMonat}.csv`, csv);
  });

  inhalt.querySelector('#z-zip').addEventListener('click', (ev) => mitSperre(ev.currentTarget, () =>
    honorarnotenAlsZip(daten, `honorarnoten-${gewaehlterMonat}.zip`).catch((e) => meldung(fehlerText(e), 'fehler'))));

  await zeichnen();
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
  const inhalt = el.querySelector('#z-inhalt');
  if (tab === 'offen') await offen(inhalt, ctx);
  else await bezahlt(inhalt, ctx);
}
