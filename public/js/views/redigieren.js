// Redaktion: „Redigieren live“ – wie viele Texte diesen Monat schon redigiert wurden, je Person, mit Verlauf
// der letzten 12 Monate. Aktualisiert sich alle 30 Sekunden; lässt sich als kleines eigenes Fenster öffnen
// (#/redigieren/fenster: ohne Kopfzeile und Menü).
import { esc, formatEuro, formatMonat, formatZeitpunkt, heuteIso } from '../lib/format.js';
import { fehlerText } from '../lib/ui.js';
import { tippBinden } from '../lib/diagramm.js';

const ALLE_MS = 30000;
let gewaehlt = null; // gewählter Monat (bleibt beim Seitenwechsel erhalten)

const monatKurz = (m) => {
  const [name, jahr] = formatMonat(m).split(' ');
  return `${name.slice(0, 3)} ${jahr.slice(2)}`;
};

function verlaufHtml(verlauf, monat) {
  const max = Math.max(1, ...verlauf.map((v) => v.anzahl));
  const b = 600; const h = 150; const unten = 20; const spalte = b / verlauf.length;
  const stufe = (v) => (h - unten - 14) * (v / max);
  const saeulen = verlauf.map((v, i) => {
    const hoehe = Math.max(v.anzahl ? 3 : 0, stufe(v.anzahl));
    const x = i * spalte + 6;
    const w = spalte - 12;
    return `<g class="saeule${v.monat === monat ? ' gewaehlt' : ''}" data-monat="${esc(v.monat)}"
        data-tipp="${esc(`${formatMonat(v.monat)}: ${v.anzahl} ${v.anzahl === 1 ? 'Text' : 'Texte'} · ${v.personen} ${v.personen === 1 ? 'Person' : 'Personen'}`)}">
      <rect class="saeule-treffer" x="${i * spalte}" y="0" width="${spalte}" height="${h}" fill="transparent"/>
      ${hoehe ? `<path class="saeule-wert" d="M${x},${h - unten} v${-(hoehe - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${hoehe - 4} z"/>` : ''}
      ${v.anzahl ? `<text x="${x + w / 2}" y="${h - unten - hoehe - 4}" text-anchor="middle" class="saeule-zahl">${v.anzahl}</text>` : ''}
      <text x="${x + w / 2}" y="${h - 5}" text-anchor="middle">${esc(monatKurz(v.monat))}</text>
    </g>`;
  }).join('');
  return `
    <figure class="diagramm redigier-verlauf">
      <figcaption><strong>Verlauf</strong> <span class="klein">redigierte Texte je Monat · Säule antippen, um den Monat anzusehen</span></figcaption>
      <div class="diagramm-flaeche">
        <svg viewBox="0 0 ${b} ${h}" preserveAspectRatio="none" role="img" aria-label="Redigierte Texte je Monat, letzte 12 Monate">
          <line class="diagramm-achse" x1="0" x2="${b}" y1="${h - unten}" y2="${h - unten}"/>
          ${saeulen}
        </svg>
        <div class="diagramm-tipp" hidden></div>
      </div>
      <details class="aufklapp"><summary>Als Tabelle</summary>
        <table class="tabelle kompakt"><thead><tr><th>Monat</th><th class="rechts">Texte</th><th class="rechts">Personen</th></tr></thead>
          <tbody>${[...verlauf].reverse().map((v) => `<tr><td>${esc(formatMonat(v.monat))}</td><td class="rechts">${v.anzahl}</td>
            <td class="rechts">${v.personen}</td></tr>`).join('')}</tbody></table>
      </details>
    </figure>`;
}

function personenHtml(u) {
  const aktiv = u.personen.filter((p) => p.anzahl || p.abgerechnet);
  const ohne = u.personen.filter((p) => !p.anzahl && !p.abgerechnet);
  if (!aktiv.length) return `<p class="klein">In diesem Monat wurde noch nichts gezählt.${ohne.length ? ` ${ohne.length} ${ohne.length === 1 ? 'Person darf' : 'Personen dürfen'} redigieren.` : ''}</p>`;
  const max = Math.max(...aktiv.map((p) => p.anzahl), 1);
  return `
    <div class="tabelle-rahmen"><table class="tabelle redigier-tabelle">
      <thead><tr><th>Person</th><th class="rechts">Texte</th><th class="rechts">Betrag</th><th class="nur-breit">Zuletzt</th>
        <th class="rechts nur-breit" title="In einer eingereichten Prämienabrechnung dieses Monats angegeben">Abgerechnet</th></tr></thead>
      <tbody>${aktiv.map((p) => `
        <tr>
          <td><strong>${esc(p.name)}</strong>
            <svg class="anteil" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="anteil-grund" width="100" height="4" rx="2"/>
              <rect class="anteil-wert" width="${Math.max(p.anzahl ? 2 : 0, Math.round((p.anzahl / max) * 100))}" height="4" rx="2"/></svg></td>
          <td class="rechts gross-zahl">${p.anzahl}</td>
          <td class="rechts">${esc(formatEuro(p.betrag))}</td>
          <td class="nur-breit klein">${p.zuletzt ? esc(formatZeitpunkt(p.zuletzt)) : '–'}</td>
          <td class="rechts nur-breit">${p.abgerechnet == null ? '<span class="klein">–</span>'
            : `${p.abgerechnet}${p.abgerechnet !== p.anzahl ? ` <span class="klein" title="weicht vom Zähler ab">(${p.abgerechnet > p.anzahl ? '+' : ''}${p.abgerechnet - p.anzahl})</span>` : ''}`}</td>
        </tr>`).join('')}</tbody>
      <tfoot><tr class="summe"><td>Zusammen</td><td class="rechts gross-zahl">${u.summe.anzahl}</td><td class="rechts">${esc(formatEuro(u.summe.betrag))}</td>
        <td class="nur-breit"></td><td class="nur-breit"></td></tr></tfoot>
    </table></div>
    ${ohne.length ? `<p class="klein">Noch nichts gezählt: ${ohne.map((p) => esc(p.name)).join(', ')}</p>` : ''}`;
}

