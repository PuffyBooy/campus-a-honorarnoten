// Impressum und Datenschutzerklärung – für alle lesbar, auch ohne Anmeldung
import { datenschutzHtml, impressumHtml } from '../lib/rechtliches.js';

export async function render(el, { store, istDemo, seite, angemeldet }) {
  const r = await store.rechtliches();
  el.innerHTML = `
    <article class="karte rechtliches">
      ${seite === 'impressum' ? impressumHtml(r, { istDemo }) : datenschutzHtml(r, { istDemo })}
      <p class="abstand-oben"><a href="#/">${angemeldet ? 'Zurück zur App' : 'Zur Anmeldung'}</a>
        · <a href="#/${seite === 'impressum' ? 'datenschutz' : 'impressum'}">${seite === 'impressum' ? 'Datenschutzerklärung' : 'Impressum'}</a></p>
    </article>`;
}
