// Viele Dateien auf einmal ablegen: direkt in einen Ordner (Chrome, Edge – Datei-System-Zugriff) oder,
// wo das nicht geht, als ZIP mit derselben Ordnerstruktur.
import JSZip from '../../vendor/jszip.mjs';
import { honorarnoteDocx, docxDateiname } from './honorarnote-docx.js';
import { honorarnotenPdfBytes } from './beleg.js';
import { downloadBlob } from './csv.js';
import { bestaetigen } from './ui.js';

/** Kann der Browser direkt in einen Ordner schreiben? */
export const kannOrdner = () => typeof window.showDirectoryPicker === 'function';

/** Datei- und Ordnernamen ohne Zeichen, die Windows oder macOS nicht mögen */
export const sauber = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ohne Namen';

const ascii = (s) => s.replace(/[äöüÄÖÜß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' })[c])
  .normalize('NFD').replace(/[^\x20-\x7e]/g, '');

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
    // Dateiname der ZIP ohne Umlaute – manche Browser nennen den Download sonst nur „download“
    async fertig() { downloadBlob(`${ascii(sauber(name))}.zip`, await zip.generateAsync({ type: 'blob' })); },
  };
}

/** Fragt Format und Nachweise ab. Liefert { format: 'pdf'|'word'|'beide', nachweise } oder null bei Abbruch. */
export async function ladenFragen(anzahl) {
  // Auswahl im Dialog mitlesen (der Dialog liefert nur ja/nein)
  const wahl = { format: 'pdf', nachweise: true };
  const mitlesen = (e) => {
    if (e.target.name === 'format') wahl.format = e.target.value;
    if (e.target.name === 'nachweise') wahl.nachweise = e.target.checked;
  };
  document.addEventListener('change', mitlesen);
  const ok = await bestaetigen({
    titel: `${anzahl} ${anzahl === 1 ? 'Abrechnung' : 'Abrechnungen'} herunterladen`,
    html: `<p>Jede Abrechnung als eigene Datei – geordnet nach <strong>Woche / Person</strong>.</p>
      <fieldset class="kategorie"><legend class="klein">Format</legend>
        <label class="radio"><input type="radio" name="format" value="pdf" checked> <span>PDF</span></label>
        <label class="radio"><input type="radio" name="format" value="word"> <span>Word</span></label>
        <label class="radio"><input type="radio" name="format" value="beide"> <span>PDF und Word</span></label></fieldset>
      <label class="check bestaetigen"><input type="checkbox" name="nachweise" checked> Nachweise mitnehmen (z. B. zum Redigieren)</label>
      <p class="klein">${kannOrdner() ? 'Als Nächstes wählst du den Ordner, in den die Dateien kommen.'
        : 'Dein Browser kann nicht direkt in einen Ordner speichern – du bekommst eine ZIP-Datei mit denselben Ordnern.'}</p>`,
    ja: kannOrdner() ? 'Ordner wählen …' : 'Herunterladen',
  });
  document.removeEventListener('change', mitlesen);
  return ok ? wahl : null;
}

/**
 * Schreibt jede Abrechnung (und auf Wunsch ihre Nachweise) als eigene Datei ins Ziel.
 * ordnerVon(note) gibt den Unterordner, fortschritt(i, gesamt) meldet den Stand. Liefert die Anzahl der Dateien.
 */
export async function einzelnSpeichern(store, ziel, noten, { format, nachweise }, ordnerVon, fortschritt = () => {}) {
  let dateien = 0;
  for (const [i, n] of noten.entries()) {
    fortschritt(i + 1, noten.length);
    const ordner = ordnerVon(n);
    for (const f of format === 'beide' ? ['pdf', 'word'] : [format]) {
      const d = await abrechnungDatei(n, f);
      await ziel.schreiben(`${ordner}/${d.name}`, d.blob);
      dateien++;
    }
    if (!nachweise) continue;
    for (const p of n.positionen) {
      for (const x of p.nachweise ?? []) {
        const r = await store.nachweisLaden(x.id);
        await ziel.schreiben(`${ordner}/${n.nummer} Nachweis - ${r.name}`,
          new Blob([Uint8Array.from(atob(r.inhalt), (c) => c.charCodeAt(0))], { type: r.typ }));
        dateien++;
      }
    }
  }
  await ziel.fertig();
  return dateien;
}
