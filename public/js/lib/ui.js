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
