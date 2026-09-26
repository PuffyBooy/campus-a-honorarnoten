// Formatierung, Beschriftungen und kleine Helfer

export const STATUS_LABEL = {
  eingereicht: 'Eingereicht',
  angenommen: 'Angenommen',
  abgelehnt: 'Abgelehnt',
  bezahlt: 'Bezahlt',
};

export const ART_LABEL = {
  artikel: 'Artikel',
  kommentar: 'Kommentar',
  foto: 'Foto',
  video: 'Video',
  sonstiges: 'Sonstiges',
};

export const KATEGORIE_LABEL = {
  kolumne: 'Kolumne',
  ausserordentlich: 'Außerordentliches Honorar',
};

export const ROLLEN_LABEL = {
  autor: 'Autor:in',
  redaktion: 'Redaktion',
  buchhaltung: 'Buchhaltung',
  admin: 'Admin',
};

export const AKTION_LABEL = {
  eingereicht: 'Eingereicht',
  angenommen: 'Angenommen',
  abgelehnt: 'Abgelehnt',
  betrag_korrigiert: 'Betrag korrigiert',
  kommentar: 'Interner Kommentar',
  bezahlt: 'Als bezahlt markiert',
  zurueckgeholt: 'Leistungen zur Überarbeitung zurückgeholt',
};

const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

/** "2026-09" oder "2026-09-25" -> "September 2026" */
export function formatMonat(iso) {
  if (!iso) return '';
  const [j, m] = String(iso).split('-');
  return `${MONATE[Number(m) - 1]} ${j}`;
}

const eur = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
const zahl = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/** 1234.5 -> "€ 1.234,50" */
export function formatEuro(betrag) {
  return eur.format(Number(betrag));
}

/** 1234.5 -> "1234,50" (für Banking-Apps und CSV) */
export function formatBetragPlain(betrag) {
  return zahl.format(Number(betrag));
}

/** 1234.5 -> "1.234,50" (für die Honorarnote) */
export function formatBetragDokument(betrag) {
  const [ganz, komma] = Number(betrag).toFixed(2).split('.');
  return `${ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${komma}`;
}

/** "2026-09-01" -> "01.09.2026" */
export function formatDatum(iso) {
  if (!iso) return '';
  const [j, m, t] = String(iso).slice(0, 10).split('-');
  return `${t}.${m}.${j}`;
}

/** Zeitstempel -> "01.09.2026, 14:03" (Wiener Zeit) */
export function formatZeitpunkt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-AT', {
    timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Summe der Positionsbeträge, cent-genau */
export function summe(positionen) {
  return Math.round(positionen.reduce((s, p) => s + Math.round(Number(p.betrag) * 100), 0)) / 100;
}

/** Heutiges Datum in Wien als "JJJJ-MM-TT" */
export function heuteIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date());
}

/**
 * Betragseingabe parsen: "120", "120,5", "1.234,56", "1234.56" -> Zahl.
 * Liefert null bei ungültiger Eingabe.
 */
export function parseBetrag(eingabe) {
  let s = String(eingabe ?? '').replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    // deutsches Format: Punkte sind Tausendertrenner
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Verwendungszweck, max. 140 Zeichen (SEPA-Grenze) */
export function verwendungszweck(nummer, zusatz) {
  const z = String(zusatz ?? '').replace(/\s+/g, ' ').trim();
  const text = z ? `Honorar ${nummer} - ${z}` : `Honorar ${nummer}`;
  return text.length > 140 ? text.slice(0, 139) + '…' : text;
}

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Für alle Nutzereingaben in HTML-Templates verwenden! */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

/**
 * „Art“ einer Leistung für die Anzeige: bei Kolumnen die Art der Kolumne, sonst die Art des
 * Honorars (freier Text; ältere Einträge mit festen Werten wie „foto“ werden schön benannt).
 */
export function artText(p) {
  return p.kategorie === 'kolumne' ? (p.kolumnenart ?? '') : (ART_LABEL[p.art] ?? p.art ?? '');
}

/** Freitext für Art der Kolumne / Art des Honorars: Leerraum zusammenfassen, max. 100 Zeichen */
export function artNormalisieren(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function vollerName(note) {
  return `${note.vorname ?? ''} ${note.nachname ?? ''}`.trim();
}
