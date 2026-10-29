// Redaktion: Posteingang (Reiter nach Status, Filter, Suche) links, große Prüfansicht rechts.
// Auf dem Handy: erst die Liste, nach dem Antippen nur die Prüfansicht.
import { esc, formatEuro, formatMonat, vollerName } from '../lib/format.js';
import { bestaetigen, fehlerText, meldung, mitSperre } from '../lib/ui.js';
import { MEDIEN, mediumBadge, mediumOder } from '../lib/campus.js';
import { pruefungRendern, vorladen, vorratLeeren } from './redaktion-detail.js';

// Filter bleiben beim Wechseln zwischen Abrechnungen erhalten; das Medium merkt sich der Browser
const MEDIUM_KEY = 'campus-a-honorare:redaktion-medium';
const gemerktesMedium = () => { try { return localStorage.getItem(MEDIUM_KEY) ?? ''; } catch { return ''; } };
const filter = { status: 'eingereicht', medium: gemerktesMedium(), monat: '', suche: '', sortierung: 'eingereicht_asc', rueckfrage: false };

const REITER = [
  ['eingereicht', 'Zu prüfen'], ['angenommen', 'Angenommen'], ['abgelehnt', 'Zurückgegeben'], ['bezahlt', 'Bezahlt'], ['', 'Alle'],
];

// Sortiert und gefiltert wird am Server; die Liste kommt in Seiten zu je SEITE Abrechnungen
const SORTIERUNGEN = {
  eingereicht_asc: 'Älteste zuerst', eingereicht_desc: 'Neueste zuerst', betrag_desc: 'Höchster Betrag', name: 'Name A–Z',
};
const SEITE = 100;
// so viele Einträge waren zuletzt geladen („Weitere laden“) – beim Neuzeichnen wieder so viele holen
let geladen = SEITE;

// Tastenkürzel (gelten nur auf der Redaktionsseite und nicht beim Tippen)
let tastenAbbrechen = null;
const KUERZEL = [
  ['J', 'nächste Abrechnung'], ['K', 'vorige Abrechnung'], ['Leertaste', 'nächste Leistung als geprüft abhaken'],
  ['A', 'annehmen'], ['R', 'zurückgeben (mit Vorlagen)'], ['F', 'nachfragen (Rückfrage an die Autor:in)'], ['?', 'diese Hilfe'],
];
const kuerzelHinweis = () => `<p class="kuerzel-hinweis klein">Tastenkürzel: ${KUERZEL.slice(0, 5)
  .map(([k, t]) => `<kbd>${esc(k)}</kbd> ${esc(t)}`).join(' · ')} · <kbd>?</kbd> Hilfe</p>`;
const kuerzelHilfe = () => bestaetigen({
  titel: 'Tastenkürzel in der Redaktion',
  html: `<dl class="angaben">${KUERZEL.map(([k, t]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(t)}</dd>`).join('')}</dl>
    <p class="klein">Gelten nicht, solange du in ein Feld tippst.</p>`,
  ja: 'Ok', nein: 'Schließen',
});

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
        ${n.rueckfrage === 'offen' ? '<span class="rueckfrage-marke">❓ Rückfrage offen</span>' : ''}
        ${n.rueckfrage === 'beantwortet' ? '<span class="rueckfrage-marke rueckfrage-antwort">💬 Antwort da</span>' : ''}
      </a>
    </li>`;
}

// Stand der zuletzt gezeichneten Seite: Liste und gewählte Abrechnung – damit der Wechsel zwischen
// Abrechnungen nur die rechte Seite austauscht (wechseln), statt alles neu zu laden
let stand = null;

/** Prüfansicht der gewählten Abrechnung zeichnen (Nachbarn aus der Liste für „Vorige“, „Nächste“, „danach“) */
function detailZeigen(ctx) {
  const { liste, einstellungen, el } = stand;
  const i = liste.findIndex((n) => n.id === stand.id);
  const id = stand.id;
  const box = el.querySelector('#pruefung');
  // bis die neue Abrechnung da ist, ist die alte Ansicht nicht mehr bedienbar (sonst trifft „Annehmen“ die falsche)
  if (box.dataset.note && box.dataset.note !== id) { box.inert = true; box.setAttribute('aria-busy', 'true'); }
  const fertig = () => { if (stand?.id === id) { box.inert = false; box.removeAttribute('aria-busy'); } };
  return pruefungRendern(box, {
    ...ctx, params: { id: stand.id }, einstellungen, neuLaden: listeNeu,
    vorige: i > 0 ? liste[i - 1] : null,
    naechste: i >= 0 && i < liste.length - 1 ? liste[i + 1] : null,
    // nach Annehmen/Zurückgeben: weiter zur nächsten in der Liste (die bearbeitete fällt aus „Zu prüfen“ heraus)
    danach: (i >= 0 ? liste[i + 1] ?? liste[i - 1] : null) ?? null,
    listeVeraltet: () => { if (stand) stand.veraltet = true; },
  }).finally(fertig);
}

