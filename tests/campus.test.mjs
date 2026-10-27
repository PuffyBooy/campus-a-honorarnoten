// Tests für die Verknüpfung mit campus-a-college.at: Links prüfen und Seiten auslesen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artikelLink, artikelSuche, artikelUrlGueltig, hatArtikel, profilIdAusLink, profilLink, titelLink } from '../public/js/lib/campus.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { php, phpAufrufe } from './php-aufruf.mjs';
import { artikelSeite, listeSeite1, listeSeite2 } from './campus-fixtures.mjs';

test('Profil-Link auf campus-a-college.at erkennen', () => {
  const id = 'ae1054937a1ae033e117';
  assert.equal(profilIdAusLink(`https://www.campus-a-college.at/profil/${id}`), id);
  assert.equal(profilIdAusLink(` campus-a-college.at/profil/${id.toUpperCase()}/ `), id);
  assert.equal(profilIdAusLink(`https://www.campus-a-college.at/profil/${id}?fetchNews=1#oben`), id);
  assert.equal(profilIdAusLink(id), id, 'auch nur die ID');
  assert.equal(profilIdAusLink(''), '', 'leer = keine Verknüpfung');
  assert.equal(profilIdAusLink('https://example.org/profil/ae1054937a1ae033e117'), null);
  assert.equal(profilIdAusLink('https://www.campus-a-college.at/profil/../login'), null);
  assert.equal(profilLink(id), `https://www.campus-a-college.at/profil/${id}`);
  assert.equal(profilLink(''), '');
});

test('Artikel-Adressen: nur echte Artikel auf campus-a-college.at', () => {
  assert.ok(artikelUrlGueltig('https://www.campus-a-college.at/news/detail/das-packerl-wird-teurer'));
  assert.ok(!artikelUrlGueltig('http://www.campus-a-college.at/news/detail/x'));
  assert.ok(!artikelUrlGueltig('https://www.campus-a-college.at.boese.example/news/detail/x'));
  assert.ok(!artikelUrlGueltig('https://www.campus-a-college.at/news/detail/x?y=1'));
  assert.ok(!artikelUrlGueltig('javascript:alert(1)'));
  assert.ok(!artikelUrlGueltig('demo:artikel-1'));
  assert.equal(artikelLink('', 'Titel <b>'), 'Titel &lt;b&gt;', 'ohne Artikel nur Text');
  assert.equal(artikelLink('javascript:alert(1)', 'X'), 'X');
  assert.match(artikelLink('https://www.campus-a-college.at/news/detail/x', 'Ansehen'),
    /^<a href="https:\/\/www\.campus-a-college\.at\/news\/detail\/x" target="_blank" rel="noopener noreferrer" title="[^"]+">Ansehen<\/a>$/);
  assert.match(artikelLink('demo:artikel-1', 'Titel <b>', 'artikel-titel'),
    /^<a href="https:\/\/www\.campus-a-college\.at\/" target="_blank" rel="noopener noreferrer" class="artikel-titel" title="Demo:[^"]+">Titel &lt;b&gt;<\/a>$/, 'Demo: Link zur Startseite');
});

test('hatArtikel: echte Artikel und Beispielartikel der Demo', () => {
  assert.ok(hatArtikel('https://www.campus-a-college.at/news/detail/x'));
  assert.ok(hatArtikel('demo:beitrag-1'));
  assert.ok(!hatArtikel(''));
  assert.ok(!hatArtikel(undefined));
  assert.ok(!hatArtikel('https://example.org/news/detail/x'));
});

