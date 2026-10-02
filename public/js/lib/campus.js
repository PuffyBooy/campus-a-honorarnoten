// Die beiden Medien – campus a college (Schüler*innenzeitung) und campus a (Studentenmagazin) –
// und die Verknüpfung mit den Artikeln auf ihren Webseiten (gemeinsam für Browser und Server).
// Beide Seiten laufen auf demselben System, haben aber eigene Profile und Artikel-Adressen.
import { esc } from './format.js';

export const MEDIEN = {
  college: {
    name: 'campus a college',
    seite: 'campus-a-college.at',
    basis: 'https://www.campus-a-college.at',
    profilLink: /^(?:https?:\/\/)?(?:www\.)?campus-a-college\.at\/profil\/([0-9a-fA-F]+)\/?(?:[?#].*)?$/,
    artikel: /^https:\/\/www\.campus-a-college\.at\/news\/detail\/[a-z0-9-]{1,250}$/,
  },
  'campus-a': {
    name: 'campus a',
    seite: 'campus-a.at',
    basis: 'https://campus-a.at',
    profilLink: /^(?:https?:\/\/)?(?:www\.)?campus-a\.at\/profil\/([0-9a-fA-F]+)\/?(?:[?#].*)?$/,
    artikel: /^https:\/\/campus-a\.at\/news\/news-detail\/[a-z0-9-]{1,250}$/,
  },
};
export const MEDIUM_KEYS = Object.keys(MEDIEN);
export const STANDARD_MEDIUM = 'college';

/** Gültiges Medium oder das Standardmedium (ältere Einträge haben noch keins) */
export const mediumOder = (m) => (Object.hasOwn(MEDIEN, m ?? '') ? m : STANDARD_MEDIUM);
export const istMedium = (m) => Object.hasOwn(MEDIEN, m ?? '');
export const mediumName = (m) => MEDIEN[mediumOder(m)].name;

// Feld im Profil, in dem die Profil-ID der jeweiligen Seite steht
export const PROFIL_FELD = { college: 'campus_profil', 'campus-a': 'campus_a_profil' };

const PROFIL_ID = /^[0-9a-f]{12,40}$/;

/**
 * Profil-ID aus dem Profil-Link der Seite des Mediums, z. B.
 * „https://www.campus-a-college.at/profil/ae1054937a1ae033e117“ -> „ae1054937a1ae033e117“.
 * Leere Eingabe -> '' (keine Verknüpfung), ungültige Eingabe oder Link der anderen Seite -> null.
 */
export function profilIdAusLink(text, medium = STANDARD_MEDIUM) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const m = t.match(MEDIEN[mediumOder(medium)].profilLink);
  if (!m && t.includes('/')) return null;
  const kandidat = (m ? m[1] : t).toLowerCase();
  return PROFIL_ID.test(kandidat) ? kandidat : null;
}

export const profilLink = (profilId, medium = STANDARD_MEDIUM) =>
  (profilId ? `${MEDIEN[mediumOder(medium)].basis}/profil/${profilId}` : '');

/** Medium einer Artikel-Adresse, oder null, wenn es keine echte Artikel-Adresse ist */
export function mediumVonArtikel(url) {
  const s = String(url ?? '');
  return MEDIUM_KEYS.find((m) => MEDIEN[m].artikel.test(s)) ?? null;
}

/** Nur echte Artikel-Adressen von campus-a-college.at und campus-a.at zählen als Verknüpfung */
export const artikelUrlGueltig = (url) => mediumVonArtikel(url) !== null;

const DEMO_ARTIKEL = 'demo:';

/** Hat die Leistung einen Artikel zum Anschauen? (auch Beispielartikel der Demo) */
export const hatArtikel = (url) => artikelUrlGueltig(url) || String(url ?? '').startsWith(DEMO_ARTIKEL);

/**
 * HTML-Link zum Artikel, öffnet in einem neuen Tab. Beispielartikel der Demo gibt es nicht wirklich,
 * ihr Link führt zur Startseite des Mediums. Ohne Artikel nur der Text.
 */
export function artikelLink(url, text = 'Artikel ansehen', klasse = '', medium = STANDARD_MEDIUM) {
  if (!hatArtikel(url)) return esc(text);
  const echt = mediumVonArtikel(url);
  const m = MEDIEN[echt ?? mediumOder(medium)];
  const ziel = echt ? url : `${m.basis}/`;
  const titel = echt ? `Artikel auf ${m.seite} öffnen (neuer Tab)` : `Demo: Beispielartikel – der Link führt zur Startseite von ${m.seite}`;
  return `<a href="${esc(ziel)}" target="_blank" rel="noopener noreferrer"${klasse ? ` class="${esc(klasse)}"` : ''} title="${esc(titel)}">${esc(text)}</a>`;
}

/** Suche auf der Seite des Mediums nach einem Titel */
export const artikelSuche = (titel, medium = STANDARD_MEDIUM) =>
  `${MEDIEN[mediumOder(medium)].basis}/suchergebnisse?tx_solr%5Bq%5D=${encodeURIComponent(String(titel ?? '').trim())}`;

/**
 * Titel einer Leistung, immer klickbar (neuer Tab): verknüpfter Artikel direkt, sonst die Suche
 * nach dem Titel auf der Seite des Mediums.
 */
export function titelLink(url, titel, klasse = 'artikel-titel', medium = STANDARD_MEDIUM) {
  if (hatArtikel(url)) return artikelLink(url, titel, klasse, medium);
  const m = MEDIEN[mediumOder(medium)];
  return `<a href="${esc(artikelSuche(titel, medium))}" target="_blank" rel="noopener noreferrer" class="${esc(klasse)}"`
    + ` title="Nicht verknüpft – auf ${esc(m.seite)} nach diesem Titel suchen (neuer Tab)">${esc(titel)}</a>`;
}

/** Badge mit dem Namen des Mediums */
export const mediumBadge = (m) => `<span class="badge badge-medium badge-${esc(mediumOder(m))}">${esc(mediumName(m))}</span>`;
