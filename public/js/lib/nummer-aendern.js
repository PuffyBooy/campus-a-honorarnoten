// Nummerierung der Prämienabrechnungen: Wer schon vor der App welche geschrieben hat, trägt die letzte Nummer
// des Jahres ein – die App zählt von dort weiter (letzte 6 → nächste 7).
import { esc } from './format.js';
import { bestaetigen, fehlerText, meldung } from './ui.js';

/** dieselbe Nummer mit anderer laufender Nummer: „…-2026-05“ → „…-2026-06“ */
export const mitNummer = (nummer, lfd) => nummer.replace(/\d+$/, String(lfd).padStart(2, '0'));

/** Dialog „Nummer ändern“. Liefert die neue nächste Nummer ({ nummer, … }) oder null bei Abbruch. */
export async function nummerAendern(store, naechste) {
  const vorschau = (e) => {
    if (e.target.id !== 'dialog-eingabe') return;
    const v = Number(e.target.value);
    const ziel = document.getElementById('nummer-vorschau');
    if (ziel) ziel.textContent = Number.isInteger(v) && v >= 0 ? mitNummer(naechste.nummer, v + 1) : '–';
  };
  document.addEventListener('input', vorschau);
  const wert = await bestaetigen({
    titel: 'Nummer der Prämienabrechnung',
    html: `<p>Hast du ${esc(naechste.jahr)} schon Prämienabrechnungen geschrieben, bevor es die App gab?
        Dann trag die Nummer der letzten ein – die App zählt von dort weiter.</p>
      <p class="klein">Nächste Prämienabrechnung: <strong class="nummer" id="nummer-vorschau">${esc(naechste.nummer)}</strong></p>
      ${naechste.in_app ? `<p class="klein">In der App hast du ${esc(naechste.jahr)} schon bis Nummer ${esc(naechste.in_app)} eingereicht – kleiner geht nicht.</p>` : ''}`,
    eingabe: { label: `Letzte Nummer ${naechste.jahr}`, wert: String(naechste.bisher ?? 0), typ: 'number' },
    ja: 'Speichern',
  });
  document.removeEventListener('input', vorschau);
  if (wert === null) return null;
  try {
    const neu = await store.nummerFestlegen(Number(wert));
    meldung(`Gespeichert: Deine nächste Prämienabrechnung ist ${neu.nummer}.`, 'erfolg');
    return neu;
  } catch (e) {
    meldung(fehlerText(e), 'fehler');
    return null;
  }
}
