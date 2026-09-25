// Übersicht der eigenen Honorarnoten mit Status
import { ART_LABEL, esc, formatDatum, formatEuro, formatZeitpunkt } from '../lib/format.js';
import { statusBadge } from '../lib/ui.js';

export async function render(el, { supabase, session, flash, istAktuell }) {
  const { data, error } = await supabase
    .from('honorarnoten')
    .select('id, nummer, status, art, titel, ausgabe, betrag, betrag_eingereicht, betrag_vermerk, leistungsdatum, eingereicht_am, ablehnungsgrund, bezahlt_am')
    .eq('autor_id', session.user.id)
    .order('eingereicht_am', { ascending: false });
  if (error) throw error;
  if (!istAktuell()) return;

  const karten = data.map((n) => `
    <li class="karte note-karte${flash?.neu === n.nummer ? ' neu' : ''}">
      <div class="note-kopf">
        <span class="nummer">${esc(n.nummer)}</span>
        ${statusBadge(n.status)}
      </div>
      <h2>${esc(n.titel)}</h2>
      <p class="meta">${esc(ART_LABEL[n.art])}${n.ausgabe ? ' · ' + esc(n.ausgabe) : ''} · Leistung am ${esc(formatDatum(n.leistungsdatum))}</p>
      <p class="betrag">${esc(formatEuro(n.betrag))}
        ${Number(n.betrag) !== Number(n.betrag_eingereicht)
          ? `<span class="durchgestrichen" title="ursprünglich eingereicht">${esc(formatEuro(n.betrag_eingereicht))}</span>` : ''}
      </p>
      ${n.betrag_vermerk ? `<p class="hinweisbox"><strong>Betrag angepasst:</strong> ${esc(n.betrag_vermerk)}</p>` : ''}
      ${n.status === 'abgelehnt' ? `<p class="fehlerbox"><strong>Begründung der Ablehnung:</strong> ${esc(n.ablehnungsgrund)}</p>` : ''}
      <p class="meta">Eingereicht am ${esc(formatZeitpunkt(n.eingereicht_am))}${n.bezahlt_am ? ` · <strong>Bezahlt am ${esc(formatDatum(n.bezahlt_am))}</strong>` : ''}</p>
    </li>`).join('');

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Meine Honorarnoten</h1>
      <a class="btn btn-primaer" href="#/einreichen">+ Neue Honorarnote</a>
    </div>
    ${flash?.neu ? `<p class="erfolgbox" role="status">Danke! Deine Honorarnote <strong>${esc(flash.neu)}</strong> wurde eingereicht. Die Redaktion prüft sie.</p>` : ''}
    ${data.length
      ? `<ul class="liste">${karten}</ul>`
      : '<section class="karte"><p>Du hast noch keine Honorarnoten eingereicht.</p></section>'}
    <p class="legende">Ablauf: Eingereicht → Angenommen oder Abgelehnt → Bezahlt</p>`;
}