/**
 * Wechsel zu einer anderen Abrechnung ohne Neuaufbau: Liste, Filter und Menü bleiben stehen,
 * nur die Prüfansicht wird ausgetauscht. false, wenn die Seite neu gezeichnet werden muss.
 */
export function wechseln(el, ctx) {
  const id = ctx.params.id ?? null;
  if (!id || !stand || stand.el !== el || !el.querySelector('.arbeitsplatz')) return false;
  stand.ctx = ctx;
  // nach Annehmen/Zurückgeben: Liste neu holen, aber nur die Redaktion (nicht die ganze App)
  if (stand.veraltet) {
    listeNeu(id);
    return true;
  }
  stand.id = id;
  el.querySelectorAll('.eingang').forEach((li) => {
    const an = li.dataset.id === id;
    li.classList.toggle('aktiv', an);
    li.querySelector('a')?.toggleAttribute('aria-current', an);
  });
  el.querySelector('.arbeitsplatz').classList.add('mit-auswahl');
  detailZeigen(ctx).catch((e) => ctx.neuLaden?.(e));
  return true;
}

/**
 * Nur die Redaktion neu zeichnen (Filter, Reiter, nach einer Entscheidung) – ohne den Umweg über die ganze App
 * (Anmeldung prüfen, Menü, …). Die offene Abrechnung bleibt gewählt und wird nicht nochmal geholt.
 */
let listenLauf = 0;
function listeNeu(id = stand?.id) {
  if (!stand?.ctx) return Promise.resolve();
  const lauf = ++listenLauf;
  const ctx = stand.ctx;
  return render(stand.el, {
    ...ctx, params: { ...ctx.params, id: id ?? undefined }, istAktuell: () => ctx.istAktuell() && lauf === listenLauf,
    einstellungenVorher: stand.einstellungen, basis: ctx,
  }).catch((e) => meldung(fehlerText(e), 'fehler'));
}

