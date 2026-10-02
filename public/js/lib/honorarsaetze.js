// Standard-Honorarsätze pro Medium und Kategorie (vom Admin einstellbar).
// null = kein Standardsatz, der Betrag wird individuell vereinbart.
import { MEDIUM_KEYS, mediumOder } from './campus.js';

const KATEGORIEN = ['kolumne', 'ausserordentlich'];
const STANDARD_PRO_MEDIUM = { kolumne: 15, ausserordentlich: null };
export const STANDARD_SAETZE = Object.fromEntries(MEDIUM_KEYS.map((m) => [m, { ...STANDARD_PRO_MEDIUM }]));

function satzPruefen(roh) {
  if (roh === null || roh === undefined || roh === '') return null;
  const b = Number(roh);
  const c = Math.round(b * 100);
  if (!Number.isFinite(b) || c <= 0 || c > 10000000 || Math.abs(b * 100 - c) > 1e-6) {
    throw new Error('Bitte gültige Honorarsätze angeben (z. B. 15 oder 15,50) oder das Feld leer lassen.');
  }
  return c / 100;
}

/**
 * Prüft und normalisiert die Sätze: { college: { kolumne, ausserordentlich }, 'campus-a': { … } }.
 * Ältere Einstellungen ohne Medium ({ kolumne, ausserordentlich }) gelten für beide Medien.
 * Wirft bei ungültigen Werten.
 */
export function saetzeNormalisieren(saetze = {}) {
  const flach = KATEGORIEN.some((k) => Object.hasOwn(saetze ?? {}, k));
  return Object.fromEntries(MEDIUM_KEYS.map((m) => {
    const quelle = (flach ? saetze : saetze?.[m]) ?? STANDARD_PRO_MEDIUM;
    return [m, Object.fromEntries(KATEGORIEN.map((k) => [k, satzPruefen(quelle[k])]))];
  }));
}

/** Standardsatz für ein Medium und eine Kategorie (oder null) */
export function satzFuer(saetze, medium, kategorie) {
  const s = saetze?.[mediumOder(medium)] ?? (saetze && Object.hasOwn(saetze, kategorie) ? saetze : null);
  return s?.[kategorie] ?? null;
}

/** Weicht der eingereichte Betrag vom Standardsatz ab? */
export function weichtAb(position, saetze) {
  const satz = satzFuer(saetze, position.medium, position.kategorie);
  const betrag = position.betrag_eingereicht ?? position.betrag;
  return satz != null && Math.round(Number(betrag) * 100) !== Math.round(satz * 100);
}
