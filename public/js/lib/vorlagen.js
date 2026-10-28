// Vorlagen für Rückgabegründe der Redaktion (ein Klick füllt die Begründung). Der Admin kann sie ändern.
export const STANDARD_RUECKGABE = [
  'Der Artikel ist noch nicht erschienen. Bitte erst nach der Veröffentlichung abrechnen.',
  'Der Betrag war so nicht vereinbart. Bitte mit dem vereinbarten Betrag neu einreichen.',
  'Diese Leistung wurde schon in einer anderen Abrechnung abgerechnet.',
  'Bitte den Link zum Artikel ergänzen.',
  'Die Leistung gehört in einen anderen Abrechnungsmonat.',
];

/** Liste säubern: nur Text, ohne Leere, höchstens 15 Einträge zu je 300 Zeichen; ohne Angabe die Standardvorlagen */
export function vorlagenNormalisieren(liste) {
  if (!Array.isArray(liste)) return [...STANDARD_RUECKGABE];
  return liste.map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean).slice(0, 15);
}
