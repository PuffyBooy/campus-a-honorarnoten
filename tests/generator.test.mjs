// Tests für den Honorarnoten-Generator (externe Auftraggeber)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from '../public/vendor/jszip.mjs';
import { gesamtCent, pruefen, dokumentXml, externeHonorarnoteDocx, dateiname } from '../public/js/lib/externe-honorarnote.js';

const DATEN = {
  absender: { name: 'Maria Musterfrau', strasse: 'Musterstraße 1/2', plz_ort: '1010 Wien', email: 'maria@example.org',
    uid: '', kontoinhaber: 'Maria Musterfrau', iban: 'AT611904300234573201', bic: 'BKAUATWW' },
  empfaenger: { name: 'Stadtmagazin <Wien> & Co GmbH', zusatz: 'Redaktion', strasse: 'Ring 1', plz_ort: '1010 Wien', uid: 'ATU12345678' },
  nummer: 'MUSTERFRAU-MA-2026-E01', ort: 'Wien', datum: '2026-09-26', leistungszeitraum: 'September 2026',
  anmerkung: 'Danke für die Zusammenarbeit!\nZweite Zeile',
  positionen: [
    { beschreibung: 'Reportage „Nachtleben“', datum: '2026-09-10', betrag: 250 },
    { beschreibung: 'Fotos (5 Stück)', datum: '2026-09-12', betrag: 0.1 },
    { beschreibung: 'Korrektur', datum: '2026-09-13', betrag: 0.2 },
  ],
};

test('Gesamtbetrag centgenau', () => {
  assert.equal(gesamtCent(DATEN.positionen), 25030);
  assert.equal(gesamtCent([]), 0);
});

test('Pflichtfelder und Prüfungen', () => {
  assert.deepEqual(pruefen(DATEN), {});
  const f = pruefen({ ...DATEN, empfaenger: {}, positionen: [{ beschreibung: '', datum: '', betrag: 0 }], nummer: '' });
  assert.ok(f['empfaenger.name'] && f.nummer && f['positionen.0.beschreibung'] && f['positionen.0.betrag']);
  assert.ok(pruefen({ ...DATEN, absender: { ...DATEN.absender, iban: 'AT611904300234573202' } })['absender.iban']);
  assert.ok(pruefen({ ...DATEN, positionen: [] }).positionen);
});

test('Word-Inhalt: Daten, Sonderzeichen, Summe, immer steuerfrei, ohne Zahlungsfrist', () => {
  const xml = dokumentXml(DATEN);
  assert.ok(xml.includes('Stadtmagazin &lt;Wien&gt; &amp; Co GmbH'), 'Sonderzeichen maskiert');
  assert.ok(!xml.includes('<Wien>'));
  for (const text of ['Honorarnote', 'MUSTERFRAU-MA-2026-E01', 'Wien, 26.09.2026', 'September 2026', 'AT61 1904 3002 3457 3201',
    '250,30', '0,10', '§ 6 Abs 1 Z 27 UStG', 'Kleinunternehmerregelung', 'Bitte überweisen Sie den Gesamtbetrag auf folgendes Konto:',
    'Honorarnote MUSTERFRAU-MA-2026-E01', 'ATU12345678']) {
    assert.ok(xml.includes(text), `fehlt: ${text}`);
  }
  assert.ok(xml.includes('<w:br/>'), 'Zeilenumbruch in der Anmerkung');
  assert.ok(!/Umsatzsteuer\b|netto|innerhalb von/.test(xml.replace('umsatzsteuerfrei', '')), 'keine Steuerzeilen, keine Frist');
});

test('Word-Datei: vollständiges Paket', async () => {
  const daten = await externeHonorarnoteDocx(DATEN, { JSZip, typ: 'uint8array' });
  const zip = await JSZip.loadAsync(daten);
  assert.deepEqual(Object.keys(zip.files).filter((n) => !n.endsWith('/')).sort(),
    ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  await assert.rejects(externeHonorarnoteDocx({ ...DATEN, nummer: '' }, { JSZip, typ: 'uint8array' }), /Nummer/);
  assert.equal(dateiname(DATEN), 'Honorarnote_MUSTERFRAU-MA-2026-E01_Stadtmagazin_Wien_Co_GmbH.docx');
});
