// Seite 3: Bezahl-Terminal (Buchhaltung)
import { PDF_BUCKET } from '../supabase.js';
import {
  ART_LABEL, esc, formatBetragPlain, formatDatum, formatEuro, heuteIso, verwendungszweck, vollerName,
} from '../lib/format.js';
import { formatIban, normalizeIban } from '../lib/iban.js';
import { epcPayload, utf8BinaryString } from '../lib/epc.js';
import { toCsv, downloadText } from '../lib/csv.js';
import { fehlerText, kopierenMitFeedback, meldung, mitSperre } from '../lib/ui.js';

const QR_MODUL = '../../vendor/qrcode-generator.mjs';
let gewaehlterMonat = heuteIso().slice(0, 7);

const SPALTEN = 'id, nummer, status, vorname, nachname, art, titel, betrag, leistungsdatum, entschieden_am, bezahlt_am, pdf_path, '
  + 'zahlung:honorarnoten_zahlung(adresse, kontoinhaber, iban, bic)';

const zahlungVon = (n) => (Array.isArray(n.zahlung) ? n.zahlung[0] : n.zahlung) ?? {};

/** Alle Zahlungsdaten einer Note, jeweils als Anzeige- und Kopierwert */
function zahlungsdaten(n) {
  const z = zahlungVon(n);
  return {
    empfaenger: z.kontoinhaber ?? '',
    iban: normalizeIban(z.iban),
    bic: z.bic ?? '',
    betrag: formatBetragPlain(n.betrag),
    zweck: verwendungszweck(n.nummer, n.titel),
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

function zeileMitKopieren(label, anzeige, wert, schluessel) {
  return `
    <div class="kopierzeile">
      <span class="kopier-label">${esc(label)}</span>
      <span class="kopier-wert${schluessel === 'iban' ? ' mono' : ''}">${esc(anzeige || '–')}</span>
      ${wert ? `<button type="button" class="btn btn-klein" data-kopieren="${schluessel}"
                  aria-label="${esc(label)} kopieren">Kopieren</button>` : '<span></span>'}
    </div>`;
}

async function offen(el, { supabase, istAktuell }) {
  const { data, error } = await supabase.from('honorarnoten').select(SPALTEN)
    .eq('status', 'angenommen').order('entschieden_am', { ascending: true });
  if (error) throw error;
  if (!istAktuell()) return;

  const summe = data.reduce((s, n) => s + Number(n.betrag), 0);
  const liste = el.querySelector('#z-inhalt');
  liste.innerHTML = data.length
    ? `<p class="treffer">${data.length} offene ${data.length === 1 ? 'Zahlung' : 'Zahlungen'} · Summe ${esc(formatEuro(summe))}</p>
       <ul class="liste">${data.map((n) => {
         const d = zahlungsdaten(n);
         const z = zahlungVon(n);
         return `
         <li class="karte zahl-karte" data-id="${esc(n.id)}">
           <div class="note-kopf">
             <span class="nummer">${esc(n.nummer)}</span>
             <span class="klein">angenommen am ${esc(formatDatum(n.entschieden_am))}</span>
           </div>
           <h2>${esc(n.titel)}</h2>
           <p class="meta">${esc(vollerName(n))} · ${esc(ART_LABEL[n.art])} · Leistung am ${esc(formatDatum(n.leistungsdatum))}</p>
           <div class="kopierblock">
             ${zeileMitKopieren('Empfänger', d.empfaenger, d.empfaenger, 'empfaenger')}
             ${zeileMitKopieren('IBAN', formatIban(d.iban), d.iban, 'iban')}
             ${zeileMitKopieren('BIC', d.bic, d.bic, 'bic')}
             ${zeileMitKopieren('Betrag', formatEuro(n.betrag), d.betrag, 'betrag')}
             ${zeileMitKopieren('Verwendungszweck', d.zweck, d.zweck, 'zweck')}
           </div>
           <div class="aktionen">
             <button type="button" class="btn btn-primaer" data-alles>Alles kopieren</button>
             <button type="button" class="btn" data-qr aria-expanded="false">QR-Code (GiroCode)</button>
             ${n.pdf_path ? '<button type="button" class="btn" data-pdf>PDF</button>' : ''}
           </div>
           <div class="qr" hidden></div>
           <details class="aufklapp"><summary>Adresse</summary><p class="notiz">${esc(z.adresse ?? '')}</p></details>
           <form class="bezahlt-form" novalidate>
             <label>Bezahlt am
               <input type="date" name="datum" value="${heuteIso()}" max="${heuteIso()}" required>
             </label>
             <button type="submit" class="btn btn-erfolg">Als bezahlt markieren</button>
           </form>
         </li>`;
       }).join('')}</ul>`
    : '<section class="karte"><p>Keine offenen Zahlungen. 🎉</p></section>';

  const nachId = new Map(data.map((n) => [n.id, n]));

  liste.addEventListener('click', async (ev) => {
    const karte = ev.target.closest('.zahl-karte');
    if (!karte) return;
    const n = nachId.get(karte.dataset.id);
    const knopf = ev.target.closest('button');
    if (!knopf || knopf.type === 'submit') return;

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
    } else if ('pdf' in knopf.dataset) {
      // Fenster sofort öffnen (sonst blockiert der Popup-Blocker), URL danach setzen
      const fenster = window.open('', '_blank');
      const { data: s, error: e } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(n.pdf_path, 300);
      if (e || !s) {
        fenster?.close();
        meldung('PDF konnte nicht geladen werden.', 'fehler');
      } else if (fenster) {
        fenster.opener = null;
        fenster.location = s.signedUrl;
      } else {
        location.href = s.signedUrl;
      }
    }
  });

  liste.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const karte = form.closest('.zahl-karte');
    const n = nachId.get(karte.dataset.id);
    const datum = form.datum.value;
    if (!datum) {
      meldung('Bitte das Zahlungsdatum angeben.', 'fehler');
      return;
    }
    if (!confirm(`${n.nummer} (${formatEuro(n.betrag)}) als am ${formatDatum(datum)} bezahlt markieren?`)) return;
    await mitSperre(form.querySelector('button'), async () => {
      const { error: e } = await supabase.rpc('honorarnote_bezahlt', { p_id: n.id, p_datum: datum });
      if (e) {
        meldung(fehlerText(e), 'fehler');
        return;
      }
      meldung(`${n.nummer} ist als bezahlt markiert.`, 'erfolg');
      karte.remove();
      nachId.delete(n.id);
      if (!nachId.size) liste.innerHTML = '<section class="karte"><p>Keine offenen Zahlungen. 🎉</p></section>';
      else {
        const rest = [...nachId.values()];
        liste.querySelector('.treffer').textContent = `${rest.length} offene ${rest.length === 1 ? 'Zahlung' : 'Zahlungen'} · Summe `
          + formatEuro(rest.reduce((s, x) => s + Number(x.betrag), 0));
      }
    });
  });
}

