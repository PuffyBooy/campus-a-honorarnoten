// Handy: Redigier-Zähler als eigene Seite mit großem Knopf (#/zaehlen). Über den Kurzbefehl der installierten
// App (#/zaehlen/plus) wird gleich ein Text gezählt – danach steht wieder #/zaehlen in der Adresse, damit
// Neuladen nicht noch einmal zählt.
import { esc } from '../lib/format.js';
import { fehlerText, meldung } from '../lib/ui.js';
import { zaehlerBinden, zaehlerKarteHtml } from '../lib/redigier-zaehler.js';

export async function render(el, { store, params, istAktuell }) {
  let stand;
  let gezaehlt = false;
  try {
    if (params.aktion === 'plus') {
      history.replaceState(null, '', '#/zaehlen');
      stand = await store.redigiertZaehlen('kurzbefehl');
      gezaehlt = true;
    } else {
      stand = await store.redigierStand();
    }
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
  zaehlerBinden(karte, { store, stand });
  if (gezaehlt) {
    [...karte.querySelectorAll('.stapel .blatt')].at(-1)?.classList.add('neu');
    meldung(`Gezählt – ${stand.anzahl} diesen Monat.`, 'erfolg');
  }
  karte.querySelector('[data-plus]').focus();
}