test('Titel immer klickbar: Artikel direkt, sonst Suche nach dem Titel', () => {
  assert.equal(artikelSuche(' Tom & Jerry? '), 'https://www.campus-a-college.at/suchergebnisse?tx_solr%5Bq%5D=Tom%20%26%20Jerry%3F');
  assert.match(titelLink('https://www.campus-a-college.at/news/detail/x', 'X'), /href="https:\/\/www\.campus-a-college\.at\/news\/detail\/x"/);
  const suche = titelLink('', 'Graz "von" unten');
  assert.match(suche, /^<a href="https:\/\/www\.campus-a-college\.at\/suchergebnisse\?tx_solr%5Bq%5D=Graz%20%22von%22%20unten" target="_blank"/);
  assert.match(suche, />Graz &quot;von&quot; unten<\/a>$/);
});

test('Artikelliste einer Profilseite auslesen (Server)', () => {
  const listeParsen = (html, medium = 'college') => php('liste_parsen', html, medium);
  const { artikel, seiten } = listeParsen(listeSeite1);
  assert.deepEqual(artikel, [
    { url: 'https://www.campus-a-college.at/news/detail/das-packerl-wird-teurer', titel: 'Das Packerl wird teurer', ressort: 'Wirtschaft' },
    { url: 'https://www.campus-a-college.at/news/detail/alter-bestaetigen-bitte', titel: 'Alter bestätigen, bitte', ressort: 'Politik' },
  ]);
  assert.deepEqual(seiten, [
    'https://www.campus-a-college.at/profil/ae1054937a1ae033e117?fetchNews=1&tx_news_pi1%5Bcontroller%5D=News&tx_news_pi1%5BcurrentPage%5D=2&cHash=abc2',
  ]);
  assert.equal(listeParsen(listeSeite2).artikel.length, 2);
  assert.deepEqual(listeParsen('<html>keine Artikel</html>'), { artikel: [], seiten: [] });
});

test('Artikelseite auslesen: Titel, Datum, Ressort, Region, Kategorie (Server)', () => {
  const artikelParsen = (html) => php('artikel_parsen', html);
  const html = artikelSeite({ titel: 'Tom &amp; Jerry', ressort: 'Kultur', region: 'Wien', kategorie: 'Meinung', datum: '05.03.2026' });
  assert.deepEqual(artikelParsen(html), { titel: 'Tom & Jerry', datum: '2026-03-05', ressort: 'Kultur', region: 'Wien', kategorie: 'Meinung' });
  assert.equal(artikelParsen('<html><h1>Seite nicht gefunden</h1></html>'), null);
});

