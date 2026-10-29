// Viele Dateien auf einmal ablegen: direkt in einen Ordner (Chrome, Edge – Datei-System-Zugriff) oder,
// wo das nicht geht, als ZIP mit derselben Ordnerstruktur.
import JSZip from '../../vendor/jszip.mjs';
import { honorarnoteDocx, docxDateiname } from './honorarnote-docx.js';
import { honorarnotenPdfBytes } from './beleg.js';
import { downloadBlob } from './csv.js';

/** Kann der Browser direkt in einen Ordner schreiben? */
export const kannOrdner = () => typeof window.showDirectoryPicker === 'function';

/** Datei- und Ordnernamen ohne Zeichen, die Windows oder macOS nicht mögen */
export const sauber = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ohne Namen';

/** Eine Abrechnung als Datei: PDF (wie die Buchhaltung sie bekommt) oder Word (aus der Vorlage) */
export async function abrechnungDatei(note, format) {
  if (format === 'word') return { name: docxDateiname(note), blob: await honorarnoteDocx(note, { JSZip }) };
  return { name: `Praemienabrechnung_${note.nummer}.pdf`, blob: new Blob([await honorarnotenPdfBytes([note])], { type: 'application/pdf' }) };
}

/**
 * Ziel wählen – muss direkt nach dem Klick passieren (der Browser fragt nach dem Ordner).
 * Liefert ein Ziel mit schreiben(pfad, blob) und fertig(), oder null bei Abbruch.
 */
export async function zielWaehlen(name) {
  if (kannOrdner()) {
    let wurzel;
    try {
      wurzel = await window.showDirectoryPicker({ id: 'praemienabrechnungen', mode: 'readwrite' });
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
    const basis = await wurzel.getDirectoryHandle(sauber(name), { create: true });
    return {
      art: 'ordner',
      async schreiben(pfad, blob) {
        const teile = pfad.split('/').map(sauber);
        let ordner = basis;
        for (const t of teile.slice(0, -1)) ordner = await ordner.getDirectoryHandle(t, { create: true });
        const datei = await (await ordner.getFileHandle(teile.at(-1), { create: true })).createWritable();
        await datei.write(blob);
        await datei.close();
      },
      async fertig() {},
    };
  }
  const zip = new JSZip();
  const ordner = zip.folder(sauber(name));
  return {
    art: 'zip',
    async schreiben(pfad, blob) { ordner.file(pfad.split('/').map(sauber).join('/'), blob); },
    async fertig() { downloadBlob(`${sauber(name)}.zip`, await zip.generateAsync({ type: 'blob' })); },
  };
}
