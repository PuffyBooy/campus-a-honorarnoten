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
