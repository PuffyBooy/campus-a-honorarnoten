// Honorarnoten-Generator für externe Auftraggeber (andere Firmen).
// Erzeugt eine allgemeine Honorarnote als Word-Datei – unabhängig von der
// campus-a-Vorlage, aber im gleichen schlichten Stil.
import { formatBetragDokument, formatDatum } from './format.js';
import { formatIban, ibanFehler, bicIstGueltig, normalizeBic } from './iban.js';

export const UST_OPTIONEN = {
  kleinunternehmer: { label: 'Kleinunternehmer:in – umsatzsteuerfrei (§ 6 Abs 1 Z 27 UStG)', satz: 0 },
  ust20: { label: 'mit 20 % Umsatzsteuer', satz: 20 },
  ust13: { label: 'mit 13 % Umsatzsteuer', satz: 13 },
  ust10: { label: 'mit 10 % Umsatzsteuer', satz: 10 },
  ohne: { label: 'ohne Umsatzsteuer-Hinweis', satz: 0 },
};

const HINWEIS_KLEINUNTERNEHMER = 'Der angeführte Rechnungsbetrag ist laut § 6 Abs 1 Z 27 UStG umsatzsteuerfrei (Kleinunternehmerregelung).';

const cent = (b) => Math.round(Number(b) * 100);
const leer = (s) => !String(s ?? '').trim();

/** Beträge in Cent: netto, Umsatzsteuer, gesamt */
export function summen(positionen, ust = 'kleinunternehmer') {
  const netto = positionen.reduce((s, p) => s + cent(p.betrag), 0);
  const satz = UST_OPTIONEN[ust]?.satz ?? 0;
  const steuer = Math.round((netto * satz) / 100);
  return { netto, satz, steuer, gesamt: netto + steuer };
}

/** Liefert Fehlermeldungen je Feld ({feld: text}); leer = alles in Ordnung */
export function pruefen(d) {
  const f = {};
  const a = d.absender ?? {};
  const e = d.empfaenger ?? {};
  if (leer(a.name)) f['absender.name'] = 'Bitte deinen Namen angeben.';
  if (leer(a.strasse)) f['absender.strasse'] = 'Bitte deine Adresse angeben.';
  if (leer(a.plz_ort)) f['absender.plz_ort'] = 'Bitte PLZ und Ort angeben.';
  if (leer(a.kontoinhaber)) f['absender.kontoinhaber'] = 'Bitte Kontoinhaber:in angeben.';
  if (ibanFehler(a.iban)) f['absender.iban'] = ibanFehler(a.iban);
  if (!bicIstGueltig(a.bic ?? '')) f['absender.bic'] = 'Der BIC hat 8 oder 11 Zeichen.';
  if ((UST_OPTIONEN[d.ust]?.satz ?? 0) > 0 && leer(a.uid)) {
    f['absender.uid'] = 'Bei Rechnungen mit Umsatzsteuer ist deine UID-Nummer nötig.';
  }
  if (leer(e.name)) f['empfaenger.name'] = 'Bitte den Namen der Firma angeben.';
  if (leer(e.strasse)) f['empfaenger.strasse'] = 'Bitte die Adresse der Firma angeben.';
  if (leer(e.plz_ort)) f['empfaenger.plz_ort'] = 'Bitte PLZ und Ort der Firma angeben.';
  if (leer(d.nummer)) f.nummer = 'Bitte eine Nummer angeben.';
  if (leer(d.ort)) f.ort = 'Bitte den Ort angeben.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum ?? '')) f.datum = 'Bitte das Datum angeben.';
  if (!UST_OPTIONEN[d.ust]) f.ust = 'Bitte die Umsatzsteuer-Variante wählen.';
  const tage = Number(d.zahlungsziel);
  if (!(Number.isInteger(tage) && tage >= 0 && tage <= 365)) f.zahlungsziel = 'Bitte eine Zahl von 0 bis 365 angeben.';
  if (!d.positionen?.length) f.positionen = 'Bitte mindestens eine Position angeben.';
  (d.positionen ?? []).forEach((p, i) => {
    if (leer(p.beschreibung)) f[`positionen.${i}.beschreibung`] = 'Bitte beschreiben.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.datum ?? '')) f[`positionen.${i}.datum`] = 'Bitte Datum wählen.';
    const c = cent(p.betrag);
    if (!(c > 0 && c <= 10000000)) f[`positionen.${i}.betrag`] = 'Bitte einen Betrag angeben.';
  });
  return f;
}

