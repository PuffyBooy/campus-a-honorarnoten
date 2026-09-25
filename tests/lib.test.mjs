import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ibanFehler, ibanIstGueltig, formatIban, bicIstGueltig } from '../public/js/lib/iban.js';
import { parseBetrag, verwendungszweck, formatBetragPlain, formatDatum, esc } from '../public/js/lib/format.js';
import { epcPayload, utf8BinaryString } from '../public/js/lib/epc.js';
import { toCsv } from '../public/js/lib/csv.js';

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

test('Verwendungszweck', () => {
  assert.equal(verwendungszweck('CC-2026-0042', 'Reportage  Schulball'), 'Honorar CC-2026-0042 - Reportage Schulball');
  assert.equal(verwendungszweck('CC-2026-0042', 'x'.repeat(300)).length, 140);
});

test('EPC-QR-Payload', () => {
  const p = epcPayload({ name: 'Anna Autorin', iban: 'AT61 1904 3002 3457 3201', bic: 'bkauatww', betrag: 120.5, zweck: 'Honorar CC-2026-0001 - Test' });
  assert.deepEqual(p.split('\n'), ['BCD', '002', '1', 'SCT', 'BKAUATWW', 'Anna Autorin',
    'AT611904300234573201', 'EUR120.50', '', '', 'Honorar CC-2026-0001 - Test']);
  assert.equal(epcPayload({ name: 'A', iban: 'AT611904300234573201', betrag: 1, zweck: '' }).split('\n')[4], '');
  assert.throws(() => epcPayload({ name: 'A', iban: 'X', betrag: 0, zweck: '' }));
  assert.equal(utf8BinaryString('ä'), '\xC3\xA4');
});

test('CSV', () => {
  const csv = toCsv(['A', 'B'], [['x;y', '=SUMME(1)'], ['Zeile\n2', 'ok "q"']]);
  assert.ok(csv.startsWith('﻿A;B\r\n'));
  assert.ok(csv.includes('"x;y";\'=SUMME(1)'));
  assert.ok(csv.includes('"Zeile\n2";"ok ""q"""'));
});
