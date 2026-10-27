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

// Rollen, die der Admin vergeben kann. „Redigieren“ ist eine Zusatzberechtigung für campus a college und
// setzt „Autor:in“ voraus (abgerechnet wird über die eigenen Prämienabrechnungen, dafür braucht es Adresse und IBAN).
export const ROLLEN = ['autor', 'redaktion', 'buchhaltung', 'admin', 'redigieren'];

export function rollenNormalisieren(rollen) {
  const r = ROLLEN.filter((x) => Array.isArray(rollen) && rollen.includes(x));
  if (r.includes('redigieren') && !r.includes('autor')) r.unshift('autor');
  return r;
}

/** Darf Redigieren verrechnen (Rolle vom Admin) */
export const darfRedigieren = (n) => Boolean(n?.rollen?.includes('redigieren'));
