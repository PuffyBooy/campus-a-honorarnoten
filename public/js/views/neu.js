// „Was ist neu?“ – Änderungen der App, passend zu den eigenen Rollen
import { esc, formatDatum } from '../lib/format.js';
import { NEUESTE, neuigkeitenFuer } from '../lib/neuigkeiten.js';

export async function render(el, { store, nutzer }) {
  const liste = neuigkeitenFuer(nutzer);
  el.innerHTML = `
    <h1>Was ist neu?</h1>
    ${liste.map((e) => `
      <section class="karte neu-eintrag">
        <h2>${esc(e.titel)} <span class="klein">${esc(formatDatum(e.datum))}</span></h2>
        <ul>${e.punkte.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </section>`).join('') || '<section class="karte"><p>Noch keine Neuigkeiten.</p></section>'}`;
  if (nutzer.neuigkeiten_gesehen !== NEUESTE && !nutzer.ansicht_von) await Promise.resolve(store.neuigkeitenGesehen(NEUESTE)).catch(() => {});
}
