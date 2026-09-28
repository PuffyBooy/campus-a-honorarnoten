// Honorarnoten herunterladen: einzeln als Word-Datei (aus der Vorlage) oder mehrere als ein PDF
import JSZip from '../../vendor/jszip.mjs';
import { honorarnoteDocx, docxDateiname } from './honorarnote-docx.js';
import { downloadBlob } from './csv.js';

export async function honorarnoteHerunterladen(note) {
  const blob = await honorarnoteDocx(note, { JSZip });
  downloadBlob(docxDateiname(note), blob);
}

/** Mehrere Honorarnoten als ein PDF herunterladen (jede Note ab einer neuen Seite) */
export async function honorarnotenPdfHerunterladen(noten, dateiname) {
  const [PDFLib, { honorarnotenPdf }] = await Promise.all([
    import('../../vendor/pdf-lib.mjs'), import('./honorarnote-pdf.js'),
  ]);
  const bytes = await honorarnotenPdf(noten, PDFLib);
  downloadBlob(dateiname, new Blob([bytes], { type: 'application/pdf' }));
}
