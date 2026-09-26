// Erzeugt die Honorarnote als Word-Datei aus der offiziellen Vorlage
// (public/vorlage/honorarnote-vorlage.docx). Die Vorlage wird nicht verändert,
// nur ihre Beispielwerte werden ersetzt und die Tabellenzeilen befüllt.
import { formatBetragDokument, formatDatum, summe } from './format.js';
import { formatIban } from './iban.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const VORLAGE_URL = new URL('../../vorlage/honorarnote-vorlage.docx', import.meta.url).href;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Beispielwerte in der Vorlage -> werden ersetzt
const BEISPIEL = {
  name: 'Maria Musterfrau',
  strasse: 'Musterstraße 1/2',
  plzOrt: '1010 Wien',
  iban: 'AT00 0000 0000 0000 0000',
  ortDatum: 'Wien, 17.07.2026',
  nummer: 'MUSTERFRAU-MA-2026-01',
  empfName: 'campus a Medien GmbH',
  empfStrasse: 'Stiftgasse 6/1/2',
  empfPlzOrt: '1070 Wien',
  empfUid: 'ATU81242718',
};

// Hinweis-Absätze der Vorlage, die in der fertigen Honorarnote nichts verloren haben
const HINWEISE = ['Bitte nur die grauen Felder', 'Nummer der Honorarnote:', 'Nur ausfüllen, wenn'];

const kinder = (el, name) => Array.from(el.childNodes).filter((n) => n.namespaceURI === W && n.localName === name);
const alle = (el, name) => Array.from(el.getElementsByTagNameNS(W, name));
const text = (el) => alle(el, 't').map((t) => t.textContent).join('');

/** Ort aus "1010 Wien" -> "Wien" */
export function ortAusPlzOrt(plzOrt) {
  return String(plzOrt ?? '').replace(/^\s*[A-Z]{0,2}-?\d{4,5}\s*/i, '').trim() || 'Wien';
}

