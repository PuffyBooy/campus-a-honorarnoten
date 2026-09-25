// Honorarnoten als Word-Datei herunterladen (einzeln oder mehrere als ZIP)
import JSZip from '../../vendor/jszip.mjs';
import { honorarnoteDocx, docxDateiname } from './honorarnote-docx.js';
import { downloadBlob } from './csv.js';

export async function honorarnoteHerunterladen(note) {
  const blob = await honorarnoteDocx(note, { JSZip });
  downloadBlob(docxDateiname(note), blob);
}

export async function honorarnotenAlsZip(noten, dateiname) {
  const vorlage = await (await fetch(new URL('../../vorlage/honorarnote-vorlage.docx', import.meta.url))).arrayBuffer();
  const zip = new JSZip();
  for (const n of noten) zip.file(docxDateiname(n), await honorarnoteDocx(n, { JSZip, vorlage }));
  downloadBlob(dateiname, await zip.generateAsync({ type: 'blob' }));
}
