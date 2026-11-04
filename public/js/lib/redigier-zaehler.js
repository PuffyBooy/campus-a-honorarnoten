// Redigier-Zähler für die Person, die redigiert: jeden Text mit einem Knopf mitzählen (in „Mein Monat“ und
// als eigene Handy-Seite #/zaehlen). Nur zum Mitzählen – abgerechnet wird weiter am Monatsende.
import { esc, formatEuro, formatMonat, formatZeitpunkt } from './format.js';
import { fehlerText, meldung } from './ui.js';

const MAX_BLAETTER = 60; // so viele Blätter zeigt der Stapel, darüber „+ n“

const texte = (n) => `${n} ${n === 1 ? 'Text' : 'Texte'}`;

/** ein Blatt pro gezähltem Text – von unten nach oben gestapelt */
function stapelHtml(anzahl) {
  const zeigen = Math.min(anzahl, MAX_BLAETTER);
  return `${Array.from({ length: zeigen }, (_, i) => `<span class="blatt${i % 10 === 9 ? ' blatt-zehn' : ''}"></span>`).join('')}${
    anzahl > MAX_BLAETTER ? `<span class="stapel-mehr">+ ${anzahl - MAX_BLAETTER}</span>` : ''}`;
}

const quelleText = { knopf: 'Knopf', kurzbefehl: 'Handy', erweiterung: 'Chrome-Erweiterung' };

function letzteHtml(letzte) {
  if (!letzte.length) return '<li class="klein">Diesen Monat noch nichts gezählt.</li>';
  return letzte.map((e) => `<li><span>${e.titel ? esc(e.titel) : `<span class="klein">${esc(quelleText[e.quelle] ?? 'Knopf')}</span>`}</span>
    <span class="klein">${esc(formatZeitpunkt(e.erstellt_am))}</span></li>`).join('');
}

function inhaltHtml(s) {
  return `
    <div class="zaehler-haupt">
      <div class="zaehler-zahl">
        <strong data-anzahl>${esc(s.anzahl)}</strong>
        <span>${esc(s.anzahl === 1 ? 'Text' : 'Texte')} im ${esc(formatMonat(s.monat).split(' ')[0])}</span>
        <span class="klein">heute ${esc(s.heute)} · ${esc(formatEuro(s.betrag))}</span>
      </div>
      <div class="stapel" aria-hidden="true">${stapelHtml(s.anzahl)}</div>
    </div>`;
}

/** Karte mit großem Knopf; uebernehmen: Knopf „In Leistung übernehmen“ (nur in „Mein Monat“) */
export function zaehlerKarteHtml(s, { gross = false, uebernehmen = false } = {}) {
  return `
    <section class="karte redigier-zaehler${gross ? ' zaehler-gross' : ''}" id="zaehler" aria-labelledby="zaehler-titel">
      <div class="kopfzeile eng"><h2 id="zaehler-titel">Redigieren mitzählen <span class="badge">Test</span></h2></div>
      <div data-zaehler-inhalt aria-live="polite">${inhaltHtml(s)}</div>
      <div class="zaehler-knoepfe">
        <button type="button" class="btn btn-primaer zaehler-plus" data-plus>＋1 redigiert</button>
        <button type="button" class="btn" data-zurueck ${s.anzahl ? '' : 'disabled'}>↶ Rückgängig</button>
        ${uebernehmen ? `<button type="button" class="link-knopf" data-uebernehmen ${s.anzahl ? '' : 'hidden'}
          title="Anzahl dieses Monats als Redigier-Leistung ins Formular übernehmen">In Leistung übernehmen</button>` : ''}
      </div>
      <details class="aufklapp zaehler-details">
        <summary>Zuletzt gezählt</summary>
        <ul class="zaehler-letzte" data-letzte>${letzteHtml(s.letzte)}</ul>
      </details>
      <p class="klein zaehler-fuss">Nur zum Mitzählen – die Redaktion sieht den Stand live. Abgerechnet wird wie bisher am Monatsende.
        ${gross ? '' : 'Am Handy: <a href="#/zaehlen">Zähler als eigene Seite</a> (zum Startbildschirm hinzufügen).'}</p>
    </section>`;
}

/**
 * Knöpfe der Karte. Nach jeder Änderung wird nur die Karte neu beschriftet (keine ganze Seite).
 * uebernehmen(stand): Knopf „In Leistung übernehmen“ (Anzahl ins Formular)
 */
export function zaehlerBinden(karte, { store, stand, uebernehmen = null }) {
  let s = stand;
  const zeichnen = (neu, { plus = false } = {}) => {
    s = neu;
    karte.querySelector('[data-zaehler-inhalt]').innerHTML = inhaltHtml(s);
    karte.querySelector('[data-letzte]').innerHTML = letzteHtml(s.letzte);
    karte.querySelector('[data-zurueck]').disabled = !s.anzahl;
    const u = karte.querySelector('[data-uebernehmen]');
    if (u) u.hidden = !s.anzahl;
    if (plus) [...karte.querySelectorAll('.stapel .blatt')].at(-1)?.classList.add('neu');
  };
  let laeuft = false;
  karte.addEventListener('click', async (ev) => {
    const plus = ev.target.closest('[data-plus]');
    const zurueck = ev.target.closest('[data-zurueck]');
    if (ev.target.closest('[data-uebernehmen]')) { uebernehmen?.(s); return; }
    if ((!plus && !zurueck) || laeuft) return;
    laeuft = true;
    const knopf = plus ?? zurueck;
    knopf.disabled = true;
    try {
      zeichnen(await (plus ? store.redigiertZaehlen(karte.classList.contains('zaehler-gross') ? 'kurzbefehl' : 'knopf') : store.redigiertRueckgaengig()), { plus: Boolean(plus) });
      navigator.vibrate?.(plus ? 15 : [10, 40, 10]);
      meldung(plus ? `Gezählt – ${texte(s.anzahl)} diesen Monat.` : `Zurückgenommen – ${texte(s.anzahl)} diesen Monat.`, 'erfolg');
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    } finally {
      laeuft = false;
      if (plus) plus.disabled = false;
      else zurueck.disabled = !s.anzahl;
    }
  });
  return { stand: () => s, zeichnen };
}
