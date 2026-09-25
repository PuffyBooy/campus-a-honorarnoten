// IBAN/BIC-Prüfung (gleiche Regeln wie public.iban_ist_gueltig in der Datenbank)

const LAENGEN = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22,
};

export function normalizeIban(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Liefert null, wenn gültig, sonst eine Fehlermeldung auf Deutsch. */
export function ibanFehler(value) {
  const s = normalizeIban(value);
  if (!s) return 'Bitte IBAN angeben.';
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return 'Die IBAN hat ein ungültiges Format.';
  const land = s.slice(0, 2);
  if (LAENGEN[land] && LAENGEN[land] !== s.length) {
    return `Eine IBAN aus ${land} hat ${LAENGEN[land]} Zeichen (eingegeben: ${s.length}).`;
  }
  const umgestellt = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of umgestellt) {
    const code = ch.charCodeAt(0);
    rest = code <= 57 ? (rest * 10 + (code - 48)) % 97 : (rest * 100 + (code - 55)) % 97;
  }
  return rest === 1 ? null : 'Die Prüfziffer der IBAN stimmt nicht – bitte Tippfehler prüfen.';
}

export function ibanIstGueltig(value) {
  return ibanFehler(value) === null;
}

/** "AT611904300234573201" -> "AT61 1904 3002 3457 3201" */
export function formatIban(value) {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, '$1 ');
}

export function normalizeBic(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function bicIstGueltig(value) {
  const s = normalizeBic(value);
  return s === '' || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s);
}
