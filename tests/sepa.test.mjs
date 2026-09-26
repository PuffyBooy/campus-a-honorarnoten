// Tests für die SEPA-Sammelüberweisung (pain.001)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sepaXml, sepaText, sepaPruefen, SEPA_FORMATE } from '../public/js/lib/sepa.js';

const AUFTRAGGEBER = { name: 'campus a Medien GmbH', iban: 'AT32 2011 1823 4567 8901', bic: 'GIBAATWWXXX' };
const ZAHLUNGEN = [
  { referenz: 'MUSTERFRAU-MA-2026-01', name: 'Maria Müller-Größ', iban: 'AT611904300234573201', bic: 'BKAUATWW', betrag: 1015.5, zweck: 'Honorar MUSTERFRAU-MA-2026-01 - Maria Müller-Größ September 2026' },
  { referenz: 'WEISS-JO-2026-02', name: 'Jonas Weiß & Co <x>', iban: 'DE89370400440532013000', bic: '', betrag: 15, zweck: 'Honorar WEISS-JO-2026-02 – „Graz“' },
];
const ARGS = { auftraggeber: AUFTRAGGEBER, zahlungen: ZAHLUNGEN, ausfuehrung: '2026-09-28', jetzt: new Date('2026-09-26T12:00:00Z') };

test('SEPA-Zeichensatz: Umlaute umschreiben, Sonderzeichen entfernen, Länge begrenzen', () => {
  assert.equal(sepaText('Maria Müller-Größ'), 'Maria Mueller-Groess');
  assert.equal(sepaText('Jonas Weiß & Co <x>'), 'Jonas Weiss + Co x');
  assert.equal(sepaText('„Graz“ – Çelik'), 'Graz - Celik');
  assert.equal(sepaText('a'.repeat(200), 140).length, 140);
});

test('pain.001.001.03: Aufbau, Summen, Beträge', () => {
  const x = sepaXml(ARGS);
  assert.match(x, /xmlns="urn:iso:std:iso:20022:tech:xsd:pain\.001\.001\.03"/);
  assert.equal((x.match(/<NbOfTxs>2<\/NbOfTxs>/g) ?? []).length, 2);
  assert.equal((x.match(/<CtrlSum>1030\.50<\/CtrlSum>/g) ?? []).length, 2);
  assert.match(x, /<InstdAmt Ccy="EUR">1015\.50<\/InstdAmt>/);
  assert.match(x, /<InstdAmt Ccy="EUR">15\.00<\/InstdAmt>/);
  assert.match(x, /<ReqdExctnDt>2026-09-28<\/ReqdExctnDt>/);
  assert.match(x, /<DbtrAcct><Id><IBAN>AT322011182345678901<\/IBAN>/);
  assert.match(x, /<BIC>GIBAATWWXXX<\/BIC>/);
  assert.match(x, /<Nm>Maria Mueller-Groess<\/Nm>/);
  assert.match(x, /<EndToEndId>WEISS-JO-2026-02<\/EndToEndId>/);
  // ohne BIC kein CdtrAgt für diese Zahlung
  assert.equal((x.match(/<CdtrAgt>/g) ?? []).length, 1);
  assert.ok(!/[<>&"]/.test(x.match(/<Nm>Jonas[^<]*<\/Nm>/)[0].slice(4, -5)));
});

test('pain.001.001.09: neues Datums- und BIC-Format', () => {
  const x = sepaXml({ ...ARGS, format: 'pain.001.001.09' });
  assert.match(x, /pain\.001\.001\.09/);
  assert.match(x, /<ReqdExctnDt><Dt>2026-09-28<\/Dt><\/ReqdExctnDt>/);
  assert.match(x, /<BICFI>BKAUATWW<\/BICFI>/);
  assert.ok(!x.includes('<BIC>'));
});

test('Auftraggeber ohne BIC: NOTPROVIDED', () => {
  const x = sepaXml({ ...ARGS, auftraggeber: { ...AUFTRAGGEBER, bic: '' } });
  assert.match(x, /<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED<\/Id><\/Othr><\/FinInstnId><\/DbtrAgt>/);
});

test('Fehlerhafte Eingaben werden abgelehnt', () => {
  assert.ok(sepaPruefen({ ...ARGS, auftraggeber: { name: '', iban: 'AT00' } }).length >= 2);
  assert.ok(sepaPruefen({ ...ARGS, zahlungen: [] }).some((f) => /Keine Zahlungen/.test(f)));
  assert.ok(sepaPruefen({ ...ARGS, zahlungen: [{ ...ZAHLUNGEN[0], iban: 'AT611904300234573202' }] }).some((f) => /IBAN/.test(f)));
  assert.ok(sepaPruefen({ ...ARGS, zahlungen: [{ ...ZAHLUNGEN[0], betrag: 0 }] }).some((f) => /Betrag/.test(f)));
  assert.throws(() => sepaXml({ ...ARGS, format: 'pain.001.001.99' }), /Format/);
  assert.throws(() => sepaXml({ ...ARGS, ausfuehrung: '' }), /Ausführungsdatum/);
});

// Prüfung gegen die offiziellen ISO-20022-Schemas (braucht xmllint, sonst übersprungen)
const hatXmllint = spawnSync('xmllint', ['--version']).status === 0;
for (const format of Object.keys(SEPA_FORMATE)) {
  test(`${format} ist gültig laut offiziellem XSD-Schema`, { skip: !hatXmllint && 'xmllint nicht installiert' }, () => {
    const ordner = mkdtempSync(join(tmpdir(), 'sepa-'));
    for (const variante of [ARGS, { ...ARGS, auftraggeber: { ...AUFTRAGGEBER, bic: '' } }]) {
      const datei = join(ordner, 'test.xml');
      writeFileSync(datei, sepaXml({ ...variante, format }));
      const schema = new URL(`./schemas/${format}.xsd`, import.meta.url).pathname;
      execFileSync('xmllint', ['--noout', '--schema', schema, datei], { stdio: 'pipe' });
    }
  });
}