async function qrZeichnen(box, n) {
  try {
    const { default: qrcode } = await import(QR_MODUL);
    const d = zahlungsdaten(n);
    const qr = qrcode(0, 'M');
    qr.addData(utf8BinaryString(epcPayload({
      name: d.empfaenger, iban: d.iban, bic: d.bic, betrag: n.betrag, zweck: d.zweck,
    })), 'Byte');
    qr.make();
    const img = new Image();
    img.src = qr.createDataURL(6, 4);
    img.alt = `GiroCode für ${n.nummer}`;
    box.append(img);
    const p = document.createElement('p');
    p.className = 'klein';
    p.textContent = 'Mit der Banking-App scannen („Zahlen mit Code“ / GiroCode). Daten vor dem Freigeben prüfen.';
    box.append(p);
  } catch (e) {
    console.error(e);
    box.textContent = 'QR-Code konnte nicht erstellt werden.';
  }
}

async function bezahlt(el, { supabase, istAktuell }) {
  const inhalt = el.querySelector('#z-inhalt');
  inhalt.innerHTML = `
    <section class="karte filterleiste">
      <div class="feld">
        <label for="z-monat">Monat</label>
        <input type="month" id="z-monat" value="${esc(gewaehlterMonat)}" max="${heuteIso().slice(0, 7)}">
      </div>
      <div class="feld feld-knopf">
        <button type="button" class="btn btn-primaer" id="z-csv" disabled>CSV exportieren</button>
      </div>
    </section>
    <div id="z-liste"><p class="laden">Wird geladen …</p></div>`;

  const monatInput = inhalt.querySelector('#z-monat');
  const csvKnopf = inhalt.querySelector('#z-csv');
  let daten = [];

  async function laden() {
    const [j, m] = gewaehlterMonat.split('-').map(Number);
    const von = `${gewaehlterMonat}-01`;
    const bis = m === 12 ? `${j + 1}-01-01` : `${j}-${String(m + 1).padStart(2, '0')}-01`;
    const box = inhalt.querySelector('#z-liste');
    const { data, error } = await supabase.from('honorarnoten').select(SPALTEN)
      .eq('status', 'bezahlt').gte('bezahlt_am', von).lt('bezahlt_am', bis)
      .order('bezahlt_am').order('nummer');
    if (!istAktuell()) return;
    if (error) {
      box.innerHTML = `<p class="fehlerbox">${esc(fehlerText(error))}</p>`;
      return;
    }
    daten = data;
    csvKnopf.disabled = !data.length;
    const summe = data.reduce((s, n) => s + Number(n.betrag), 0);
    box.innerHTML = data.length
      ? `<p class="treffer">${data.length} ${data.length === 1 ? 'Zahlung' : 'Zahlungen'} · Summe ${esc(formatEuro(summe))}</p>
         <table class="tabelle">
           <thead><tr><th>Nummer</th><th>Bezahlt am</th><th>Empfänger</th><th>Titel</th><th class="rechts">Betrag</th></tr></thead>
           <tbody>${data.map((n) => `
             <tr>
               <td data-label="Nummer">${esc(n.nummer)}</td>
               <td data-label="Bezahlt am">${esc(formatDatum(n.bezahlt_am))}</td>
               <td data-label="Empfänger">${esc(zahlungVon(n).kontoinhaber ?? '')}</td>
               <td data-label="Titel">${esc(n.titel)}</td>
               <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
             </tr>`).join('')}</tbody>
         </table>`
      : '<section class="karte"><p>In diesem Monat wurde nichts bezahlt.</p></section>';
  }

  monatInput.addEventListener('change', () => {
    if (!monatInput.value) return;
    gewaehlterMonat = monatInput.value;
    laden();
  });

  csvKnopf.addEventListener('click', () => {
    const csv = toCsv(
      ['Nummer', 'Bezahlt am', 'Empfänger', 'IBAN', 'BIC', 'Betrag (EUR)', 'Verwendungszweck',
        'Autor:in', 'Adresse', 'Art', 'Titel', 'Leistungsdatum'],
      daten.map((n) => {
        const d = zahlungsdaten(n);
        return [n.nummer, formatDatum(n.bezahlt_am), d.empfaenger, d.iban, d.bic, d.betrag, d.zweck,
          vollerName(n), (zahlungVon(n).adresse ?? '').replace(/\s*\n\s*/g, ', '), ART_LABEL[n.art],
          n.titel, formatDatum(n.leistungsdatum)];
      }),
    );
    downloadText(`honorare-bezahlt-${gewaehlterMonat}.csv`, csv);
  });

  await laden();
}

export async function render(el, ctx) {
  const tab = ctx.params.tab === 'bezahlt' ? 'bezahlt' : 'offen';
  el.innerHTML = `
    <h1>Bezahl-Terminal</h1>
    <nav class="reiter" aria-label="Ansicht">
      <a href="#/zahlung"${tab === 'offen' ? ' aria-current="page"' : ''}>Offen</a>
      <a href="#/zahlung/bezahlt"${tab === 'bezahlt' ? ' aria-current="page"' : ''}>Bezahlt</a>
    </nav>
    <div id="z-inhalt"><p class="laden">Wird geladen …</p></div>`;
  if (tab === 'offen') await offen(el, ctx);
  else await bezahlt(el, ctx);
}
