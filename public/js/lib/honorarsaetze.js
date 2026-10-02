// Standard-Honorarsätze pro Medium und Kategorie (vom Admin einstellbar).
// null = kein Standardsatz, der Betrag wird individuell vereinbart.
// Redigieren gibt es nur bei campus a college; der Satz gilt pro redigiertem Text.
import { MEDIUM_KEYS, mediumOder } from './campus.js';

const KATEGORIEN = { college: ['kolumne', 'ausserordentlich', 'redigieren'], 'campus-a': ['kolumne', 'ausserordentlich'] };
const STANDARD = { kolumne: 15, ausserordentlich: null, redigieren: 2 };
export const STANDARD_SAETZE = Object.fromEntries(MEDIUM_KEYS.map((m) =>
  [m, Object.fromEntries(KATEGORIEN[m].map((k) => [k, STANDARD[k]]))]));

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
 * Prüft und normalisiert die Sätze: { college: { kolumne, ausserordentlich, redigieren }, 'campus-a': { … } }.
 * Ältere Einstellungen ohne Medium ({ kolumne, ausserordentlich }) gelten für beide Medien.
 * Ohne Satz fürs Redigieren gilt der Standard (2 € pro Text). Wirft bei ungültigen Werten.
 */
export function saetzeNormalisieren(saetze = {}) {
  const flach = ['kolumne', 'ausserordentlich'].some((k) => Object.hasOwn(saetze ?? {}, k));
  return Object.fromEntries(MEDIUM_KEYS.map((m) => {
    const quelle = (flach ? saetze : saetze?.[m]) ?? STANDARD_SAETZE[m];
    return [m, Object.fromEntries(KATEGORIEN[m].map((k) => {
      const satz = satzPruefen(quelle[k]);
      return [k, k === 'redigieren' && satz == null ? STANDARD.redigieren : satz];
    }))];
  }));
}

/** Standardsatz für ein Medium und eine Kategorie (oder null) */
export function satzFuer(saetze, medium, kategorie) {
  const s = saetze?.[mediumOder(medium)] ?? (saetze && Object.hasOwn(saetze, kategorie) ? saetze : null);
  return s?.[kategorie] ?? null;
}

/** Erwarteter Betrag laut Standardsatz (Redigieren: Satz × Anzahl Texte) oder null */
export function standardBetrag(saetze, position) {
  const satz = satzFuer(saetze, position.medium, position.kategorie);
  if (satz == null) return null;
  return position.kategorie === 'redigieren' ? Math.round(satz * 100 * (Number(position.anzahl) || 0)) / 100 : satz;
}

/** Weicht der eingereichte Betrag vom Standardsatz ab? */
export function weichtAb(position, saetze) {
  const soll = standardBetrag(saetze, position);
  const betrag = position.betrag_eingereicht ?? position.betrag;
  return soll != null && Math.round(Number(betrag) * 100) !== Math.round(soll * 100);
}
