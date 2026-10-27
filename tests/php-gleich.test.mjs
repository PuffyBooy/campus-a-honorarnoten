// Browser (JavaScript) und Server (PHP) müssen gleich rechnen: dieselben Eingaben, dieselben Ergebnisse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phpAufrufe } from './php-aufruf.mjs';
import { ibanFehler, formatIban, bicIstGueltig } from '../public/js/lib/iban.js';
import { namensteil, initialen, honorarnoteNummer } from '../public/js/lib/nummer.js';
import { profilIdAusLink, profilLink, mediumVonArtikel, mediumOder, mediumName, verbundeneMedien } from '../public/js/lib/campus.js';
import { kontoFehlt, rollenNormalisieren, darfRedigieren } from '../public/js/lib/konto.js';
import { saetzeNormalisieren } from '../public/js/lib/honorarsaetze.js';
import { textAnzahl, artNormalisieren, redigierText, formatBetragDokument, formatDatum } from '../public/js/lib/format.js';
import { artikelSeite } from './campus-fixtures.mjs';

/** Jeder Fall: [PHP-Funktion, JS-Funktion, Argumente…] */
function vergleiche(faelle) {
  const php = phpAufrufe(faelle.map(([fn, , ...args]) => ({ fn, args })));
  faelle.forEach(([fn, js, ...args], i) => {
    let erwartet;
    try {
      erwartet = { ok: js(...args) };
    } catch (e) {
      erwartet = { fehler: e.message };
    }
    // JSON-Rundreise: undefined fällt weg, wie bei PHP
    assert.deepEqual(php[i], JSON.parse(JSON.stringify(erwartet)), `${fn}(${JSON.stringify(args)})`);
  });
}

test('IBAN und BIC', () => {
  const ibans = ['AT611904300234573201', 'at61 1904 3002 3457 3201', 'AT611904300234573202', 'DE89370400440532013000',
    'AT6119043002345732', 'XX', '', '  ', 'NO9386011117947', 'GB82WEST12345698765432', 'AT61 1904 3002 3457 3201 ', 'ÄT61'];
  vergleiche([
    ...ibans.map((x) => ['iban_fehler', ibanFehler, x]),
    ...ibans.slice(0, 4).map((x) => ['iban_formatieren', formatIban, x]),
    ...['', 'BKAUATWW', 'bkau at ww', 'BKAUATWWXXX', 'BKAU', 'BKAUATW!'].map((x) => ['bic_gueltig', bicIstGueltig, x]),
  ]);
});

test('Nummer der Honorarnote', () => {
  const namen = ['Müller', 'Weiß', 'Österreicher-Übel', 'García Lorca', "O'Brien", '', '  ', 'Zoë', 'Łukasz', 'Ärzte', 'van der Berg', 'Çelik', 'Ångström', 'Dvořák', 'Šimić', 'Øre', 'ÉLISE'];
  vergleiche([
    ...namen.map((n) => ['namensteil', namensteil, n]),
    ...namen.map((n) => ['initialen', initialen, n]),
    ['honorarnote_nummer', (v, n, j, l) => honorarnoteNummer({ vorname: v, nachname: n, jahr: j, laufendeNummer: l }), 'Anna', 'Müller', 2026, 3],
    ['honorarnote_nummer', (v, n, j, l) => honorarnoteNummer({ vorname: v, nachname: n, jahr: j, laufendeNummer: l }), '', '', 2026, 12],
  ]);
});

