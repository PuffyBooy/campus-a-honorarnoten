// UI-Helfer: Kopieren mit Feedback, Meldungen, Fehlertexte, Status-Badge

import { STATUS_LABEL, esc } from './format.js';

async function inZwischenablage(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback für ältere Browser / unsichere Kontexte
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'offscreen';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Kopieren nicht möglich');
  }
}

/** Kopiert und zeigt am Button kurz "Kopiert ✓" an. */
export async function kopierenMitFeedback(button, text) {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  try {
    await inZwischenablage(text);
    button.textContent = 'Kopiert ✓';
    button.classList.add('kopiert');
  } catch {
    button.textContent = 'Fehler';
  }
  clearTimeout(button._timer);
  button._timer = setTimeout(() => {
    button.textContent = original;
    button.classList.remove('kopiert');
  }, 1600);
}

export function meldung(text, typ = 'info') {
  const box = document.getElementById('meldungen');
  const el = document.createElement('div');
  el.className = `meldung meldung-${typ}`;
  el.setAttribute('role', typ === 'fehler' ? 'alert' : 'status');
  el.textContent = text;
  box.append(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => el.remove(), typ === 'fehler' ? 8000 : 4000);
}

export function fehlerText(error) {
  if (!error) return 'Unbekannter Fehler.';
  const msg = error.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'Datei konnte nicht geladen werden. Bitte Seite neu laden.';
  }
  return msg;
}

export function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(STATUS_LABEL[status] ?? status)}</span>`;
}

/** Button während einer Aktion sperren */
export async function mitSperre(button, fn) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function ladeAnzeige(el, text = 'Wird geladen …') {
  el.innerHTML = `<p class="laden" aria-live="polite">${esc(text)}</p>`;
}

/**
 * Bestätigungsdialog mit eigenem Inhalt (HTML, bereits maskiert). Liefert true, wenn bestätigt wurde.
 * Mit eingabe ({ label, wert, typ }): ein Eingabefeld; liefert dann den eingegebenen Text oder null.
 * Ohne <dialog>-Unterstützung: einfaches confirm() bzw. prompt() mit dem Titel.
 */
export function bestaetigen({ titel, html = '', ja = 'Bestätigen', nein = 'Abbrechen', gefahr = false, eingabe = null }) {
  const d = document.createElement('dialog');
  if (typeof d.showModal !== 'function') return Promise.resolve(eingabe ? prompt(titel, eingabe.wert ?? '') : confirm(titel));
  d.className = 'dialog';
  d.setAttribute('aria-labelledby', 'dialog-titel');
  d.innerHTML = `
    <form method="dialog">
      <h2 id="dialog-titel">${esc(titel)}</h2>
      <div class="dialog-inhalt">${html}${eingabe ? `
        <label for="dialog-eingabe">${esc(eingabe.label)}</label>
        <input id="dialog-eingabe" name="eingabe" type="${esc(eingabe.typ ?? 'text')}" value="${esc(eingabe.wert ?? '')}" autocomplete="off">` : ''}</div>
      <div class="aktionen dialog-aktionen">
        <button class="btn" value="nein" formnovalidate>${esc(nein)}</button>
        <button class="btn ${gefahr ? 'btn-gefahr' : 'btn-primaer'}" value="ja">${esc(ja)}</button>
      </div>
    </form>`;
  document.body.append(d);
  // Enter im Eingabefeld = bestätigen (sonst nimmt der Browser den ersten Knopf, und das ist „Abbrechen“)
  d.querySelector('[name=eingabe]')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); d.close('ja'); }
  });
  return new Promise((ok) => {
    d.addEventListener('close', () => {
      const bestaetigt = d.returnValue === 'ja';
      ok(eingabe ? (bestaetigt ? d.querySelector('[name=eingabe]').value.trim() || null : null) : bestaetigt);
      d.remove();
    });
    d.showModal();
    (d.querySelector('[name=eingabe]') ?? d.querySelector('[value=ja]')).focus();
  });
}