// ------------------------------------------------------------------ Word (WordprocessingML)

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const GRAU_DUNKEL = 'D9D9D9';
const GRAU_HELL = 'F2F2F2';
const BREITE = 9638; // A4 mit 2 cm Rand, in Twips

function lauf(text, { fett = false, groesse = 20, farbe = null } = {}) {
  const rPr = `${fett ? '<w:b/><w:bCs/>' : ''}${farbe ? `<w:color w:val="${farbe}"/>` : ''}<w:sz w:val="${groesse}"/><w:szCs w:val="${groesse}"/>`;
  // Zeilenumbrüche im Text als <w:br/>
  return String(text ?? '').split('\n').map((zeile, i) =>
    `<w:r><w:rPr>${rPr}</w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(zeile)}</w:t></w:r>`).join('');
}

function absatz(inhalt, { ausrichtung = null, vor = 0, nach = 120, zusammen = false } = {}) {
  return `<w:p><w:pPr>${zusammen ? '<w:keepNext/>' : ''}<w:spacing w:before="${vor}" w:after="${nach}"/>`
    + `${ausrichtung ? `<w:jc w:val="${ausrichtung}"/>` : ''}</w:pPr>${inhalt}</w:p>`;
}

function zelle(text, breite, { fuellung = null, ausrichtung = null, fett = false, spannweite = 1 } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${breite}" w:type="dxa"/>${spannweite > 1 ? `<w:gridSpan w:val="${spannweite}"/>` : ''}`
    + `${fuellung ? `<w:shd w:val="clear" w:color="auto" w:fill="${fuellung}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`
    + `${absatz(lauf(text, { fett, groesse: 18 }), { ausrichtung, nach: 20 })}</w:tc>`;
}

