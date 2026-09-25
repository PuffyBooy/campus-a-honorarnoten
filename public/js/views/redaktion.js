// Seite 2: Bearbeiter-Terminal – Liste aller Noten mit Filter, Suche und Sortierung
import { ART_LABEL, STATUS_LABEL, esc, formatDatum, formatEuro, vollerName } from '../lib/format.js';
import { statusBadge } from '../lib/ui.js';

// Filter bleiben erhalten, wenn man aus der Detailansicht zurückkommt
const filter = { status: 'eingereicht', suche: '', sortierung: 'eingereicht_desc' };

const SORTIERUNGEN = {
  eingereicht_desc: ['Eingereicht: neueste zuerst', (a, b) => b.eingereicht_am.localeCompare(a.eingereicht_am)],
  eingereicht_asc: ['Eingereicht: älteste zuerst', (a, b) => a.eingereicht_am.localeCompare(b.eingereicht_am)],
  leistung_desc: ['Leistungsdatum: neueste zuerst', (a, b) => b.leistungsdatum.localeCompare(a.leistungsdatum)],
  leistung_asc: ['Leistungsdatum: älteste zuerst', (a, b) => a.leistungsdatum.localeCompare(b.leistungsdatum)],
  betrag_desc: ['Betrag: höchster zuerst', (a, b) => b.betrag - a.betrag],
  betrag_asc: ['Betrag: niedrigster zuerst', (a, b) => a.betrag - b.betrag],
};

export async function render(el, { supabase, istAktuell }) {
  const { data, error } = await supabase
    .from('honorarnoten')
    .select('id, nummer, status, vorname, nachname, art, titel, betrag, leistungsdatum, eingereicht_am')
    .order('eingereicht_am', { ascending: false })
    .limit(5000);
  if (error) throw error;
  if (!istAktuell()) return;

  const zaehler = Object.fromEntries(Object.keys(STATUS_LABEL).map((s) => [s, 0]));
  data.forEach((n) => zaehler[n.status]++);

  el.innerHTML = `
    <h1>Bearbeiter-Terminal</h1>
    <section class="karte filterleiste" aria-label="Filter">
      <div class="feld">
        <label for="r-status">Status</label>
        <select id="r-status">
          <option value="">Alle (${data.length})</option>
          ${Object.entries(STATUS_LABEL).map(([w, l]) => `<option value="${w}">${esc(l)} (${zaehler[w]})</option>`).join('')}
        </select>
      </div>
      <div class="feld">
        <label for="r-suche">Suche (Name oder Nummer)</label>
        <input id="r-suche" type="search" placeholder="z. B. Muster oder CC-2026-0042" autocomplete="off">
      </div>
      <div class="feld">
        <label for="r-sort">Sortierung</label>
        <select id="r-sort">
          ${Object.entries(SORTIERUNGEN).map(([w, [l]]) => `<option value="${w}">${esc(l)}</option>`).join('')}
        </select>
      </div>
    </section>
    <p class="treffer" id="r-treffer" aria-live="polite"></p>
    <div id="r-tabelle"></div>`;

  const statusSel = el.querySelector('#r-status');
  const suche = el.querySelector('#r-suche');
  const sort = el.querySelector('#r-sort');
  statusSel.value = filter.status;
  suche.value = filter.suche;
  sort.value = filter.sortierung;

  function zeichnen() {
    const q = filter.suche.trim().toLowerCase();
    const liste = data
      .filter((n) => !filter.status || n.status === filter.status)
      .filter((n) => !q || n.nummer.toLowerCase().includes(q) || vollerName(n).toLowerCase().includes(q)
        || `${n.nachname} ${n.vorname}`.toLowerCase().includes(q))
      .sort(SORTIERUNGEN[filter.sortierung][1]);

    const summe = liste.reduce((s, n) => s + Number(n.betrag), 0);
    el.querySelector('#r-treffer').textContent =
      `${liste.length} ${liste.length === 1 ? 'Note' : 'Noten'} · Summe ${formatEuro(summe)}`;

    el.querySelector('#r-tabelle').innerHTML = liste.length
      ? `<table class="tabelle klickbar">
          <thead><tr>
            <th>Nummer</th><th>Name</th><th>Leistung</th><th>Leistungsdatum</th>
            <th class="rechts">Betrag</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${liste.map((n) => `
              <tr data-id="${esc(n.id)}">
                <td data-label="Nummer"><a href="#/redaktion/${esc(n.id)}">${esc(n.nummer)}</a></td>
                <td data-label="Name">${esc(vollerName(n))}</td>
                <td data-label="Leistung"><span><span class="klein">${esc(ART_LABEL[n.art])}:</span> ${esc(n.titel)}</span></td>
                <td data-label="Leistungsdatum">${esc(formatDatum(n.leistungsdatum))}</td>
                <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
                <td data-label="Status">${statusBadge(n.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
      : '<section class="karte"><p>Keine Noten gefunden.</p></section>';
  }

  statusSel.addEventListener('change', () => { filter.status = statusSel.value; zeichnen(); });
  suche.addEventListener('input', () => { filter.suche = suche.value; zeichnen(); });
  sort.addEventListener('change', () => { filter.sortierung = sort.value; zeichnen(); });
  el.querySelector('#r-tabelle').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (tr && !ev.target.closest('a')) location.hash = `#/redaktion/${tr.dataset.id}`;
  });

  zeichnen();
}
