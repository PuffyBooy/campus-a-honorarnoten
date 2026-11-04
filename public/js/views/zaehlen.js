// Handy: Redigier-Zähler als eigene Seite mit großem Knopf (#/zaehlen). Über den Kurzbefehl der installierten
// App (#/zaehlen/plus) wird gleich ein Text gezählt – danach steht wieder #/zaehlen in der Adresse, damit
// Neuladen nicht noch einmal zählt.
import { esc } from '../lib/format.js';
import { fehlerText } from '../lib/ui.js';
import { zaehlerBinden, zaehlerKarteHtml } from '../lib/redigier-zaehler.js';

export async function render(el, { store, nutzer, params, istAktuell }) {
  const sofort = params.aktion === 'plus';
  if (sofort) history.replaceState(null, '', '#/zaehlen');
  let stand;
  try {
    stand = await store.redigierStand();
  } catch (e) {
    if (!istAktuell()) return;
    el.innerHTML = `<section class="karte schmal"><h1>Redigieren mitzählen</h1><p class="fehlerbox">${esc(fehlerText(e))}</p>
      <p><a href="#/leistungen">Zu Mein Monat</a></p></section>`;
    return;
  }
  if (!istAktuell()) return;
  el.innerHTML = `<div class="schmal">${zaehlerKarteHtml(stand, { gross: true })}
    <p class="klein zaehlen-tipp">Tipp: Diese Seite zum Startbildschirm hinzufügen. In der installierten App gibt es beim langen
      Drücken auf das Symbol den Kurzbefehl <strong>„＋1 redigiert“</strong> – der zählt sofort.</p></div>`;
  const karte = el.querySelector('#zaehler');
  const zaehler = zaehlerBinden(karte, { store, stand, nutzerId: nutzer.id });
  if (sofort) zaehler.plus();
  karte.querySelector('[data-plus]').focus();
}
