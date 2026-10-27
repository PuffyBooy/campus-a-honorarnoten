// Redaktion: Posteingang (Reiter nach Status, Filter, Suche) links, große Prüfansicht rechts.
// Auf dem Handy: erst die Liste, nach dem Antippen nur die Prüfansicht.
import { esc, formatEuro, formatMonat, vollerName } from '../lib/format.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from '../lib/ui.js';
import { MEDIEN, mediumBadge, mediumOder } from '../lib/campus.js';
import { pruefungRendern } from './redaktion-detail.js';

// Filter bleiben beim Wechseln zwischen Abrechnungen erhalten
const filter = { status: 'eingereicht', medium: '', monat: '', suche: '', sortierung: 'eingereicht_asc' };

const REITER = [
  ['eingereicht', 'Zu prüfen'], ['angenommen', 'Angenommen'], ['abgelehnt', 'Zurückgegeben'], ['bezahlt', 'Bezahlt'], ['', 'Alle'],
];

// Sortiert und gefiltert wird am Server; die Liste kommt in Seiten zu je SEITE Abrechnungen
const SORTIERUNGEN = {
  eingereicht_asc: 'Älteste zuerst', eingereicht_desc: 'Neueste zuerst', betrag_desc: 'Höchster Betrag', name: 'Name A–Z',
};
const SEITE = 100;

const euroSumme = (noten) => noten.reduce((s, n) => s + Math.round(n.betrag * 100), 0) / 100;

/** „heute“, „gestern“, „vor 3 Tagen“ */
export function wieLange(iso) {
  const tage = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return tage <= 0 ? 'heute' : tage === 1 ? 'gestern' : `vor ${tage} Tagen`;
}

function eintragHtml(n, aktiv, mitAuswahl) {
  return `
    <li class="eingang${aktiv ? ' aktiv' : ''}" data-id="${esc(n.id)}">
      ${mitAuswahl ? `<input type="checkbox" class="eingang-wahl" value="${esc(n.id)}" aria-label="${esc(n.nummer)} auswählen">` : ''}
      <a href="#/redaktion/${esc(n.id)}"${aktiv ? ' aria-current="true"' : ''}>
        <span class="eingang-zeile"><strong>${esc(vollerName(n.autor))}</strong><span class="eingang-betrag">${esc(formatEuro(n.betrag))}</span></span>
        <span class="eingang-zeile klein"><span class="nummer-klein">${esc(n.nummer)} · ${esc(wieLange(n.eingereicht_am))}</span>${mediumBadge(n.medium)}</span>
      </a>
    </li>`;
}

