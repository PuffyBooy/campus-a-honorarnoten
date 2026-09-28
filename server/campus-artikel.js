// Artikel einer Autor:in von campus-a-college.at holen.
//
// Die Seite läuft mit TYPO3 und hat keine Schnittstelle für Artikeldaten. Deshalb werden die
// normalen Seiten ausgelesen:
//   /profil/<ID>?fetchNews=1   Liste der veröffentlichten Artikel (12 pro Seite, mit Seiten-Links)
//   /news/detail/<name>        Artikelseite mit Datum, Ressort und Kategorie (z. B. „Meinung“)
// Artikeldaten ändern sich kaum und werden deshalb in der Datenbank zwischengespeichert,
// die Liste pro Profil für einige Minuten im Speicher.
import { CAMPUS_BASIS, artikelUrlGueltig } from '../public/js/lib/campus.js';

const MAX_SEITEN = 50;
const MAX_ARTIKEL = 600;
const GLEICHZEITIG = 6;
const LISTE_GUELTIG_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 15000;

const ENTITAETEN = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  ndash: '–', mdash: '—', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', sbquo: '‚', lsquo: '‘', rsquo: '’',
};

function text(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITAETEN[e] ?? ENTITAETEN[e.toLowerCase()] ?? ganz;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const absolut = (pfad) => `${CAMPUS_BASIS}${pfad.replaceAll('&amp;', '&')}`;

/** Artikelliste einer Profilseite: Artikel (Adresse, Titel, Ressort) und Links zu weiteren Seiten */
export function listeParsen(html) {
  const start = html.indexOf('id="newsSection"');
  const bereich = start >= 0 ? html.slice(start) : html;
  const artikel = [];
  const gesehen = new Set();
  // eine Karte: <span class="news-card-kicker"><span>Ressort</span></span> <a class="news-card-title-link" href="/news/detail/…">Titel</a>
  const karte = /news-card-kicker">([\s\S]*?)<\/span>\s*<\/span>[\s\S]*?<a class="news-card-title-link"[^>]*href="(\/news\/detail\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of bereich.matchAll(karte)) {
    const url = absolut(m[2]);
    if (!artikelUrlGueltig(url) || gesehen.has(url)) continue;
    gesehen.add(url);
    artikel.push({ url, titel: text(m[3]).slice(0, 200), ressort: text(m[1]).slice(0, 100) });
  }
  const seiten = [...new Set(Array.from(
    bereich.matchAll(/href="(\/profil\/[0-9a-f]+\?fetchNews=1&amp;[^"]*currentPage[^"]*)"/g), (m) => absolut(m[1]),
  ))];
  return { artikel, seiten };
}

/** Artikelseite: Titel, Datum (JJJJ-MM-TT), Ressort, Region und Kategorie (z. B. „Meinung“) */
export function artikelParsen(html) {
  const start = html.indexOf('<article');
  if (start < 0) return null;
  const h1 = html.indexOf('<h1', start);
  if (h1 < 0) return null;
  // Kopfzeile über dem Titel: Ressort · Region · Kategorie (die Kategorie ist ein Link auf /kategorien/…)
  const kopfHtml = html.slice(start, h1);
  const kopf = Array.from(kopfHtml.matchAll(/<span class="after:[^"]*">([\s\S]*?)<\/span>/g), (m) => text(m[1])).filter(Boolean);
  const kategorie = text(kopfHtml.match(/<a[^>]*href="\/kategorien\/[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1]);
  const titel = text(html.slice(h1).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]);
  const d = html.slice(h1, h1 + 20000).match(/>\s*(\d{2})\.(\d{2})\.(\d{4})\s*</);
  return {
    titel: titel.slice(0, 200),
    datum: d ? `${d[3]}-${d[2]}-${d[1]}` : '',
    ressort: (kopf[0] ?? '').slice(0, 100),
    region: kopf.slice(1).filter((k) => k !== kategorie).join(', ').slice(0, 100),
    kategorie: kategorie.slice(0, 100),
  };
}

export async function standardHolen(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'campus-a-honorarnoten (Honorarnoten-App)', Accept: 'text/html' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return res.text();
}

async function nacheinander(liste, anzahl, fn) {
  let i = 0;
  const arbeiter = Array.from({ length: Math.min(anzahl, liste.length) }, async () => {
    while (i < liste.length) await fn(liste[i++]);
  });
  await Promise.all(arbeiter);
}

const listenCache = new Map(); // profilId -> { zeit, artikel } (Reihenfolge wie auf der Seite: neueste zuerst)
const laufend = new Map();     // profilId -> Promise (gleichzeitige Abrufe teilen sich die Arbeit)

/**
 * Artikelliste eines Profils über alle Seiten. Ist die Liste schon bekannt, wird nur so weit geblättert,
 * bis eine Seite nur noch bekannte Artikel enthält – neue Artikel stehen auf der Seite ganz vorne.
 */
async function listeHolen(profilId, holen, bisherige) {
  const erste = `${CAMPUS_BASIS}/profil/${profilId}?fetchNews=1`;
  // Seiten nach Seitennummer merken: dieselbe Seite kann unter verschiedenen Links auftauchen
  const seitenNr = (url) => new URL(url).searchParams.get('tx_news_pi1[currentPage]') ?? '1';
  const bekannt = new Set(bisherige?.map((a) => a.url));
  const offen = [erste];
  const besucht = new Set();
  const artikel = new Map();
  while (offen.length && besucht.size < MAX_SEITEN && artikel.size < MAX_ARTIKEL) {
    const url = offen.shift();
    if (besucht.has(seitenNr(url))) continue;
    besucht.add(seitenNr(url));
    const { artikel: a, seiten } = listeParsen(await holen(url));
    for (const x of a) if (!artikel.has(x.url)) artikel.set(x.url, x);
    if (bisherige && a.length && a.every((x) => bekannt.has(x.url))) {
      for (const x of bisherige) if (!artikel.has(x.url)) artikel.set(x.url, x);
      break;
    }
    for (const s of seiten) if (!besucht.has(seitenNr(s))) offen.push(s);
  }
  return [...artikel.values()];
}

async function abrufen(db, profilId, holen, neu) {
  const cache = listenCache.get(profilId);
  let liste = cache?.artikel;
  if (!cache || neu || Date.now() - cache.zeit >= LISTE_GUELTIG_MS) {
    liste = await listeHolen(profilId, holen, cache?.artikel);
    listenCache.set(profilId, { zeit: Date.now(), artikel: liste });
    if (listenCache.size > 500) listenCache.delete(listenCache.keys().next().value);
  }

  const lesen = db.prepare('select * from artikel where url = ?');
  const schreiben = db.prepare(`insert into artikel (url, titel, datum, ressort, region, kategorie, geholt_am)
    values (?, ?, ?, ?, ?, ?, ?) on conflict(url) do update set titel = excluded.titel, datum = excluded.datum,
    ressort = excluded.ressort, region = excluded.region, kategorie = excluded.kategorie, geholt_am = excluded.geholt_am`);
  const details = new Map();
  const fehlend = [];
  for (const a of liste) {
    const z = lesen.get(a.url);
    if (z?.datum) details.set(a.url, z);
    else fehlend.push(a);
  }
  await nacheinander(fehlend, GLEICHZEITIG, async (a) => {
    try {
      const d = artikelParsen(await holen(a.url));
      if (!d?.datum) return;
      schreiben.run(a.url, d.titel || a.titel, d.datum, d.ressort || a.ressort, d.region, d.kategorie, new Date().toISOString());
      details.set(a.url, d);
    } catch {
      // einzelne Artikelseite nicht erreichbar: Artikel trotzdem anzeigen, beim nächsten Mal erneut versuchen
    }
  });

  return liste.map((a) => {
    const d = details.get(a.url) ?? {};
    return {
      url: a.url,
      titel: d.titel || a.titel,
      datum: d.datum ?? '',
      ressort: d.ressort || a.ressort,
      region: d.region ?? '',
      kategorie: d.kategorie ?? '',
    };
  }).sort((x, y) => (y.datum || '').localeCompare(x.datum || '')); // ohne Datum ans Ende
}

/**
 * Alle Artikel eines Profils, neueste zuerst: { url, titel, datum, ressort, region, kategorie }.
 * Beim ersten Mal werden alle Artikelseiten gelesen (dauert je nach Anzahl etwas), danach kommen
 * Datum und Kategorie aus der Datenbank. neu = true: Liste sofort auf neue Artikel prüfen.
 * Wirft, wenn campus-a-college.at nicht erreichbar ist.
 */
export function artikelVonProfil(db, profilId, { holen = standardHolen, neu = false } = {}) {
  if (!laufend.has(profilId)) {
    laufend.set(profilId, abrufen(db, profilId, holen, neu).finally(() => laufend.delete(profilId)));
  }
  return laufend.get(profilId);
}