export async function render(el, ctx) {
  const { store, params, istAktuell } = ctx;
  const neuLaden = listeNeu;
  if (params.id) vorladen(store, params.id); // die gewählte Abrechnung gleichzeitig mit der Liste holen
  const [daten, einstellungen] = await Promise.all([
    store.redaktionListe({ ...filter, limit: SEITE }), ctx.einstellungenVorher ?? store.einstellungen(),
  ]);
  while (daten.noten.length < Math.min(geladen, daten.anzahl)) {
    const mehr = await store.redaktionListe({ ...filter, limit: SEITE, offset: daten.noten.length });
    if (!mehr.noten.length) break;
    daten.noten.push(...mehr.noten);
  }
  if (!istAktuell()) return;
  const zaehler = { ...daten.zaehler, '': Object.values(daten.zaehler).reduce((a, b) => a + b, 0) };
  const { monate } = daten;
  const liste = daten.noten; // wird mit „Weitere laden“ länger
  const gewaehlt = params.id ? { id: params.id } : null;
  stand = { el, ctx: ctx.basis ?? ctx, liste, einstellungen, id: params.id ?? null, veraltet: false };
  const mitAuswahl = filter.status === 'eingereicht' && liste.length > 1;

  const offenGesamt = Object.values(daten.zu_pruefen_medium ?? {}).reduce((a, b) => a + b, 0);
  el.innerHTML = `
    <div class="kopfzeile"><h1>Redaktion</h1>
      <div class="medium-schalter" role="group" aria-label="Medium">
        ${[['', 'Beide', offenGesamt], ...Object.entries(MEDIEN).map(([m, x]) => [m, x.name, daten.zu_pruefen_medium?.[m] ?? 0])].map(([m, name, n]) => `
          <button type="button" class="medium-knopf${m ? ` medium-knopf-${m}` : ''}" data-medium="${m}" aria-pressed="${filter.medium === m}">
            ${esc(name)}${n ? ` <span class="zaehler" title="zu prüfen">${n}</span>` : ''}</button>`).join('')}
      </div>
    </div>
    <nav class="reiter" aria-label="Status">${REITER.map(([s, l]) => `
      <button type="button" class="reiter-knopf" data-status="${s}" aria-pressed="${filter.status === s}">
        ${esc(l)} <span class="zaehler${s === 'eingereicht' && zaehler[s] ? ' zaehler-wichtig' : ''}">${zaehler[s]}</span></button>`).join('')}
    </nav>
    <section class="filterleiste redaktion-filter" aria-label="Filter">
      <div class="feld"><label for="r-monat">Abrechnungsmonat</label>
        <select id="r-monat"><option value="">Alle Monate</option>
          ${monate.map((m) => `<option value="${esc(m)}">${esc(formatMonat(m))}</option>`).join('')}</select></div>
      <div class="feld"><label for="r-suche">Suche</label>
        <input id="r-suche" type="search" placeholder="Name oder Nummer" autocomplete="off"></div>
      <div class="feld"><label for="r-sort">Sortierung</label>
        <select id="r-sort">${Object.entries(SORTIERUNGEN).map(([w, l]) => `<option value="${w}">${esc(l)}</option>`).join('')}</select></div>
      <label class="check rueckfrage-filter"><input type="checkbox" id="r-rueckfrage" ${filter.rueckfrage ? 'checked' : ''}>
        Nur mit Rückfrage${daten.rueckfragen?.beantwortet ? ` <span class="zaehler zaehler-wichtig" title="Antwort da">${daten.rueckfragen.beantwortet}</span>` : ''}
        ${daten.rueckfragen?.offen ? ` <span class="klein">(${daten.rueckfragen.offen} warten)</span>` : ''}</label>
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
    </div>
    ${kuerzelHinweis()}`;

  // ---- Filter
  const setzen = (feld, wert) => { filter[feld] = wert; geladen = SEITE; neuLaden(); };
  el.querySelector('.reiter').addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-status]');
    if (k) setzen('status', k.dataset.status);
  });
  el.querySelector('.medium-schalter').addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-medium]');
    if (!k) return;
    try { localStorage.setItem(MEDIUM_KEY, k.dataset.medium); } catch { /* nur für dieses Mal */ }
    setzen('medium', k.dataset.medium);
  });
  const sel = (id, feld) => {
    const e = el.querySelector(id);
    e.value = filter[feld];
    e.addEventListener('change', () => setzen(feld, e.value));
  };
  el.querySelector('#r-rueckfrage').addEventListener('change', (ev) => setzen('rueckfrage', ev.target.checked));
  sel('#r-monat', 'monat');
  sel('#r-sort', 'sortierung');
  const suche = el.querySelector('#r-suche');
  suche.value = filter.suche;
  let warten;
  suche.addEventListener('input', () => {
    clearTimeout(warten);
    warten = setTimeout(async () => {
      filter.suche = suche.value;
      geladen = SEITE;
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
    geladen = liste.length;
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
    vorratLeeren(); // vorgeladene Abrechnungen sind jetzt veraltet
    neuLaden();
  });

  // ---- Tastenkürzel
  tastenAbbrechen?.abort();
  tastenAbbrechen = new AbortController();
  document.addEventListener('keydown', (ev) => {
    if (!location.hash.startsWith('#/redaktion')) { tastenAbbrechen.abort(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.closest?.('input, textarea, select, [contenteditable]')
      || document.querySelector('dialog[open]')) return;
    const i = stand.id ? liste.findIndex((n) => n.id === stand.id) : -1;
    const ziel = (n) => { if (n) location.hash = `#/redaktion/${n.id}`; };
    const taste = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (taste === 'j') ziel(i < 0 ? liste[0] : liste[i + 1]);
    else if (taste === 'k') ziel(i > 0 ? liste[i - 1] : null);
    // Aktionen nur, wenn rechts schon die gewählte Abrechnung steht (nicht noch die vorige, während geladen wird)
    else if (stand.id && 'arf '.includes(taste) && el.querySelector('#pruefung')?.dataset.note !== stand.id) { ev.preventDefault(); return; }
    else if (taste === 'a') el.querySelector('#d-annehmen')?.click();
    else if (taste === 'r') el.querySelector('#d-ablehnen-oeffnen')?.click();
    else if (taste === 'f') {
      const knopf = el.querySelector('#d-rueckfrage-oeffnen');
      if (knopf) knopf.click();
      else el.querySelector('#d-rueckfrage textarea')?.focus();
    }
    else if (taste === ' ' && stand.id) el.querySelector('[data-pruefen]:not(:checked):not(:disabled)')?.click();
    else if (taste === '?') kuerzelHilfe();
    else return;
    ev.preventDefault();
  }, { signal: tastenAbbrechen.signal });

  // ---- Prüfansicht; ohne Auswahl schon die erste Abrechnung vorab holen
  if (gewaehlt) await detailZeigen(ctx);
  else vorladen(store, liste[0]?.id);
}
