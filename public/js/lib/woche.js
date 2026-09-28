// Kalenderwochen (ISO 8601, Woche beginnt am Montag) für die wöchentliche Auszahlung

const TAG_MS = 86400000;

/** Datum in Wien als "JJJJ-MM-TT" – aus "JJJJ-MM-TT", einem ISO-Zeitstempel, Date oder Millisekunden */
export function wienerDatum(wert) {
  if (typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert)) return wert;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date(wert));
}

const utc = (iso) => {
  const [j, m, t] = iso.split('-').map(Number);
  return Date.UTC(j, m - 1, t);
};
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Kalenderwoche eines Datums: { schluessel: '2026-W40', jahr: 2026, kw: 40, montag, sonntag }.
 * Das Jahr ist das der Kalenderwoche (der 29.12.2025 liegt z. B. in KW 1/2026).
 */
export function kalenderwoche(wert) {
  const tag = utc(wienerDatum(wert));
  const wochentag = (new Date(tag).getUTCDay() + 6) % 7; // Montag = 0
  const montag = tag - wochentag * TAG_MS;
  const donnerstag = montag + 3 * TAG_MS;
  const jahr = new Date(donnerstag).getUTCFullYear();
  const kw = 1 + Math.floor((donnerstag - Date.UTC(jahr, 0, 1)) / (7 * TAG_MS));
  return { schluessel: `${jahr}-W${String(kw).padStart(2, '0')}`, jahr, kw, montag: iso(montag), sonntag: iso(montag + 6 * TAG_MS) };
}

/** "KW 40 · 28.09.–04.10.2026" */
export function wocheText(w) {
  const [mj, mm, mt] = w.montag.split('-');
  const [sj, sm, st] = w.sonntag.split('-');
  const von = mj === sj ? `${mt}.${mm}.` : `${mt}.${mm}.${mj}`;
  return `KW ${w.kw} · ${von}–${st}.${sm}.${sj}`;
}

/**
 * Noten nach Kalenderwoche gruppieren: [{ woche, noten }], älteste Woche zuerst.
 * datum(note) liefert das Datum, nach dem gruppiert wird.
 */
export function nachWoche(noten, datum) {
  const gruppen = new Map();
  for (const n of noten) {
    const w = kalenderwoche(datum(n));
    if (!gruppen.has(w.schluessel)) gruppen.set(w.schluessel, { woche: w, noten: [] });
    gruppen.get(w.schluessel).noten.push(n);
  }
  return [...gruppen.values()].sort((a, b) => a.woche.montag.localeCompare(b.woche.montag));
}