/** Setzt den Text einer Tabellenzelle; übernimmt die Schrift der Vorlage ohne grau/kursiv. */
function zelleSetzen(tc, wert, { fett = false } = {}) {
  const doc = tc.ownerDocument;
  const p = kinder(tc, 'p')[0];
  const alterLauf = alle(p, 'r')[0];
  let rPr = alterLauf && kinder(alterLauf, 'rPr')[0]?.cloneNode(true);
  if (!rPr) {
    rPr = doc.createElementNS(W, 'w:rPr');
    for (const n of ['sz', 'szCs']) {
      const e = doc.createElementNS(W, `w:${n}`);
      e.setAttributeNS(W, 'w:val', '18');
      rPr.append(e);
    }
  }
  // Platzhalter-Formatierung (kursiv, grau) entfernen
  for (const n of ['i', 'iCs', 'color']) kinder(rPr, n).forEach((e) => e.remove());
  if (fett && !kinder(rPr, 'b').length) {
    const nachFonts = kinder(rPr, 'rFonts')[0]?.nextSibling ?? rPr.firstChild;
    const b = doc.createElementNS(W, 'w:b');
    const bCs = doc.createElementNS(W, 'w:bCs');
    rPr.insertBefore(bCs, nachFonts);
    rPr.insertBefore(b, bCs);
  }
  // alle bisherigen Inhalte des Absatzes außer den Absatzeigenschaften entfernen
  Array.from(p.childNodes).forEach((n) => { if (!(n.namespaceURI === W && n.localName === 'pPr')) n.remove(); });
  const r = doc.createElementNS(W, 'w:r');
  r.append(rPr);
  const t = doc.createElementNS(W, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.textContent = wert ?? '';
  r.append(t);
  p.append(r);
  // weitere Absätze in der Zelle entfernen
  kinder(tc, 'p').slice(1).forEach((x) => x.remove());
}

/** Word-IDs von geklonten Zeilen entfernen (müssen eindeutig sein) */
function idsEntfernen(el) {
  for (const e of [el, ...el.getElementsByTagName('*')]) {
    e.removeAttributeNS(W14, 'paraId');
    e.removeAttributeNS(W14, 'textId');
  }
}

function positionsTabelle(tbl, positionen, spalten) {
  const zeilen = kinder(tbl, 'tr');
  const beispiel = zeilen[1];
  const summenZeile = zeilen[zeilen.length - 1];
  const liste = positionen.length ? positionen : [null];
  for (const pos of liste) {
    const tr = beispiel.cloneNode(true);
    idsEntfernen(tr);
    kinder(tr, 'tc').forEach((tc, i) => zelleSetzen(tc, pos ? spalten[i](pos) : ''));
    tbl.insertBefore(tr, summenZeile);
  }
  zeilen.slice(1, -1).forEach((z) => z.remove());
  const zellen = kinder(summenZeile, 'tc');
  zelleSetzen(zellen[zellen.length - 1], formatBetragDokument(summe(positionen)), { fett: true });
}

/**
 * Befüllt document.xml der Vorlage.
 * @param {string} xml   Inhalt von word/document.xml
 * @param {object} note  Honorarnote (mit autor, zahlung, empfaenger, positionen)
 * @param {{DOMParser, XMLSerializer}} dom
 */
function dokumentBefuellen(xml, note, dom = globalThis) {
  const doc = new dom.DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Vorlage konnte nicht gelesen werden.');
  const body = alle(doc, 'body')[0];

  for (const p of kinder(body, 'p')) {
    const t = text(p).trim();
    // Text entfernen, leeren Absatz als Abstand behalten
    if (HINWEISE.some((h) => t.startsWith(h))) {
      Array.from(p.childNodes).forEach((n) => { if (!(n.namespaceURI === W && n.localName === 'pPr')) n.remove(); });
    }
  }

  const a = note.autor;
  const e = note.empfaenger ?? {};
  const werte = {
    [BEISPIEL.name]: `${a.vorname} ${a.nachname}`,
    [BEISPIEL.strasse]: a.strasse,
    [BEISPIEL.plzOrt]: a.plz_ort,
    [BEISPIEL.iban]: formatIban(note.zahlung.iban),
    [BEISPIEL.ortDatum]: `${ortAusPlzOrt(a.plz_ort)}, ${formatDatum(note.eingereicht_am)}`,
    [BEISPIEL.nummer]: note.nummer,
    [BEISPIEL.empfName]: e.name ?? BEISPIEL.empfName,
    [BEISPIEL.empfStrasse]: e.strasse ?? BEISPIEL.empfStrasse,
    [BEISPIEL.empfPlzOrt]: e.plz_ort ?? BEISPIEL.empfPlzOrt,
    [BEISPIEL.empfUid]: e.uid ?? BEISPIEL.empfUid,
  };
  // erst sammeln, dann ersetzen – damit ein neuer Wert nicht erneut ersetzt wird
  const treffer = alle(doc, 'tc').map((tc) => [tc, text(tc).trim()]).filter(([, t]) => t in werte);
  for (const [tc, t] of treffer) zelleSetzen(tc, werte[t]);

  const tabellen = kinder(body, 'tbl');
  const kolumnen = note.positionen.filter((p) => p.kategorie === 'kolumne');
  const ausserord = note.positionen.filter((p) => p.kategorie === 'ausserordentlich');
  for (const tbl of tabellen) {
    const kopf = text(kinder(tbl, 'tr')[0] ?? tbl);
    if (kopf.includes('Titel des Beitrags') && kopf.includes('Vereinbart mit')) {
      positionsTabelle(tbl, ausserord, [
        (p) => p.titel, (p) => formatDatum(p.veroeffentlichung), (p) => p.vereinbart_mit ?? '',
        (p) => formatBetragDokument(p.betrag)]);
    } else if (kopf.includes('Titel des Beitrags')) {
      positionsTabelle(tbl, kolumnen, [
        (p) => p.titel, (p) => formatDatum(p.veroeffentlichung), (p) => formatBetragDokument(p.betrag)]);
    } else if (text(tbl).trim().startsWith('Gesamtbetrag')) {
      const zellen = alle(tbl, 'tc');
      zelleSetzen(zellen[zellen.length - 1], formatBetragDokument(summe(note.positionen)), { fett: true });
    }
  }

  return new dom.XMLSerializer().serializeToString(doc);
}

/** Lädt die Vorlage, befüllt sie und liefert die fertige .docx als Blob. */
export async function honorarnoteDocx(note, { JSZip, vorlage }) {
  const daten = vorlage ?? await (await fetch(VORLAGE_URL)).arrayBuffer();
  const zip = await JSZip.loadAsync(daten);
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', dokumentBefuellen(xml, note));
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
}

export function docxDateiname(note) {
  return `Honorarnote_${note.nummer}.docx`;
}
