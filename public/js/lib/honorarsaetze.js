// Standard-Honorarsätze pro Kategorie (vom Admin einstellbar).
// null = kein Standardsatz, der Betrag wird individuell vereinbart.
export const STANDARD_SAETZE = { kolumne: 15, ausserordentlich: null };

/** Prüft und normalisiert die Sätze; wirft bei ungültigen Werten */
export function saetzeNormalisieren(saetze = {}) {
  const ergebnis = {};
  for (const kategorie of Object.keys(STANDARD_SAETZE)) {
    const roh = saetze[kategorie];
    if (roh === null || roh === undefined || roh === '') {
      ergebnis[kategorie] = null;
      continue;
    }
    const b = Number(roh);
    const c = Math.round(b * 100);
    if (!Number.isFinite(b) || c <= 0 || c > 10000000 || Math.abs(b * 100 - c) > 1e-6) {
      throw new Error('Bitte gültige Honorarsätze angeben (z. B. 15 oder 15,50) oder das Feld leer lassen.');
    }
    ergebnis[kategorie] = c / 100;
  }
  return ergebnis;
}

/** Weicht der eingereichte Betrag vom Standardsatz ab? */
export function weichtAb(position, saetze) {
  const satz = saetze?.[position.kategorie];
  const betrag = position.betrag_eingereicht ?? position.betrag;
  return satz != null && Math.round(Number(betrag) * 100) !== Math.round(satz * 100);
}

/**
 * Liste der Kolumnenarten (vom Admin, eine pro Zeile).
 * Leere Liste = freies Textfeld beim Speichern einer Kolumne.
 */
export function kolumnenartenNormalisieren(liste) {
  const roh = Array.isArray(liste) ? liste : String(liste ?? '').split('\n');
  const ergebnis = [];
  for (const eintrag of roh) {
    const t = String(eintrag ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (t && !ergebnis.some((x) => x.toLowerCase() === t.toLowerCase())) ergebnis.push(t);
  }
  if (ergebnis.length > 50) throw new Error('Höchstens 50 Kolumnenarten möglich.');
  return ergebnis;
}
