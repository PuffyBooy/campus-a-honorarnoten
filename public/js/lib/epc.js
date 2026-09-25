// EPC-QR-Code ("GiroCode", "Zahlen mit Code") nach EPC069-12, Version 002

import { normalizeIban, normalizeBic } from './iban.js';

/**
 * Baut den Text für den EPC-QR-Code.
 * Nicht erlaubte Zeichen (Zeilenumbrüche) werden entfernt, Längen gekürzt.
 */
export function epcPayload({ name, iban, bic, betrag, zweck }) {
  const saeubern = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  const cent = Math.round(Number(betrag) * 100);
  if (!(cent >= 1 && cent <= 99999999999)) throw new Error('Ungültiger Betrag für EPC-QR');
  const betragText = 'EUR' + (cent / 100).toFixed(2);
  return [
    'BCD',            // Service Tag
    '002',            // Version (BIC optional)
    '1',              // Zeichensatz UTF-8
    'SCT',            // SEPA Credit Transfer
    normalizeBic(bic),
    saeubern(name, 70),
    normalizeIban(iban),
    betragText,
    '',               // Purpose-Code
    '',               // strukturierte Referenz
    saeubern(zweck, 140),
  ].join('\n');
}

/** UTF-8-Bytes als "Binär-String" (ein Zeichen = ein Byte) für den QR-Generator */
export function utf8BinaryString(text) {
  return Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('');
}
