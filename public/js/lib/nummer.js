// Nummer der Prämienabrechnung laut Vorlage:
// NACHNAME-Initialen des Vornamens-Jahr-laufende Nummer, z. B. MUSTERFRAU-MA-2026-01
// Die laufende Nummer zählt die eigenen Prämienabrechnungen im Jahr, beginnend bei 01.

const ERSETZEN = { Ä: 'AE', Ö: 'OE', Ü: 'UE', ß: 'SS', ẞ: 'SS' };

/** Großbuchstaben, Umlaute ausgeschrieben, nur A–Z (Bindestriche zwischen Namensteilen bleiben) */
export function namensteil(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[ÄÖÜßẞ]/g, (c) => ERSETZEN[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function initialen(vorname) {
  return namensteil(vorname).replace(/-/g, '').slice(0, 2) || 'XX';
}

export function honorarnoteNummer({ vorname, nachname, jahr, laufendeNummer }) {
  return `${namensteil(nachname) || 'NACHNAME'}-${initialen(vorname)}-${jahr}-${String(laufendeNummer).padStart(2, '0')}`;
}