function inhaltHtml(u, fenster) {
  const jetzt = heuteIso().slice(0, 7);
  const aktive = u.personen.filter((p) => p.anzahl).length;
  return `
    <section class="kennzahlen" aria-label="Überblick">
      <div class="kennzahl kennzahl-marke"><span class="kennzahl-titel">${u.monat === jetzt ? 'Diesen Monat' : esc(formatMonat(u.monat))} redigiert</span>
        <strong>${u.summe.anzahl}</strong><span class="klein">${u.summe.anzahl === 1 ? 'Text' : 'Texte'}</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Betrag</span><strong>${esc(formatEuro(u.summe.betrag))}</strong>
        <span class="klein">${esc(formatEuro(u.satz))} pro Text</span></div>
      <div class="kennzahl"><span class="kennzahl-titel">Personen</span><strong>${aktive}</strong>
        <span class="klein">haben gezählt</span></div>
    </section>
    <section class="karte">${personenHtml(u)}</section>
    <section class="karte">${verlaufHtml(u.verlauf, u.monat)}</section>`;
}

export async function render(el, { store, params, istAktuell }) {
  const fenster = params.ansicht === 'fenster';
  gewaehlt ??= heuteIso().slice(0, 7);
  const laden = () => store.redigierUebersicht(gewaehlt);
  let u = await laden();
  if (!istAktuell()) return;
  const monate = u.verlauf.map((v) => v.monat).reverse();
  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Redigieren live${fenster ? '' : ' <span class="badge">Test</span>'}</h1>
      <div class="rl-kopf-aktionen">
        <label class="sr-only" for="rl-monat">Monat</label>
        <select id="rl-monat">${monate.map((m) => `<option value="${m}" ${m === gewaehlt ? 'selected' : ''}>${esc(formatMonat(m))}</option>`).join('')}</select>
        ${fenster ? '' : '<button type="button" class="btn" id="rl-fenster" title="Kleines Fenster, das neben der Arbeit offen bleiben kann">Als eigenes Fenster öffnen</button>'}
      </div>
    </div>
    <div id="rl-inhalt"${fenster ? ' class="rl-fenster"' : ''}>${inhaltHtml(u, fenster)}</div>
    <p class="klein rl-stand" aria-live="off">Stand <span id="rl-zeit">${esc(formatZeitpunkt(u.stand))}</span> · aktualisiert sich alle 30 Sekunden
      · <button type="button" class="link-knopf" id="rl-jetzt">jetzt aktualisieren</button></p>`;
  const inhalt = el.querySelector('#rl-inhalt');
  const zeichnen = () => {
    inhalt.innerHTML = inhaltHtml(u, fenster);
    el.querySelector('#rl-zeit').textContent = formatZeitpunkt(u.stand);
    tippBinden(inhalt);
  };
  tippBinden(inhalt);
  let laeuft = false;
  let nochmal = false; // während des Ladens wurde z. B. ein anderer Monat gewählt
  const auffrischen = async () => {
    if (!istAktuell()) return;
    if (laeuft) { nochmal = true; return; }
    laeuft = true;
    try {
      const neu = await laden();
      if (!istAktuell()) return;
      const anders = JSON.stringify({ ...neu, stand: 0 }) !== JSON.stringify({ ...u, stand: 0 });
      u = neu;
      if (anders) zeichnen();
      else el.querySelector('#rl-zeit').textContent = formatZeitpunkt(u.stand);
    } catch (e) {
      if (istAktuell()) el.querySelector('#rl-zeit').textContent = `– ${fehlerText(e)}`;
    } finally {
      laeuft = false;
      if (nochmal) { nochmal = false; auffrischen(); }
    }
  };
  const monatWaehlen = (m) => {
    gewaehlt = m;
    el.querySelector('#rl-monat').value = m;
    auffrischen();
  };
  el.querySelector('#rl-monat').addEventListener('change', (ev) => monatWaehlen(ev.target.value));
  el.querySelector('#rl-jetzt').addEventListener('click', auffrischen);
  inhalt.addEventListener('click', (ev) => {
    const s = ev.target.closest('[data-monat]');
    if (s) monatWaehlen(s.dataset.monat);
  });
  el.querySelector('#rl-fenster')?.addEventListener('click', () => {
    const w = window.open(`${location.pathname}${location.search}#/redigieren/fenster`, 'redigieren-live', 'popup,width=560,height=820');
    if (!w) location.hash = '#/redigieren/fenster'; // Popup gesperrt: hier im Fenster
  });
  // alle 30 Sekunden, solange die Seite offen und sichtbar ist; beim Zurückkommen sofort
  const timer = setInterval(() => {
    if (!istAktuell()) { clearInterval(timer); document.removeEventListener('visibilitychange', sichtbar); return; }
    if (document.visibilityState === 'visible') auffrischen();
  }, ALLE_MS);
  const sichtbar = () => {
    if (!istAktuell()) document.removeEventListener('visibilitychange', sichtbar);
    else if (document.visibilityState === 'visible') auffrischen();
  };
  document.addEventListener('visibilitychange', sichtbar);
}
