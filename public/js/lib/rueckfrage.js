// Rückfragen: kleiner Chat zwischen Redaktion und Autor:in zu einer Abrechnung – statt gleich zurückzugeben
import { esc, formatZeitpunkt } from './format.js';
import { fehlerText, mitSperre } from './ui.js';

/** Nachrichten als Sprechblasen (eigene rechts) */
export function nachrichtenHtml(nachrichten) {
  if (!nachrichten.length) return '<p class="klein chat-leer">Noch keine Nachrichten.</p>';
  return nachrichten.map((m) => `
    <div class="chat-nachricht${m.ich ? ' chat-ich' : ''}${m.von_redaktion ? ' chat-redaktion' : ''}">
      <div class="chat-kopf">${esc(m.ich ? 'Du' : m.von_name)}${m.von_redaktion && !m.ich ? ' <span class="klein">(Redaktion)</span>' : ''}
        · <span class="klein">${esc(formatZeitpunkt(m.am))}</span></div>
      <div class="chat-text">${esc(m.text)}</div>
    </div>`).join('');
}

/**
 * Chat in ein Element zeichnen und binden. rolle: 'redaktion' (fragt nach) oder 'autor' (antwortet).
 * Solange der Chat zu sehen ist, kommen neue Nachrichten alle 30 Sekunden von selbst dazu.
 */
export async function chatAnzeigen(box, { store, note, rolle, nachAenderung = () => {} }) {
  const offen = ['eingereicht', 'angenommen'].includes(note.status);
  let nachrichten = await store.nachrichten(note.id);
  const kannSchreiben = offen && (rolle === 'redaktion' || nachrichten.length > 0);
  box.innerHTML = `
    <div class="chat-verlauf" aria-live="polite">${nachrichtenHtml(nachrichten)}</div>
    ${kannSchreiben ? `<form class="chat-form" novalidate>
      <label class="sr-only" for="chat-${esc(note.id)}">${rolle === 'redaktion' ? 'Rückfrage' : 'Antwort'}</label>
      <textarea id="chat-${esc(note.id)}" name="text" rows="2" maxlength="2000"
        placeholder="${rolle === 'redaktion' ? 'Was ist unklar? z. B. „Welcher Artikel ist mit Interview gemeint?“' : 'Deine Antwort an die Redaktion …'}"></textarea>
      <p class="feldfehler" role="alert"></p>
      <div class="aktionen eng"><button type="submit" class="btn btn-klein btn-primaer">${rolle === 'redaktion' ? 'Nachfragen' : 'Antworten'}</button>
        <span class="klein">Strg + Enter schickt ab</span></div>
    </form>` : ''}`;
  const verlauf = box.querySelector('.chat-verlauf');
  const zeichnen = () => { verlauf.innerHTML = nachrichtenHtml(nachrichten); verlauf.scrollTop = verlauf.scrollHeight; };
  zeichnen();

  const form = box.querySelector('.chat-form');
  form?.text.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); form.requestSubmit(); }
  });
  form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    fehler.textContent = '';
    if (!form.text.value.trim()) { fehler.textContent = 'Bitte etwas schreiben.'; return; }
    mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        if (rolle === 'redaktion') await store.nachfragen(note.id, form.text.value);
        else await store.rueckfrageBeantworten(note.id, form.text.value);
        form.text.value = '';
        nachrichten = await store.nachrichten(note.id);
        zeichnen();
        nachAenderung();
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });

  // neue Nachrichten von der anderen Seite: nachladen, solange der Chat angezeigt wird
  const t = setInterval(async () => {
    if (!box.isConnected) { clearInterval(t); return; }
    if (document.hidden) return;
    try {
      const neu = await store.nachrichten(note.id);
      if (neu.length !== nachrichten.length) { nachrichten = neu; zeichnen(); }
    } catch { /* beim nächsten Mal */ }
  }, 30000);
}
