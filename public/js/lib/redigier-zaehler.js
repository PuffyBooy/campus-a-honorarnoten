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

const quelleText = { knopf: 'Knopf', kurzbefehl: 'Handy', erweiterung: 'Artikel' };

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
      <p class="klein zaehler-offen" data-offen role="status" hidden></p>
      <details class="aufklapp zaehler-details">
        <summary>Zuletzt gezählt</summary>
        <ul class="zaehler-letzte" data-letzte>${letzteHtml(s.letzte)}</ul>
      </details>
      <p class="klein zaehler-fuss">Nur zum Mitzählen – die Redaktion sieht den Stand live. Abgerechnet wird wie bisher am Monatsende.
        ${gross ? '' : 'Am Handy: <a href="#/zaehlen">Zähler als eigene Seite</a> (zum Startbildschirm hinzufügen).'}</p>
    </section>`;
}

// ---- Vorgemerkte Klicks: jeder Klick wird zuerst im Gerät gespeichert und dann an den Server geschickt.
// Geht die Seite zu, ist das Netz weg oder bricht die Verbindung ab, wird er beim nächsten Mal nachgeholt.
// Jeder Klick hat eine eigene Kennung – auch doppelt geschickt zählt er nur einmal.
const OFFEN = (nutzerId) => `campus-a-honorare:zaehler-offen:${nutzerId}`;

function offenLesen(nutzerId) {
  try {
    const a = JSON.parse(localStorage.getItem(OFFEN(nutzerId)) ?? '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function offenSchreiben(nutzerId, liste) {
  try {
    if (liste.length) localStorage.setItem(OFFEN(nutzerId), JSON.stringify(liste));
    else localStorage.removeItem(OFFEN(nutzerId));
  } catch { /* Speicher gesperrt: dann eben nur direkt senden */ }
}
const neueKennung = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

let senden = null; // läuft gerade
let aktiv = null; // { store, nutzerId } der zuletzt gezeichneten Karte (für „Seite wird verlassen“ und „wieder online“)

/** Vorgemerkte Klicks der Reihe nach schicken; liefert den neuesten Stand vom Server (oder null) */
export function nachsenden(store, nutzerId) {
  if (senden) return senden;
  senden = (async () => {
    let stand = null;
    for (let e = offenLesen(nutzerId)[0]; e; e = offenLesen(nutzerId)[0]) {
      try {
        stand = await store.redigiertZaehlen(e.quelle, e.vorgang);
      } catch (err) {
        if (err.offline) break; // später nochmal
        meldung(fehlerText(err), 'fehler'); // z. B. Zähler ausgeschaltet: nicht ewig wiederholen
      }
      offenSchreiben(nutzerId, offenLesen(nutzerId).filter((x) => x.vorgang !== e.vorgang));
    }
    return stand;
  })().finally(() => { senden = null; });
  return senden;
}

if (typeof window !== 'undefined') {
  const los = () => { if (aktiv && offenLesen(aktiv.nutzerId).length) nachsenden(aktiv.store, aktiv.nutzerId); };
  window.addEventListener('online', los);
  // Seite wird verlassen oder die App in den Hintergrund geschickt: jetzt schicken (die Anfrage läuft auch nach dem Schließen weiter)
  window.addEventListener('pagehide', los);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') los(); });
}

/**
 * Knöpfe der Karte. Nach jeder Änderung wird nur die Karte neu beschriftet (keine ganze Seite).
 * Die Zahl springt sofort; vorgemerkte, noch nicht gesendete Klicks zählen in der Anzeige schon mit.
 * uebernehmen(stand): Knopf „In Leistung übernehmen“ (Anzahl ins Formular)
 */
export function zaehlerBinden(karte, { store, stand, nutzerId, uebernehmen = null }) {
  aktiv = { store, nutzerId };
  let s = stand; // Stand laut Server
  const quelle = karte.classList.contains('zaehler-gross') ? 'kurzbefehl' : 'knopf';
  const anzeige = () => {
    const offen = offenLesen(nutzerId);
    if (!offen.length) return s;
    const anzahl = s.anzahl + offen.length;
    return {
      ...s, anzahl, heute: s.heute + offen.length, betrag: Math.round(anzahl * s.satz * 100) / 100,
      letzte: [...offen.map((e) => ({ titel: '', quelle: e.quelle, erstellt_am: e.zeit })).reverse(), ...s.letzte].slice(0, 8),
    };
  };
  const zeichnen = ({ plus = false } = {}) => {
    const a = anzeige();
    const offen = offenLesen(nutzerId).length;
    karte.querySelector('[data-zaehler-inhalt]').innerHTML = inhaltHtml(a);
    karte.querySelector('[data-letzte]').innerHTML = letzteHtml(a.letzte);
    karte.querySelector('[data-zurueck]').disabled = !a.anzahl;
    const u = karte.querySelector('[data-uebernehmen]');
    if (u) u.hidden = !a.anzahl;
    const hinweis = karte.querySelector('[data-offen]');
    hinweis.hidden = !offen;
    hinweis.textContent = offen ? `${offen === 1 ? '1 Klick ist im Gerät gespeichert und wird' : `${offen} Klicks sind im Gerät gespeichert und werden`} nachgeschickt, sobald wieder Verbindung besteht.` : '';
    if (plus) [...karte.querySelectorAll('.stapel .blatt')].at(-1)?.classList.add('neu');
  };
  const schicken = async () => {
    const neu = await nachsenden(store, nutzerId);
    if (neu) s = neu;
    if (karte.isConnected) zeichnen();
  };
  const plus = () => {
    offenSchreiben(nutzerId, [...offenLesen(nutzerId), { vorgang: neueKennung(), quelle, zeit: new Date().toISOString() }]);
    zeichnen({ plus: true });
    navigator.vibrate?.(15);
    meldung(`Gezählt – ${texte(anzeige().anzahl)} diesen Monat.`, 'erfolg');
    return schicken();
  };
  let laeuft = false;
  const zurueck = async (knopf) => {
    const offen = offenLesen(nutzerId);
    if (offen.length) { // noch nicht gesendet: einfach im Gerät wieder streichen
      offenSchreiben(nutzerId, offen.slice(0, -1));
    } else {
      if (laeuft) return;
      laeuft = true;
      knopf.disabled = true;
      try {
        await senden; // ein Klick, der gerade unterwegs ist, soll zuerst ankommen
        s = await store.redigiertRueckgaengig();
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
        return;
      } finally {
        laeuft = false;
        zeichnen();
      }
    }
    zeichnen();
    navigator.vibrate?.([10, 40, 10]);
    meldung(`Zurückgenommen – ${texte(anzeige().anzahl)} diesen Monat.`, 'erfolg');
  };
  karte.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-uebernehmen]')) uebernehmen?.(anzeige());
    else if (ev.target.closest('[data-plus]')) plus();
    else if (ev.target.closest('[data-zurueck]')) zurueck(ev.target.closest('[data-zurueck]'));
  });
  zeichnen();
  if (offenLesen(nutzerId).length) schicken(); // vom letzten Mal liegen geblieben
  return { stand: anzeige, plus };
}