export async function render(el, ctx) {
  const { store, params, neuLaden, istAktuell } = ctx;
  const [daten, einstellungen] = await Promise.all([store.redaktionListe({ ...filter, limit: SEITE }), store.einstellungen()]);
  if (!istAktuell()) return;
  const zaehler = { ...daten.zaehler, '': Object.values(daten.zaehler).reduce((a, b) => a + b, 0) };
  const { monate } = daten;
  const liste = daten.noten; // wird mit „Weitere laden“ länger
  const gewaehlt = params.id ? { id: params.id } : null;
  const mitAuswahl = filter.status === 'eingereicht' && liste.length > 1;

  el.innerHTML = `
    <div class="kopfzeile"><h1>Redaktion</h1></div>
    <nav class="reiter" aria-label="Status">${REITER.map(([s, l]) => `
      <button type="button" class="reiter-knopf" data-status="${s}" aria-pressed="${filter.status === s}">
        ${esc(l)} <span class="zaehler${s === 'eingereicht' && zaehler[s] ? ' zaehler-wichtig' : ''}">${zaehler[s]}</span></button>`).join('')}
    </nav>
    <section class="filterleiste redaktion-filter" aria-label="Filter">
      <div class="feld"><label for="r-medium">Medium</label>
        <select id="r-medium"><option value="">Beide</option>
          ${Object.entries(MEDIEN).map(([m, x]) => `<option value="${m}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="feld"><label for="r-monat">Abrechnungsmonat</label>
        <select id="r-monat"><option value="">Alle Monate</option>
          ${monate.map((m) => `<option value="${esc(m)}">${esc(formatMonat(m))}</option>`).join('')}</select></div>
      <div class="feld"><label for="r-suche">Suche</label>
        <input id="r-suche" type="search" placeholder="Name oder Nummer" autocomplete="off"></div>
      <div class="feld"><label for="r-sort">Sortierung</label>
        <select id="r-sort">${Object.entries(SORTIERUNGEN).map(([w, l]) => `<option value="${w}">${esc(l)}</option>`).join('')}</select></div>
    </section>
    <div class="arbeitsplatz${gewaehlt ? ' mit-auswahl' : ''}">
      <aside class="posteingang" aria-label="Prämienabrechnungen">
        <p class="treffer" aria-live="polite"><strong>${daten.anzahl}</strong> ${daten.anzahl === 1 ? 'Abrechnung' : 'Abrechnungen'}
          · ${esc(formatEuro(daten.summe))}</p>
        ${mitAuswahl ? `<div class="sammel">
          <label class="check"><input type="checkbox" id="r-alle"> alle</label>
          <button type="button" class="btn btn-klein btn-erfolg" id="r-sammel" disabled>Ausgewählte annehmen</button></div>` : ''}
        ${liste.length ? `<ul class="eingang-liste">${liste.map((n) => eintragHtml(n, n.id === gewaehlt?.id, mitAuswahl)).join('')}</ul>`
          : `<p class="leer">${filter.status === 'eingereicht' ? 'Alles geprüft. 🎉' : 'Nichts gefunden.'}</p>`}
        ${daten.anzahl > liste.length ? `<button type="button" class="btn btn-klein btn-breit" id="r-mehr">Weitere laden (${daten.anzahl - liste.length} übrig)</button>` : ''}
      </aside>
      <section class="pruefung" id="pruefung" aria-live="polite">
        ${gewaehlt ? '<p class="laden">Wird geladen …</p>'
          : `<div class="pruefung-leer"><p><strong>Wähle links eine Abrechnung aus.</strong></p>
            <p class="klein">Tipp: Mit „Nächste“ geht es nach dem Prüfen ohne Zurückspringen weiter.</p></div>`}
      </section>
    </div>`;

  // ---- Filter
  const setzen = (feld, wert) => { filter[feld] = wert; neuLaden(); };
  el.querySelector('.reiter').addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-status]');
    if (k) setzen('status', k.dataset.status);
  });
  const sel = (id, feld) => {
    const e = el.querySelector(id);
    e.value = filter[feld];
    e.addEventListener('change', () => setzen(feld, e.value));
  };
  sel('#r-medium', 'medium');
  sel('#r-monat', 'monat');
  sel('#r-sort', 'sortierung');
  const suche = el.querySelector('#r-suche');
  suche.value = filter.suche;
  let warten;
  suche.addEventListener('input', () => {
    clearTimeout(warten);
    warten = setTimeout(async () => {
      filter.suche = suche.value;
      await neuLaden();
      const neu = document.getElementById('r-suche');
      neu?.focus();
      neu?.setSelectionRange(neu.value.length, neu.value.length);
    }, 250);
  });

  // ---- Weitere Seite der Liste anhängen
  el.querySelector('#r-mehr')?.addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    const mehr = await store.redaktionListe({ ...filter, limit: SEITE, offset: liste.length });
    liste.push(...mehr.noten);
    el.querySelector('.eingang-liste').insertAdjacentHTML('beforeend', mehr.noten.map((n) => eintragHtml(n, false, mitAuswahl)).join(''));
    const rest = daten.anzahl - liste.length;
    if (rest > 0) ev.target.textContent = `Weitere laden (${rest} übrig)`;
    else ev.target.remove();
  }));

  // ---- Mehrere auf einmal annehmen
  const sammel = el.querySelector('#r-sammel');
  const auswahl = () => Array.from(el.querySelectorAll('.eingang-wahl:checked'), (c) => c.value);
  el.querySelector('.posteingang').addEventListener('change', (ev) => {
    if (ev.target.id === 'r-alle') el.querySelectorAll('.eingang-wahl').forEach((c) => { c.checked = ev.target.checked; });
    if (sammel) {
      const n = auswahl().length;
      sammel.disabled = !n;
      sammel.textContent = n ? `${n} annehmen` : 'Ausgewählte annehmen';
    }
  });
  sammel?.addEventListener('click', async () => {
    const noten = liste.filter((n) => auswahl().includes(n.id));
    const ok = await bestaetigen({
      titel: `${noten.length} Prämienabrechnungen annehmen?`,
      html: `<ul class="dialog-liste">${noten.map((n) => `<li><span>${esc(vollerName(n.autor))}<br><span class="klein">${esc(n.nummer)}</span></span>
        <span class="mono">${esc(formatEuro(n.betrag))}</span></li>`).join('')}</ul>
        <p class="summenzeile">Gesamt: <strong>${esc(formatEuro(euroSumme(noten)))}</strong></p>
        <p class="klein">Sie gehen danach an die Buchhaltung. Die Autor:innen bekommen eine Nachricht.</p>`,
      ja: 'Alle annehmen',
    });
    if (!ok) return;
    await mitSperre(sammel, async () => {
      let fertig = 0;
      for (const n of noten) {
        try {
          await store.annehmen(n.id);
          fertig++;
        } catch (e) {
          meldung(`${n.nummer}: ${fehlerText(e)}`, 'fehler');
        }
      }
      if (fertig) meldung(`${fertig} ${fertig === 1 ? 'Abrechnung' : 'Abrechnungen'} angenommen.`, 'erfolg');
    });
    neuLaden();
  });

  // ---- Prüfansicht
  if (gewaehlt) {
    const i = liste.findIndex((n) => n.id === gewaehlt.id);
    await pruefungRendern(el.querySelector('#pruefung'), {
      ...ctx, einstellungen,
      vorige: i > 0 ? liste[i - 1] : null,
      naechste: i >= 0 && i < liste.length - 1 ? liste[i + 1] : null,
      // nach Annehmen/Zurückgeben: weiter zur nächsten in der Liste (die bearbeitete fällt aus „Zu prüfen“ heraus)
      danach: (i >= 0 ? liste[i + 1] ?? liste[i - 1] : null) ?? null,
    });
  }
}