test('Artikel eines Profils: beim Aktualisieren nur neue Artikel nachladen (Server)', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'honorare-artikel-'));
  const db = join(ordner, 'test.sqlite');
  const basis = 'https://www.campus-a-college.at';
  const profil = '0123456789abcdef';
  const liste = (n, nr) => `<div id="newsSection">${n.map((slug) => `
    <span class="news-card-kicker"><span>Politik</span></span>
    <a class="news-card-title-link" href="/news/detail/${slug}">${slug}</a>`).join('')}
    ${nr ? `<a href="/profil/${profil}?fetchNews=1&amp;tx_news_pi1%5BcurrentPage%5D=${nr}&amp;cHash=x">weiter</a>` : ''}</div>`;
  const tag = { a: '01', b: '02', c: '03', d: '04' };
  const seiten = (s1, s2) => ({
    [`${basis}/profil/${profil}?fetchNews=1`]: liste(s1, 2),
    [`${basis}/profil/${profil}?fetchNews=1&tx_news_pi1%5BcurrentPage%5D=2&cHash=x`]: liste(s2, null),
    ...Object.fromEntries(Object.entries(tag).map(([slug, t]) => [`${basis}/news/detail/${slug}`,
      artikelSeite({ titel: slug.toUpperCase(), ressort: 'Politik', region: 'Wien', kategorie: 'Meinung', datum: `${t}.09.2026` })])),
  });
  try {
    const [erst] = phpAufrufe([{ fn: 'artikel_von_profil', db, seiten: seiten(['c', 'b'], ['a']), args: [profil, 'college', false] }]);
    assert.deepEqual(erst.ok.artikel.map((a) => a.titel), ['C', 'B', 'A']);
    assert.equal(erst.ok.abrufe.length, 5, '2 Listenseiten + 3 Artikelseiten');

    // neuer Artikel ganz vorne: erste Seite reicht nicht (d ist neu), zweite nur bekannte – nur der neue Artikel wird gelesen
    const [danach] = phpAufrufe([{ fn: 'artikel_von_profil', db, seiten: seiten(['d', 'c'], ['b', 'a']), args: [profil, 'college', true] }]);
    assert.deepEqual(danach.ok.artikel.map((a) => a.titel), ['D', 'C', 'B', 'A']);
    assert.deepEqual(danach.ok.abrufe.map((u) => new URL(u).pathname), [`/profil/${profil}`, `/profil/${profil}`, '/news/detail/d']);

    // ohne „neu“ innerhalb von 10 Minuten: keine Abrufe
    const [cache] = phpAufrufe([{ fn: 'artikel_von_profil', db, seiten: {}, args: [profil, 'college', false] }]);
    assert.equal(cache.ok.artikel.length, 4);
    assert.deepEqual(cache.ok.abrufe, []);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test('Zwei Medien: Profil-Links und Artikel-Adressen von campus-a.at', async () => {
  const { mediumVonArtikel, mediumName, mediumOder } = await import('../public/js/lib/campus.js');
  const id = '0eb9253511e3f774dab6';
  assert.equal(profilIdAusLink(`https://campus-a.at/profil/${id}`, 'campus-a'), id);
  assert.equal(profilIdAusLink(`www.campus-a.at/profil/${id}`, 'campus-a'), id);
  assert.equal(profilIdAusLink(`https://campus-a.at/profil/${id}`, 'college'), null, 'Link der anderen Seite');
  assert.equal(profilIdAusLink(`https://www.campus-a-college.at/profil/${id}`, 'campus-a'), null);
  assert.equal(profilLink(id, 'campus-a'), `https://campus-a.at/profil/${id}`);
  assert.equal(mediumVonArtikel('https://campus-a.at/news/news-detail/x-y'), 'campus-a');
  assert.equal(mediumVonArtikel('https://www.campus-a-college.at/news/detail/x-y'), 'college');
  assert.equal(mediumVonArtikel('https://campus-a.at/news/detail/x-y'), null);
  assert.equal(artikelSuche('A B', 'campus-a'), 'https://campus-a.at/suchergebnisse?tx_solr%5Bq%5D=A%20B');
  assert.match(titelLink('', 'X', 'artikel-titel', 'campus-a'), /href="https:\/\/campus-a\.at\/suchergebnisse/);
  assert.match(artikelLink('demo:campus-a-artikel-1', 'X', '', 'campus-a'), /href="https:\/\/campus-a\.at\/"/);
  assert.equal(mediumName('campus-a'), 'campus a');
  assert.equal(mediumName(undefined), 'campus a college', 'ältere Einträge ohne Medium');
  assert.equal(mediumOder('quatsch'), 'college');
});

test('Artikelliste von campus-a.at auslesen (/news/news-detail/)', async () => {
  const { campusAListe } = await import('./campus-fixtures.mjs');
  const listeParsen = (html, medium) => php('liste_parsen', html, medium);
  assert.deepEqual(listeParsen(campusAListe, 'campus-a').artikel, [{
    url: 'https://campus-a.at/news/news-detail/das-geschaeft-mit-universitaets-rankings',
    titel: 'Das Geschäft mit Universitäts-Rankings', ressort: 'Wissenschaft',
  }]);
  assert.deepEqual(listeParsen(campusAListe, 'college').artikel, [], 'Adressen der anderen Seite zählen nicht');
});

test('Konto einrichten: was Autor:innen noch fehlt', async () => {
  const { kontoFehlt, kontoFertig } = await import('../public/js/lib/konto.js');
  const fertig = { rollen: ['autor'], profil: { strasse: 'Weg 1', plz_ort: '1010 Wien', kontoinhaber: 'A B', iban: 'AT611904300234573201', campus_a_profil: 'abcdef123456' } };
  assert.ok(kontoFertig(fertig));
  assert.deepEqual(kontoFehlt({ ...fertig, profil: { ...fertig.profil, campus_a_profil: '' } }), ['Profil-Link']);
  assert.deepEqual(kontoFehlt({ rollen: ['autor'], profil: {} }), ['Adresse', 'Bankverbindung', 'Profil-Link']);
  assert.ok(kontoFertig({ rollen: ['redaktion'], profil: {} }), 'nur Autor:innen brauchen Adresse, IBAN und Link');
});

test('Honorarsätze pro Medium', async () => {
  const { saetzeNormalisieren, satzFuer, weichtAb } = await import('../public/js/lib/honorarsaetze.js');
  assert.deepEqual(saetzeNormalisieren({ kolumne: '16', ausserordentlich: '' }),
    { college: { kolumne: 16, ausserordentlich: null, redigieren: 2 }, 'campus-a': { kolumne: 16, ausserordentlich: null } },
    'alte Sätze gelten für beide; Redigieren mit Standard 2 €');
  const s = saetzeNormalisieren({ college: { kolumne: 15 }, 'campus-a': { kolumne: 25, ausserordentlich: 80 } });
  assert.equal(satzFuer(s, 'campus-a', 'kolumne'), 25);
  assert.equal(satzFuer(s, undefined, 'kolumne'), 15);
  assert.equal(satzFuer(s, 'college', 'ausserordentlich'), null);
  assert.ok(weichtAb({ medium: 'campus-a', kategorie: 'kolumne', betrag: 15 }, s));
  assert.ok(!weichtAb({ medium: 'college', kategorie: 'kolumne', betrag: 15 }, s));
  assert.throws(() => saetzeNormalisieren({ college: { kolumne: -1 } }), /Honorarsätze/);
  // Redigieren: Satz pro Text × Anzahl
  const r = saetzeNormalisieren({ college: { kolumne: 15, redigieren: 2 } });
  assert.ok(!weichtAb({ medium: 'college', kategorie: 'redigieren', anzahl: 6, betrag: 12 }, r));
  assert.ok(weichtAb({ medium: 'college', kategorie: 'redigieren', anzahl: 6, betrag: 2 }, r));
});

test('Redigieren: Bezeichnung auf der Honorarnote', async () => {
  const { rollenNormalisieren } = await import('../public/js/lib/konto.js');
  const { redigierText, ausserordentlichePositionen, artText } = await import('../public/js/lib/format.js');
  assert.deepEqual(rollenNormalisieren(['redigieren']), ['autor', 'redigieren'], 'Redigieren bringt Autor:in mit');
  assert.deepEqual(rollenNormalisieren(['admin', 'quatsch']), ['admin']);
  assert.equal(redigierText({ titel: 'Redigieren (1 Text)', anzahl: 1 }), 'Redigieren (1 Text)');
  assert.equal(redigierText({ titel: 'September', anzahl: 7 }), 'Redigieren (7 Texte): September');
  assert.equal(redigierText({ titel: 'Redigieren September', anzahl: 7 }), 'Redigieren September (7 Texte)');
  const liste = ausserordentlichePositionen([
    { kategorie: 'kolumne', titel: 'K' },
    { kategorie: 'ausserordentlich', titel: 'Interview', vereinbart_mit: 'Rita' },
    { kategorie: 'redigieren', titel: '', anzahl: 3 },
  ]);
  assert.deepEqual(liste.map((p) => [p.titel, p.vereinbart_mit]), [['Interview', 'Rita'], ['Redigieren (3 Texte)', '–']],
    'Redigieren steht bei den außerordentlichen Honoraren');
  assert.equal(artText({ kategorie: 'redigieren', anzahl: 7 }), '7 Texte');
});
