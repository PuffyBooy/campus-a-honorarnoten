// CSV-Export (Semikolon, UTF-8 mit BOM – öffnet sauber in Excel mit deutschem Gebietsschema)

function feld(wert) {
  const s = String(wert ?? '');
  // Formel-Injection in Tabellenprogrammen verhindern
  const sicher = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}

export function toCsv(kopfzeile, zeilen) {
  return '﻿' + [kopfzeile, ...zeilen].map((z) => z.map(feld).join(';')).join('\r\n') + '\r\n';
}

export function downloadText(dateiname, text, mime = 'text/csv;charset=utf-8') {
  downloadBlob(dateiname, new Blob([text], { type: mime }));
}

export function downloadBlob(dateiname, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
