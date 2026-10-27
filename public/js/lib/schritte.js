// Weg einer Prämienabrechnung für die Autor:in: Eingereicht → In Prüfung/Angenommen → Bezahlt
import { esc, formatDatum } from './format.js';
import { kalenderwoche, wienerDatum } from './woche.js';

// Tag in Wiener Zeit, ohne Jahr: "30.09."
const tag = (wert) => (wert ? formatDatum(wienerDatum(wert)).slice(0, 6) : '');

/** Schritte als { text, art: 'erledigt' | 'jetzt' | 'offen' | 'fehler' } */
export function schritte(n) {
  const eingereicht = { text: `Eingereicht ${tag(n.eingereicht_am)}`, art: 'erledigt' };
  if (n.status === 'abgelehnt') {
    return [eingereicht, { text: `Zurückgegeben ${tag(n.entschieden_am)}`, art: 'fehler' }];
  }
  if (n.status === 'eingereicht') {
    return [eingereicht, { text: 'In Prüfung', art: 'jetzt' }, { text: 'Angenommen', art: 'offen' }, { text: 'Bezahlt', art: 'offen' }];
  }
  const angenommen = { text: `Angenommen ${tag(n.entschieden_am)}`, art: 'erledigt' };
  if (n.status === 'angenommen') {
    const w = kalenderwoche(n.entschieden_am ?? n.eingereicht_am);
    return [eingereicht, angenommen, { text: `Auszahlung KW ${w.kw}`, art: 'jetzt' }, { text: 'Bezahlt', art: 'offen' }];
  }
  return [eingereicht, angenommen, { text: `Bezahlt ${tag(n.bezahlt_am)}`, art: 'erledigt' }];
}

export function schritteHtml(n) {
  return `<ol class="schritte" aria-label="Verlauf">${schritte(n).map((s) => `
    <li class="schritt-${s.art}"${s.art === 'jetzt' ? ' aria-current="step"' : ''}>${esc(s.text)}</li>`).join('')}</ol>`;
}

/** Kann die Autor:in die Abrechnung noch zurückziehen? (nur bevor die Redaktion sie annimmt) */
export const kannZurueckziehen = (n) => n.status === 'eingereicht';
