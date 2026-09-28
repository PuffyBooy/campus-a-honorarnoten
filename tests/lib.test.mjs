import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ibanFehler, ibanIstGueltig, formatIban, bicIstGueltig } from '../public/js/lib/iban.js';
import { parseBetrag, formatBetragPlain, formatDatum, esc } from '../public/js/lib/format.js';
import { honorarnoteNummer, namensteil, initialen } from '../public/js/lib/nummer.js';
import { summe, formatMonat, formatBetragDokument, artText, artNormalisieren } from '../public/js/lib/format.js';
import { ortAusPlzOrt } from '../public/js/lib/honorarnote-docx.js';
import { kalenderwoche, nachWoche, wienerDatum, wocheText } from '../public/js/lib/woche.js';
import { honorarnotenPdf } from '../public/js/lib/honorarnote-pdf.js';
import * as PDFLib from '../public/vendor/pdf-lib.mjs';

test('IBAN-Prüfung', () => {
  assert.ok(ibanIstGueltig('AT61 1904 3002 3457 3201'));
  assert.ok(ibanIstGueltig('de89370400440532013000'));
  assert.match(ibanFehler('AT61 1904 3002 3457 3202'), /Prüfziffer/);
  assert.match(ibanFehler('AT61 1904 3002 3457 320'), /20 Zeichen/);
  assert.match(ibanFehler('12345'), /Format/);
  assert.match(ibanFehler(''), /angeben/);
  assert.equal(formatIban('AT611904300234573201'), 'AT61 1904 3002 3457 3201');
});

test('BIC-Prüfung', () => {
  assert.ok(bicIstGueltig(''));
  assert.ok(bicIstGueltig('BKAUATWW'));
  assert.ok(bicIstGueltig('bkau atww xxx'));
  assert.ok(!bicIstGueltig('BKAU'));
});

test('Betrag parsen', () => {
  assert.equal(parseBetrag('120'), 120);
  assert.equal(parseBetrag('120,5'), 120.5);
  assert.equal(parseBetrag('1.234,56'), 1234.56);
  assert.equal(parseBetrag('1234.56'), 1234.56);
  assert.equal(parseBetrag('€ 80,00'), 80);
  assert.equal(parseBetrag('0'), null);
  assert.equal(parseBetrag('12,345'), null);
  assert.equal(parseBetrag('abc'), null);
  assert.equal(parseBetrag('-5'), null);
});

