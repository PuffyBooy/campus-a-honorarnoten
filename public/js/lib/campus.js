// Verknüpfung mit den Artikeln auf campus-a-college.at (gemeinsam für Browser und Server)
import { esc } from './format.js';

export const CAMPUS_BASIS = 'https://www.campus-a-college.at';

const PROFIL_ID = /^[0-9a-f]{12,40}$/;
const ARTIKEL_URL = /^https:\/\/www\.campus-a-college\.at\/news\/detail\/[a-z0-9-]{1,250}$/;

/**
 * Profil-ID aus dem Profil-Link auf campus-a-college.at, z. B.
 * „https://www.campus-a-college.at/profil/ae1054937a1ae033e117“ -> „ae1054937a1ae033e117“.
 * Leere Eingabe -> '' (keine Verknüpfung), ungültige Eingabe -> null.
 */
export function profilIdAusLink(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?campus-a-college\.at\/profil\/([0-9a-fA-F]+)\/?(?:[?#].*)?$/);
  const kandidat = (m ? m[1] : t).toLowerCase();
  return PROFIL_ID.test(kandidat) ? kandidat : null;
}

export const profilLink = (profilId) => (profilId ? `${CAMPUS_BASIS}/profil/${profilId}` : '');

/** Nur echte Artikel-Adressen von campus-a-college.at zählen als Verknüpfung */
export const artikelUrlGueltig = (url) => ARTIKEL_URL.test(String(url ?? ''));

const DEMO_ARTIKEL = 'demo:';

/** Hat die Leistung einen Artikel zum Anschauen? (auch Beispielartikel der Demo) */
export const hatArtikel = (url) => artikelUrlGueltig(url) || String(url ?? '').startsWith(DEMO_ARTIKEL);

/**
 * HTML-Link zum Artikel, öffnet in einem neuen Tab. Beispielartikel der Demo gibt es nicht wirklich,
 * ihr Link führt zur Startseite von campus-a-college.at. Ohne Artikel nur der Text.
 */
export function artikelLink(url, text = 'Artikel ansehen', klasse = '') {
  if (!hatArtikel(url)) return esc(text);
  const echt = artikelUrlGueltig(url);
  const ziel = echt ? url : `${CAMPUS_BASIS}/`;
  const titel = echt ? 'Artikel auf campus-a-college.at öffnen (neuer Tab)' : 'Demo: Beispielartikel – der Link führt zur Startseite von campus-a-college.at';
  return `<a href="${esc(ziel)}" target="_blank" rel="noopener noreferrer"${klasse ? ` class="${esc(klasse)}"` : ''} title="${esc(titel)}">${esc(text)}</a>`;
}