test('Medien, Profil-Links und Artikel-Adressen', () => {
  const links = ['https://www.campus-a-college.at/profil/ae1054937a1ae033e117', 'campus-a-college.at/profil/AE1054937A1AE033E117/',
    'https://campus-a.at/profil/0eb9253511e3f774dab6', 'ae1054937a1ae033e117', 'abc', '', 'https://example.org/profil/abc',
    'https://www.campus-a-college.at/profil/ae1054937a1ae033e117?x=1#a', 'www.campus-a.at/profil/0eb9253511e3f774dab6'];
  const artikel = ['https://www.campus-a-college.at/news/detail/das-packerl', 'https://campus-a.at/news/news-detail/x-y',
    'https://campus-a.at/news/detail/x-y', 'http://www.campus-a-college.at/news/detail/x', 'https://www.campus-a-college.at/news/detail/A', ''];
  vergleiche([
    ...links.flatMap((l) => [['profil_id_aus_link', profilIdAusLink, l, 'college'], ['profil_id_aus_link', profilIdAusLink, l, 'campus-a']]),
    ['profil_link', profilLink, 'ae1054937a1ae033e117', 'campus-a'],
    ...artikel.map((a) => ['medium_von_artikel', mediumVonArtikel, a]),
    ...['college', 'campus-a', 'quatsch', null].map((m) => ['medium_oder', mediumOder, m]),
    ...['college', 'campus-a', null].map((m) => ['medium_name', mediumName, m]),
    ['verbundene_medien', verbundeneMedien, { campus_profil: '', campus_a_profil: 'abc' }],
    ['verbundene_medien', verbundeneMedien, { campus_profil: 'x', campus_a_profil: 'y' }],
  ]);
});

test('Konto und Rollen', () => {
  const p = { strasse: 'Weg 1', plz_ort: '1010 Wien', kontoinhaber: 'A B', iban: 'AT611904300234573201', campus_profil: '', campus_a_profil: 'abcdef123456' };
  vergleiche([
    ['konto_fehlt', kontoFehlt, { rollen: ['autor'], profil: p }],
    ['konto_fehlt', kontoFehlt, { rollen: ['autor'], profil: { ...p, iban: 'AT00', strasse: ' ' } }],
    ['konto_fehlt', kontoFehlt, { rollen: ['autor'], profil: { ...p, campus_a_profil: '' } }],
    ['konto_fehlt', kontoFehlt, { rollen: ['redaktion'], profil: {} }],
    ...[['redigieren'], ['admin', 'quatsch'], ['redigieren', 'autor', 'admin'], [], 'x', null].map((r) => ['rollen_normalisieren', rollenNormalisieren, r]),
    ['darf_redigieren', darfRedigieren, { rollen: ['autor', 'redigieren'] }],
    ['darf_redigieren', darfRedigieren, { rollen: ['autor'] }],
  ]);
});

test('Honorarsätze', () => {
  vergleiche([
    ...[{}, { kolumne: 16, ausserordentlich: null }, { college: { kolumne: 17.5, ausserordentlich: '' }, 'campus-a': { kolumne: 25, ausserordentlich: 80 } },
      { college: { kolumne: 15, redigieren: 2.5 } }, { 'campus-a': { kolumne: -5 } }, { college: { kolumne: '15,5' } }, { college: { kolumne: 10.005 } },
      { college: { kolumne: '12.50' } }].map((x) => ['saetze_normalisieren', saetzeNormalisieren, x]),
  ]);
});

test('Texte: Anzahl, Art, Redigieren, Beträge, Datum', () => {
  vergleiche([
    ...[0, 1, 2, 7, '3'].map((n) => ['text_anzahl', textAnzahl, n]),
    ...['  Foto   und Text ', 'x'.repeat(120), ' Kultur ', ''].map((t) => ['art_normalisieren', artNormalisieren, t]),
    ...[{ titel: '', anzahl: 7 }, { titel: 'Redigieren (1 Text)', anzahl: 1 }, { titel: 'September', anzahl: 7 }, { titel: 'Redigieren September', anzahl: 7 }]
      .map((p) => ['redigier_text', redigierText, p]),
    ...[15, 75.5, 1234.5, 1000000, 0.1].map((b) => ['betrag_text', formatBetragDokument, b]),
    ['datum_text', formatDatum, '2026-09-01'],
  ]);
});

test('Artikelseite: HTML-Entitäten wie auf der echten Seite', () => {
  const html = artikelSeite({ titel: 'Tom &amp; Jerry &#8211; „Test“ &nbsp;x&shy;y', ressort: 'Kultur', region: 'Wien', kategorie: 'Meinung', datum: '05.03.2026' });
  const [r] = phpAufrufe([{ fn: 'artikel_parsen', args: [html] }]);
  assert.deepEqual(r.ok, { titel: 'Tom & Jerry – „Test“ xy', datum: '2026-03-05', ressort: 'Kultur', region: 'Wien', kategorie: 'Meinung' });
});