function tabelle(breiten, zeilen) {
  const rand = (seite) => `<w:${seite} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${breiten.reduce((a, b) => a + b, 0)}" w:type="dxa"/>`
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(rand).join('')}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="110" w:type="dxa"/>'
    + '<w:bottom w:w="50" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${breiten.map((b) => `<w:gridCol w:w="${b}"/>`).join('')}</w:tblGrid>`
    + zeilen.map((z) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${z}</w:tr>`).join('')
    + '</w:tbl>';
}

const leerzeile = () => absatz('', { nach: 0 });

/** Inhalt von word/document.xml */
export function dokumentXml(d) {
  const a = d.absender;
  const e = d.empfaenger;
  const s = summen(d.positionen, d.ust);
  const kopfBreiten = [2400, 3619, 3619];

  // Absender und Empfänger nebeneinander (wie in der campus-a-Vorlage)
  const datenZeilen = [
    zelle('', kopfBreiten[0], { fuellung: GRAU_DUNKEL }) + zelle('Von', kopfBreiten[1], { fuellung: GRAU_DUNKEL, fett: true })
      + zelle('An', kopfBreiten[2], { fuellung: GRAU_DUNKEL, fett: true }),
  ];
  const paare = [
    ['Name / Firma', a.name, e.name],
    ['z. H.', '', e.zusatz],
    ['Straße und Hausnummer', a.strasse, e.strasse],
    ['PLZ und Ort', a.plz_ort, e.plz_ort],
    ['UID-Nummer', a.uid, e.uid],
    ['E-Mail', a.email, ''],
  ];
  for (const [label, links, rechts] of paare) {
    if (leer(links) && leer(rechts)) continue;
    datenZeilen.push(zelle(label, kopfBreiten[0], { fett: true }) + zelle(links, kopfBreiten[1]) + zelle(rechts, kopfBreiten[2]));
  }

  const infoBreiten = [2000, 2819, 2000, 2819];
  const infoZeilen = [
    zelle('Ort und Datum', infoBreiten[0], { fett: true, fuellung: GRAU_DUNKEL })
      + zelle(`${d.ort}, ${formatDatum(d.datum)}`, infoBreiten[1])
      + zelle('Honorarnote Nr.', infoBreiten[2], { fett: true, fuellung: GRAU_DUNKEL })
      + zelle(d.nummer, infoBreiten[3]),
  ];
  if (!leer(d.leistungszeitraum)) {
    infoZeilen.push(zelle('Leistungszeitraum', infoBreiten[0], { fett: true, fuellung: GRAU_DUNKEL })
      + zelle(d.leistungszeitraum, infoBreiten[1] + infoBreiten[2] + infoBreiten[3], { spannweite: 3 }));
  }

  const posBreiten = [600, 5238, 1500, 2300];
  const posZeilen = [
    zelle('Nr.', posBreiten[0], { fuellung: GRAU_DUNKEL, fett: true, ausrichtung: 'center' })
      + zelle('Leistung', posBreiten[1], { fuellung: GRAU_DUNKEL, fett: true })
      + zelle('Datum', posBreiten[2], { fuellung: GRAU_DUNKEL, fett: true, ausrichtung: 'center' })
      + zelle('Betrag in Euro', posBreiten[3], { fuellung: GRAU_DUNKEL, fett: true, ausrichtung: 'right' }),
    ...d.positionen.map((p, i) => zelle(String(i + 1), posBreiten[0], { ausrichtung: 'center' })
      + zelle(p.beschreibung, posBreiten[1])
      + zelle(formatDatum(p.datum), posBreiten[2], { ausrichtung: 'center' })
      + zelle(formatBetragDokument(p.betrag), posBreiten[3], { ausrichtung: 'right' })),
  ];
  const summenzeile = (label, betrag, fett = false) => zelle(label, posBreiten[0] + posBreiten[1] + posBreiten[2],
    { spannweite: 3, ausrichtung: 'right', fett, fuellung: fett ? GRAU_HELL : null })
    + zelle(formatBetragDokument(betrag / 100), posBreiten[3], { ausrichtung: 'right', fett, fuellung: fett ? GRAU_HELL : null });
  if (s.satz > 0) {
    posZeilen.push(summenzeile('Summe netto', s.netto));
    posZeilen.push(summenzeile(`zuzüglich ${s.satz} % Umsatzsteuer`, s.steuer));
  }
  posZeilen.push(summenzeile('Gesamtbetrag in Euro', s.gesamt, true));

  const bankBreiten = [2400, 7238];
  const bankZeilen = [
    zelle('Kontoinhaber:in', bankBreiten[0], { fett: true }) + zelle(a.kontoinhaber, bankBreiten[1]),
    zelle('IBAN', bankBreiten[0], { fett: true }) + zelle(formatIban(a.iban), bankBreiten[1]),
  ];
  if (!leer(a.bic)) bankZeilen.push(zelle('BIC', bankBreiten[0], { fett: true }) + zelle(normalizeBic(a.bic), bankBreiten[1]));
  bankZeilen.push(zelle('Verwendungszweck', bankBreiten[0], { fett: true }) + zelle(`Honorarnote ${d.nummer}`, bankBreiten[1]));

  const tage = Number(d.zahlungsziel);
  const zahlung = tage === 0
    ? 'Bitte überweisen Sie den Gesamtbetrag umgehend auf folgendes Konto:'
    : `Bitte überweisen Sie den Gesamtbetrag innerhalb von ${tage} ${tage === 1 ? 'Tag' : 'Tagen'} auf folgendes Konto:`;

  const teile = [
    absatz(lauf('Honorarnote', { fett: true, groesse: 32 }), { nach: 200 }),
    tabelle(kopfBreiten, datenZeilen),
    leerzeile(),
    tabelle(infoBreiten, infoZeilen),
    absatz(lauf('Sehr geehrte Damen und Herren, für folgende Leistungen berechne ich wie vereinbart:'), { vor: 240, nach: 120 }),
    tabelle(posBreiten, posZeilen),
  ];
  if (d.ust === 'kleinunternehmer') teile.push(absatz(lauf(HINWEIS_KLEINUNTERNEHMER), { vor: 200 }));
  teile.push(
    absatz(lauf(zahlung), { vor: 200, zusammen: true }),
    tabelle(bankBreiten, bankZeilen),
  );
  if (!leer(d.anmerkung)) teile.push(absatz(lauf(d.anmerkung), { vor: 200 }));
  teile.push(
    absatz(lauf('Mit freundlichen Grüßen'), { vor: 240, nach: 360, zusammen: true }),
    absatz(lauf(a.name)),
  );

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + teile.join('')
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"'
    + ' w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>'
  + '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>'
  + '<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="de-AT"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  + '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style></w:styles>';

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

/** Erzeugt die Honorarnote als .docx (Blob im Browser, Uint8Array mit typ: 'uint8array') */
export async function externeHonorarnoteDocx(daten, { JSZip, typ = 'blob' }) {
  const fehler = pruefen(daten);
  if (Object.keys(fehler).length) throw new Error(Object.values(fehler)[0]);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/document.xml', dokumentXml(daten));
  return zip.generateAsync({
    type: typ,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

export function dateiname(daten) {
  const teil = (s) => String(s ?? '').replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `Honorarnote_${teil(daten.nummer) || 'extern'}_${teil(daten.empfaenger?.name) || 'Empfaenger'}.docx`;
}
