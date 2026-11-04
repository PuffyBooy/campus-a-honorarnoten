// Lesezeichen „＋1 redigiert“ (Safari, Firefox, iPhone …): öffnet aus dem CMS heraus ein kleines Fenster mit
// #/melden/<Artikel-Nummer>/<Titel>. Hier zählt die angemeldete Person den Artikel – jeder zählt pro Monat einmal.
// Danach schließt sich das Fenster von selbst.
import { esc } from '../lib/format.js';
import { fehlerText } from '../lib/ui.js';

export async function render(el, { store, params, istAktuell }) {
  const id = String(params.id ?? '');
  let titel = '';
  try { titel = decodeURIComponent(params.titel ?? ''); } catch { /* kaputt kodiert: ohne Titel */ }
  let s;
  try {
    s = await store.redigiertMelden(id, titel);
  } catch (e) {
    if (!istAktuell()) return;
    el.innerHTML = `<section class="karte schmal melden"><h1>Nicht gezählt</h1><p class="fehlerbox">${esc(fehlerText(e))}</p></section>`;
    return;
  }
  if (!istAktuell()) return;
  history.replaceState(null, '', '#/zaehlen'); // Neuladen zählt nicht nochmal
  el.innerHTML = `<section class="karte schmal melden" role="status">
      <p class="melden-symbol" aria-hidden="true">${s.neu ? '✓' : '＝'}</p>
      <h1>${s.neu ? 'Gezählt' : 'Schon gezählt'}</h1>
      ${titel ? `<p><strong>${esc(titel)}</strong></p>` : ''}
      <p>${s.neu ? '' : 'Dieser Artikel zählt diesen Monat schon. '}<strong>${s.anzahl}</strong> ${s.anzahl === 1 ? 'Text' : 'Texte'} diesen Monat.</p>
      <p class="klein" id="melden-zu">Das Fenster schließt sich gleich.</p>
    </section>`;
  // vom Lesezeichen geöffnet: wieder zu (geht nur bei Fenstern, die ein Skript geöffnet hat – sonst Hinweis)
  setTimeout(() => {
    window.close();
    setTimeout(() => { const t = document.getElementById('melden-zu'); if (t) t.textContent = 'Fertig – du kannst dieses Fenster schließen.'; }, 300);
  }, 2500);
}