test('Formatierung', () => {
  assert.equal(formatBetragPlain(1234.5), '1234,50');
  assert.equal(formatDatum('2026-09-01'), '01.09.2026');
  assert.equal(esc('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
});

test('Nummer laut Vorlage: NACHNAME-Initialen-Jahr-laufende Nummer', () => {
  assert.equal(honorarnoteNummer({ vorname: 'Maria', nachname: 'Musterfrau', jahr: 2026, laufendeNummer: 1 }), 'MUSTERFRAU-MA-2026-01');
  assert.equal(honorarnoteNummer({ vorname: 'Maria', nachname: 'Musterfrau', jahr: 2026, laufendeNummer: 2 }), 'MUSTERFRAU-MA-2026-02');
  assert.equal(honorarnoteNummer({ vorname: 'Jonas', nachname: 'Weiß', jahr: 2026, laufendeNummer: 12 }), 'WEISS-JO-2026-12');
  assert.equal(namensteil('Müller-Lüdenscheidt'), 'MUELLER-LUEDENSCHEIDT');
  assert.equal(namensteil('van der Berg'), 'VAN-DER-BERG');
  assert.equal(namensteil('Çelik'), 'CELIK');
  assert.equal(initialen('Özlem'), 'OE');
});

test('Summe und Monat', () => {
  assert.equal(summe([{ betrag: 0.1 }, { betrag: 0.2 }]), 0.3);
  assert.equal(summe([]), 0);
  assert.equal(formatMonat('2026-03-15'), 'März 2026');
  assert.equal(formatMonat('2026-01'), 'Jänner 2026');
  assert.equal(formatBetragDokument(1000), '1.000,00');
  assert.equal(formatBetragDokument(1234567.5), '1.234.567,50');
  assert.equal(formatBetragDokument(15), '15,00');
});

test('Ort aus PLZ und Ort', () => {
  assert.equal(ortAusPlzOrt('1010 Wien'), 'Wien');
  assert.equal(ortAusPlzOrt('8010 Graz'), 'Graz');
  assert.equal(ortAusPlzOrt('D-80331 München'), 'München');
  assert.equal(ortAusPlzOrt(''), 'Wien');
});

test('Art der Kolumne / Art des Honorars', () => {
  assert.equal(artText({ kategorie: 'kolumne', kolumnenart: 'Kultur', art: 'foto' }), 'Kultur');
  assert.equal(artText({ kategorie: 'ausserordentlich', art: 'foto' }), 'Foto', 'alte feste Werte schön benannt');
  assert.equal(artText({ kategorie: 'ausserordentlich', art: 'Reportage' }), 'Reportage', 'freier Text');
  assert.equal(artNormalisieren('  Foto \n und   Text '), 'Foto und Text');
  assert.equal(artNormalisieren('x'.repeat(300)).length, 100);
});

test('Kalenderwochen (ISO 8601)', () => {
  assert.deepEqual(kalenderwoche('2026-09-28'), { schluessel: '2026-W40', jahr: 2026, kw: 40, montag: '2026-09-28', sonntag: '2026-10-04' });
  assert.equal(kalenderwoche('2026-10-04').schluessel, '2026-W40', 'Sonntag gehört zur selben Woche');
  assert.equal(kalenderwoche('2025-12-29').schluessel, '2026-W01', 'Jahreswechsel');
  assert.equal(kalenderwoche('2021-01-03').schluessel, '2020-W53');
  assert.equal(kalenderwoche('2026-09-27T22:30:00Z').schluessel, '2026-W40', 'Zeitstempel nach Wiener Zeit (00:30 am Montag)');
  assert.equal(wienerDatum(Date.UTC(2026, 8, 27, 21, 59)), '2026-09-27');
  assert.equal(wocheText(kalenderwoche('2026-09-28')), 'KW 40 · 28.09.–04.10.2026');
  assert.equal(wocheText(kalenderwoche('2025-12-31')), 'KW 1 · 29.12.2025–04.01.2026');
  const gruppen = nachWoche([{ d: '2026-09-30' }, { d: '2026-09-21' }, { d: '2026-09-28' }], (x) => x.d);
  assert.deepEqual(gruppen.map((g) => [g.woche.kw, g.noten.length]), [[39, 1], [40, 2]]);
});

test('Honorarnoten als PDF: eine Datei, jede Note ab neuer Seite', async () => {
  const note = (nummer, anzahl) => ({
    nummer, eingereicht_am: '2026-09-22T10:00:00Z',
    autor: { vorname: 'Maria', nachname: 'Musterfrau', strasse: 'Musterstraße 1/2', plz_ort: '1010 Wien' },
    zahlung: { iban: 'AT611904300234573201' },
    empfaenger: { name: 'campus a Medien GmbH', strasse: 'Stiftgasse 6/1/2', plz_ort: '1070 Wien', uid: 'ATU81242718' },
    positionen: [
      ...Array.from({ length: anzahl }, (_, i) => ({ kategorie: 'kolumne', titel: `Kolumne ${i} – „Schule“ 😀 €`, veroeffentlichung: '2026-09-10', betrag: 15 })),
      { kategorie: 'ausserordentlich', titel: 'Interview', veroeffentlichung: '2026-09-12', vereinbart_mit: 'Rita', betrag: 60.5 },
    ],
  });
  const bytes = await honorarnotenPdf([note('A-1', 2), note('B-2', 60)], PDFLib);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const pdf = await PDFLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3, 'zweite Note mit 60 Kolumnen braucht mehr als eine Seite');
  assert.equal(pdf.getTitle(), 'Honorarnoten (2)');
});
