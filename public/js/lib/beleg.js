// Prämienabrechnungen herunterladen: einzeln als Word-Datei (aus der Vorlage) oder mehrere als ein PDF
import JSZip from '../../vendor/jszip.mjs';
import { honorarnoteDocx, docxDateiname } from './honorarnote-docx.js';
import { downloadBlob } from './csv.js';

export async function honorarnoteHerunterladen(note) {
  const blob = await honorarnoteDocx(note, { JSZip });
  downloadBlob(docxDateiname(note), blob);
}

/** Mehrere Prämienabrechnungen als ein PDF (jede Note ab einer neuen Seite), als Bytes */
export async function honorarnotenPdfBytes(noten) {
  const [PDFLib, { honorarnotenPdf }] = await Promise.all([
    import('../../vendor/pdf-lib.mjs'), import('./honorarnote-pdf.js'),
  ]);
  return honorarnotenPdf(noten, PDFLib);
}

/** Mehrere Prämienabrechnungen als ein PDF herunterladen */
export async function honorarnotenPdfHerunterladen(noten, dateiname) {
  downloadBlob(dateiname, new Blob([await honorarnotenPdfBytes(noten)], { type: 'application/pdf' }));
}

/** Jahresübersicht (alle Abrechnungen eines Jahres mit Summen) als PDF herunterladen */
export async function jahresuebersichtHerunterladen(alle, jahr, person) {
  const [PDFLib, { jahresuebersichtPdf }] = await Promise.all([
    import('../../vendor/pdf-lib.mjs'), import('./honorarnote-pdf.js'),
  ]);
  const bytes = await jahresuebersichtPdf(alle, jahr, person, PDFLib);
  downloadBlob(`Jahresuebersicht_${jahr}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
}

/** Bytes als base64 (in Stücken, damit große PDFs den Stapel nicht sprengen) */
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
