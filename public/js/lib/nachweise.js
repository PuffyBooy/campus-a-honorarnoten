// Nachweise zum Redigieren (PDF, Word …): Anzeige, Hochladen und Herunterladen – gemeinsam für alle Ansichten
import { esc } from './format.js';
import { downloadBlob } from './csv.js';

export const NACHWEIS_ENDUNGEN = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'png', 'jpg', 'jpeg'];
export const NACHWEIS_MAX_MB = 5;
export const NACHWEISE_PRO_LEISTUNG = 5;
export const NACHWEIS_ACCEPT = NACHWEIS_ENDUNGEN.map((e) => `.${e}`).join(',');

const groesseText = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/** Liste der Nachweise einer Leistung als Knöpfe zum Herunterladen (loeschen: mit „Entfernen“) */
export function nachweiseHtml(p, { loeschen = false } = {}) {
  if (!p?.nachweise?.length) return '';
  return `<ul class="nachweise">${p.nachweise.map((d) => `
    <li><button type="button" class="link-knopf" data-nachweis="${esc(d.id)}" title="Herunterladen">📎 ${esc(d.name)}</button>
      <span class="klein">${esc(groesseText(d.groesse))}</span>
      ${loeschen ? `<button type="button" class="btn btn-klein" data-nachweis-loeschen="${esc(d.id)}">Entfernen</button>` : ''}</li>`).join('')}
  </ul>`;
}

/** Datei prüfen (Endung, Größe); liefert eine Fehlermeldung oder '' */
export function nachweisFehler(datei) {
  const endung = datei.name.split('.').pop().toLowerCase();
  if (!NACHWEIS_ENDUNGEN.includes(endung)) return `„${datei.name}“ geht nicht. Erlaubt sind PDF, Word, odt, rtf, txt, Excel, ods, png und jpg.`;
  if (datei.size > NACHWEIS_MAX_MB * 1024 * 1024) return `„${datei.name}“ ist zu groß (höchstens ${NACHWEIS_MAX_MB} MB).`;
  return '';
}

function alsBase64(datei) {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => fehler(new Error(`„${datei.name}“ konnte nicht gelesen werden.`));
    r.readAsDataURL(datei);
  });
}

/** Dateien nacheinander an eine Leistung hängen */
export async function nachweiseHochladen(store, positionId, dateien) {
  for (const d of dateien) await store.nachweisHochladen(positionId, d.name, await alsBase64(d));
}

export async function nachweisHerunterladen(store, id) {
  const r = await store.nachweisLaden(id);
  downloadBlob(r.name, new Blob([Uint8Array.from(atob(r.inhalt), (c) => c.charCodeAt(0))], { type: r.typ }));
}
