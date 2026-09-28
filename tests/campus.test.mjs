// Tests für die Verknüpfung mit campus-a-college.at: Links prüfen und Seiten auslesen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artikelLink, artikelSuche, artikelUrlGueltig, hatArtikel, profilIdAusLink, profilLink, titelLink } from '../public/js/lib/campus.js';
import { artikelParsen, artikelVonProfil, listeParsen } from '../server/campus-artikel.js';
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

test('Artikelliste einer Profilseite auslesen', () => {
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

test('Artikelseite auslesen: Titel, Datum, Ressort, Region, Kategorie', () => {
  const html = artikelSeite({ titel: 'Tom &amp; Jerry', ressort: 'Kultur', region: 'Wien', kategorie: 'Meinung', datum: '05.03.2026' });
  assert.deepEqual(artikelParsen(html), { titel: 'Tom & Jerry', datum: '2026-03-05', ressort: 'Kultur', region: 'Wien', kategorie: 'Meinung' });
  assert.equal(artikelParsen('<html><h1>Seite nicht gefunden</h1></html>'), null);
});

test('Artikel eines Profils: beim Aktualisieren nur neue Artikel nachladen', async () => {
  const { oeffneDatenbank } = await import('../server/db.js');
  const db = oeffneDatenbank(':memory:');
  const liste = (n, nr) => `<div id="newsSection">${n.map((slug) => `
    <span class="news-card-kicker"><span>Politik</span></span>
    <a class="news-card-title-link" href="/news/detail/${slug}">${slug}</a>`).join('')}
    ${nr ? `<a href="/profil/0123456789abcdef?fetchNews=1&amp;tx_news_pi1%5BcurrentPage%5D=${nr}&amp;cHash=x">weiter</a>` : ''}</div>`;
  const seite = { 1: ['c', 'b'], 2: ['a'] };
  const abrufe = [];
  const holen = async (url) => {
    abrufe.push(url);
    const u = new URL(url);
    if (u.pathname.startsWith('/news/detail/')) {
      const slug = u.pathname.split('/').pop();
      const tag = { a: '01', b: '02', c: '03', d: '04' }[slug];
      return artikelSeite({ titel: slug.toUpperCase(), ressort: 'Politik', region: 'Wien', kategorie: 'Meinung', datum: `${tag}.09.2026` });
    }
    const nr = u.searchParams.get('tx_news_pi1[currentPage]') ?? '1';
    return liste(seite[nr], nr === '1' ? 2 : null);
  };
  const erst = await artikelVonProfil(db, '0123456789abcdef', { holen });
  assert.deepEqual(erst.map((a) => a.titel), ['C', 'B', 'A']);
  assert.equal(abrufe.length, 5, '2 Listenseiten + 3 Artikelseiten');

  // neuer Artikel ganz vorne: erste Seite reicht, nur der neue Artikel wird gelesen
  seite[1] = ['d', 'c'];
  seite[2] = ['b', 'a'];
  abrufe.length = 0;
  const danach = await artikelVonProfil(db, '0123456789abcdef', { holen, neu: true });
  assert.deepEqual(danach.map((a) => a.titel), ['D', 'C', 'B', 'A']);
  assert.deepEqual(abrufe.map((u) => new URL(u).pathname), ['/profil/0123456789abcdef', '/profil/0123456789abcdef', '/news/detail/d']);
});
