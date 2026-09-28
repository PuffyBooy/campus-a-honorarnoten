// CSV-Export (Semikolon, UTF-8 mit BOM – öffnet sauber in Excel mit deutschem Gebietsschema)

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
