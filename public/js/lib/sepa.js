// SEPA-Sammelüberweisung als Datei im Format pain.001 (ISO 20022),
// zum Hochladen ins Online-Banking (z. B. George, ELBA, Business-Banking).
//
// Unterstützt:
//   'pain.001.001.03' – älteres Format, das die meisten Banken seit Jahren annehmen
//   'pain.001.001.09' – neueres Format (SEPA-Regelwerk ab 2023)
import { normalizeIban, normalizeBic, ibanFehler, bicIstGueltig } from './iban.js';

export const SEPA_FORMATE = {
  'pain.001.001.03': 'pain.001.001.03 (Standard)',
  'pain.001.001.09': 'pain.001.001.09 (neuer)',
};

const UMSCHREIBEN = { Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', ẞ: 'SS', '&': '+', '€': 'EUR' };

/**
 * Text auf den SEPA-Zeichensatz beschränken:
 * a–z A–Z 0–9 / - ? : ( ) . , ' + und Leerzeichen. Umlaute werden umgeschrieben.
 */
export function sepaText(text, max) {
  const s = String(text ?? '')
    .replace(/[ÄÖÜäöüßẞ&€]/g, (c) => UMSCHREIBEN[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛´`]/g, "'")
    .replace(/[“”„"„“]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return max ? s.slice(0, max).trim() : s;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cent = (b) => Math.round(Number(b) * 100);
const betragText = (c) => (c / 100).toFixed(2);

/** Prüft die Eingaben und liefert eine Liste von Fehlermeldungen (leer = alles in Ordnung). */
export function sepaPruefen({ auftraggeber, zahlungen, ausfuehrung }) {
  const f = [];
  if (!sepaText(auftraggeber?.name)) f.push('Name des Auftraggeberkontos fehlt.');
  if (ibanFehler(auftraggeber?.iban)) f.push(`IBAN des Auftraggeberkontos: ${ibanFehler(auftraggeber?.iban)}`);
  if (!bicIstGueltig(auftraggeber?.bic ?? '')) f.push('BIC des Auftraggeberkontos ist ungültig.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ausfuehrung ?? '')) f.push('Ausführungsdatum fehlt.');
  if (!zahlungen?.length) f.push('Keine Zahlungen ausgewählt.');
  for (const z of zahlungen ?? []) {
    if (ibanFehler(z.iban)) f.push(`${z.referenz}: IBAN ungültig.`);
    if (!bicIstGueltig(z.bic ?? '')) f.push(`${z.referenz}: BIC ungültig.`);
    if (!sepaText(z.name)) f.push(`${z.referenz}: Empfängername fehlt.`);
    const c = cent(z.betrag);
    if (!(c >= 1 && c <= 99999999999)) f.push(`${z.referenz}: Betrag ungültig.`);
  }
  return f;
}

/**
 * Erzeugt die pain.001-Datei.
 * @param {object} p
 * @param {{name, iban, bic}} p.auftraggeber  Konto, von dem überwiesen wird
 * @param {{referenz, name, iban, bic, betrag, zweck}[]} p.zahlungen
 * @param {string} p.ausfuehrung  gewünschtes Ausführungsdatum JJJJ-MM-TT
 * @param {string} [p.format]     'pain.001.001.03' oder 'pain.001.001.09'
 * @param {Date}   [p.jetzt]
 * @param {string} [p.nachrichtId] eindeutige Kennung der Datei (max. 35 Zeichen)
 */
export function sepaXml({ auftraggeber, zahlungen, ausfuehrung, format = 'pain.001.001.03', jetzt = new Date(), nachrichtId }) {
  if (!SEPA_FORMATE[format]) throw new Error(`Unbekanntes SEPA-Format: ${format}`);
  const fehler = sepaPruefen({ auftraggeber, zahlungen, ausfuehrung });
  if (fehler.length) throw new Error(fehler.join('\n'));

  const neu = format === 'pain.001.001.09';
  const bicTag = neu ? 'BICFI' : 'BIC';
  const datum = neu ? `<ReqdExctnDt><Dt>${ausfuehrung}</Dt></ReqdExctnDt>` : `<ReqdExctnDt>${ausfuehrung}</ReqdExctnDt>`;
  const erstellt = jetzt.toISOString().slice(0, 19);
  const msgId = sepaText(nachrichtId ?? `PRAEMIEN-${erstellt.replace(/\D/g, '')}`, 35).replace(/ /g, '-');
  const summe = zahlungen.reduce((s, z) => s + cent(z.betrag), 0);
  const name = xml(sepaText(auftraggeber.name, 70));
  const dbtrBic = normalizeBic(auftraggeber.bic);
  const dbtrAgt = dbtrBic
    ? `<DbtrAgt><FinInstnId><${bicTag}>${dbtrBic}</${bicTag}></FinInstnId></DbtrAgt>`
    : '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>';

  const buchungen = zahlungen.map((z) => {
    const bic = normalizeBic(z.bic);
    return `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xml(sepaText(z.referenz, 35) || 'NOTPROVIDED')}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${betragText(cent(z.betrag))}</InstdAmt></Amt>${bic ? `
        <CdtrAgt><FinInstnId><${bicTag}>${bic}</${bicTag}></FinInstnId></CdtrAgt>` : ''}
        <Cdtr><Nm>${xml(sepaText(z.name, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${normalizeIban(z.iban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xml(sepaText(z.zweck, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:${format}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xml(msgId)}</MsgId>
      <CreDtTm>${erstellt}</CreDtTm>
      <NbOfTxs>${zahlungen.length}</NbOfTxs>
      <CtrlSum>${betragText(summe)}</CtrlSum>
      <InitgPty><Nm>${name}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xml(msgId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${zahlungen.length}</NbOfTxs>
      <CtrlSum>${betragText(summe)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      ${datum}
      <Dbtr><Nm>${name}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${normalizeIban(auftraggeber.iban)}</IBAN></Id></DbtrAcct>
      ${dbtrAgt}
      <ChrgBr>SLEV</ChrgBr>${buchungen}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
