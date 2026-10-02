// Konto einrichten: Was braucht eine Autor:in, bevor sie Leistungen erfassen kann?
// (gemeinsam für Browser und Server)
import { ibanFehler } from './iban.js';
import { MEDIUM_KEYS, PROFIL_FELD } from './campus.js';

const leer = (s) => !String(s ?? '').trim();

/** Was fehlt noch? Leere Liste = Konto fertig eingerichtet. Nur Autor:innen brauchen diese Angaben. */
export function kontoFehlt(n) {
  if (!n?.rollen?.includes('autor')) return [];
  const p = n.profil ?? {};
  const fehlt = [];
  if (leer(p.strasse) || leer(p.plz_ort)) fehlt.push('Adresse');
  if (leer(p.kontoinhaber) || ibanFehler(p.iban)) fehlt.push('Bankverbindung');
  if (!MEDIUM_KEYS.some((m) => !leer(p[PROFIL_FELD[m]]))) fehlt.push('Profil-Link');
  return fehlt;
}

export const kontoFertig = (n) => kontoFehlt(n).length === 0;

export const KONTO_FEHLT = 'Bitte zuerst dein Konto einrichten (Adresse, Bankverbindung und Profil-Link).';
