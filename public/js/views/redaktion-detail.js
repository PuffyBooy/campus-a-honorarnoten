// Seite 2: Detailansicht einer Note für die Redaktion (ohne IBAN/Adresse)
import { PDF_BUCKET } from '../supabase.js';
import {
  AKTION_LABEL, ART_LABEL, esc, formatDatum, formatEuro, formatZeitpunkt, parseBetrag, vollerName,
} from '../lib/format.js';
import { fehlerText, meldung, mitSperre, statusBadge } from '../lib/ui.js';

function verlaufDetails(e) {
  const d = e.details ?? {};
  switch (e.aktion) {
    case 'eingereicht': return d.betrag != null ? `Betrag ${formatEuro(d.betrag)}` : '';
    case 'abgelehnt': return `Begründung: ${d.grund ?? ''}`;
    case 'betrag_korrigiert': return `${formatEuro(d.alt)} → ${formatEuro(d.neu)} · Vermerk: ${d.vermerk ?? ''}`;
    case 'bezahlt': return d.datum ? `Zahlungsdatum ${formatDatum(d.datum)}` : '';
    default: return '';
  }
}

export async function render(el, { supabase, rollen, params, navigate, istAktuell }) {
  const [noteRes, kommRes, verlaufRes] = await Promise.all([
    supabase.from('honorarnoten').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('interne_kommentare').select('*').eq('note_id', params.id).order('erstellt_am'),
    supabase.from('note_verlauf').select('*').eq('note_id', params.id).order('erstellt_am', { ascending: false }),
  ]);
  for (const r of [noteRes, kommRes, verlaufRes]) if (r.error) throw r.error;
  if (!istAktuell()) return;

  const n = noteRes.data;
  if (!n) {
    el.innerHTML = `<section class="karte"><h1>Nicht gefunden</h1>
      <p>Diese Honorarnote gibt es nicht (mehr).</p><p><a href="#/redaktion">Zurück zur Liste</a></p></section>`;
    return;
  }

  let pdfUrl = null;
  if (n.pdf_path) {
    const { data } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(n.pdf_path, 600);
    pdfUrl = data?.signedUrl ?? null;
  }
  if (!istAktuell()) return;

  const kannAnnehmen = ['eingereicht', 'abgelehnt'].includes(n.status);
  const kannAblehnen = ['eingereicht', 'angenommen'].includes(n.status);
  const kannKorrigieren = n.status !== 'bezahlt';
  const istAdmin = rollen.includes('admin');
  const korrigiert = Number(n.betrag) !== Number(n.betrag_eingereicht);

  el.innerHTML = `
    <p><a href="#/redaktion" class="zurueck">← Zurück zur Liste</a></p>
    <div class="kopfzeile">
      <h1>${esc(n.nummer)}</h1>
      ${statusBadge(n.status)}
    </div>

    <div class="spalten">
      <section class="karte">
        <h2>Angaben</h2>
        <dl class="angaben">
          <dt>Name</dt><dd>${esc(vollerName(n))}</dd>
          <dt>E-Mail</dt><dd><a href="mailto:${esc(n.email)}">${esc(n.email)}</a></dd>
          <dt>Art der Leistung</dt><dd>${esc(ART_LABEL[n.art])}</dd>
          <dt>Titel / Beschreibung</dt><dd>${esc(n.titel)}</dd>
          <dt>Ausgabe / Erscheinung</dt><dd>${esc(n.ausgabe || '–')}</dd>
          <dt>Leistungsdatum</dt><dd>${esc(formatDatum(n.leistungsdatum))}</dd>
          <dt>Betrag</dt><dd class="betrag">${esc(formatEuro(n.betrag))}
            ${korrigiert ? `<span class="klein">(eingereicht: ${esc(formatEuro(n.betrag_eingereicht))})</span>` : ''}</dd>
          ${n.betrag_vermerk ? `<dt>Vermerk zur Korrektur</dt><dd>${esc(n.betrag_vermerk)}</dd>` : ''}
          <dt>Eingereicht am</dt><dd>${esc(formatZeitpunkt(n.eingereicht_am))}</dd>
          ${n.entschieden_am ? `<dt>Entschieden am</dt><dd>${esc(formatZeitpunkt(n.entschieden_am))}</dd>` : ''}
          ${n.bezahlt_am ? `<dt>Bezahlt am</dt><dd>${esc(formatDatum(n.bezahlt_am))}</dd>` : ''}
          <dt>PDF</dt><dd>${pdfUrl ? `<a href="${esc(pdfUrl)}" target="_blank" rel="noopener">PDF öffnen</a>` : (n.pdf_path ? 'nicht verfügbar' : '–')}</dd>
        </dl>
        <h3>Notiz der Autor:in</h3>
        <p class="notiz">${n.notiz ? esc(n.notiz) : '<span class="klein">keine</span>'}</p>
        ${n.status === 'abgelehnt' ? `<p class="fehlerbox"><strong>Ablehnungsgrund:</strong> ${esc(n.ablehnungsgrund)}</p>` : ''}
        <p class="hinweis">🔒 Adresse und Bankverbindung sind für die Redaktion ausgeblendet.</p>
      </section>

      <div>
        <section class="karte">
          <h2>Entscheidung</h2>
          ${n.status === 'bezahlt' ? '<p>Diese Note ist bereits bezahlt und kann nicht mehr geändert werden.</p>' : ''}
          <div class="aktionen">
            ${kannAnnehmen ? '<button type="button" class="btn btn-erfolg" id="d-annehmen">Annehmen</button>' : ''}
            ${kannAblehnen ? '<button type="button" class="btn btn-gefahr" id="d-ablehnen-oeffnen">Ablehnen …</button>' : ''}
          </div>
          <form id="d-ablehnen-form" hidden novalidate>
            <label for="d-grund">Begründung (Pflicht, die Autor:in sieht diesen Text)</label>
            <textarea id="d-grund" rows="3" required maxlength="1000"></textarea>
            <p class="feldfehler" id="d-grund-fehler" role="alert"></p>
            <div class="aktionen">
              <button type="submit" class="btn btn-gefahr">Ablehnung bestätigen</button>
              <button type="button" class="btn" id="d-ablehnen-abbrechen">Abbrechen</button>
            </div>
          </form>

          ${kannKorrigieren ? `
          <details class="aufklapp">
            <summary>Betrag korrigieren</summary>
            <form id="d-betrag-form" novalidate>
              <label for="d-betrag">Neuer Betrag in EUR</label>
              <input id="d-betrag" inputmode="decimal" autocomplete="off" required>
              <label for="d-vermerk">Vermerk (Pflicht, für die Autor:in sichtbar)</label>
              <textarea id="d-vermerk" rows="2" required maxlength="500"></textarea>
              <p class="feldfehler" id="d-betrag-fehler" role="alert"></p>
              <button type="submit" class="btn">Betrag speichern</button>
            </form>
          </details>` : ''}
        </section>

        <section class="karte">
          <h2>Interne Kommentare</h2>
          <p class="hinweis">Nur für die Redaktion sichtbar.</p>
          <ul class="kommentare">
            ${kommRes.data.map((k) => `
              <li><div class="klein">${esc(k.verfasser_name)} · ${esc(formatZeitpunkt(k.erstellt_am))}</div>
                  <div class="notiz">${esc(k.text)}</div></li>`).join('') || '<li class="klein">Noch keine Kommentare.</li>'}
          </ul>
          <form id="d-komm-form" novalidate>
            <label for="d-komm" class="sr-only">Neuer Kommentar</label>
            <textarea id="d-komm" rows="2" placeholder="Interner Kommentar …" maxlength="2000"></textarea>
            <p class="feldfehler" id="d-komm-fehler" role="alert"></p>
            <button type="submit" class="btn">Kommentar speichern</button>
          </form>
        </section>

        <section class="karte">
          <h2>Verlauf</h2>
          <ol class="verlauf">
            ${verlaufRes.data.map((e) => `
              <li><div><strong>${esc(AKTION_LABEL[e.aktion] ?? e.aktion)}</strong> – ${esc(e.akteur_name)}</div>
                  <div class="klein">${esc(formatZeitpunkt(e.erstellt_am))}</div>
                  ${verlaufDetails(e) ? `<div class="klein">${esc(verlaufDetails(e))}</div>` : ''}</li>`).join('')}
          </ol>
        </section>

        ${istAdmin ? `
        <section class="karte gefahrenzone">
          <h2>Admin</h2>
          <p class="hinweis">Löscht die Note inkl. Bankdaten, Kommentaren, Verlauf und PDF endgültig.</p>
          <button type="button" class="btn btn-gefahr" id="d-loeschen">Note löschen</button>
        </section>` : ''}
      </div>
    </div>`;

  const neuLaden = () => navigate(`redaktion/${n.id}`);
  const rpc = async (button, name, args, erfolg) => mitSperre(button, async () => {
    const { error } = await supabase.rpc(name, args);
    if (error) {
      meldung(fehlerText(error), 'fehler');
      return false;
    }
    meldung(erfolg, 'erfolg');
    neuLaden();
    return true;
  });

  el.querySelector('#d-annehmen')?.addEventListener('click', (ev) =>
    rpc(ev.currentTarget, 'honorarnote_annehmen', { p_id: n.id }, `${n.nummer} wurde angenommen.`));

  const ablehnenForm = el.querySelector('#d-ablehnen-form');
  el.querySelector('#d-ablehnen-oeffnen')?.addEventListener('click', () => {
    ablehnenForm.hidden = false;
    ablehnenForm.querySelector('textarea').focus();
  });
  el.querySelector('#d-ablehnen-abbrechen')?.addEventListener('click', () => { ablehnenForm.hidden = true; });
  ablehnenForm?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const grund = el.querySelector('#d-grund').value.trim();
    const fehler = el.querySelector('#d-grund-fehler');
    fehler.textContent = grund ? '' : 'Bitte eine Begründung angeben.';
    if (!grund) return;
    rpc(ablehnenForm.querySelector('[type=submit]'), 'honorarnote_ablehnen',
      { p_id: n.id, p_grund: grund }, `${n.nummer} wurde abgelehnt.`);
  });

  el.querySelector('#d-betrag-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const betrag = parseBetrag(el.querySelector('#d-betrag').value);
    const vermerk = el.querySelector('#d-vermerk').value.trim();
    const fehler = el.querySelector('#d-betrag-fehler');
    fehler.textContent = !betrag ? 'Bitte einen gültigen Betrag eingeben.'
      : !vermerk ? 'Der Vermerk ist Pflicht.'
      : betrag === Number(n.betrag) ? 'Der Betrag ist unverändert.' : '';
    if (fehler.textContent) return;
    rpc(f.querySelector('[type=submit]'), 'honorarnote_betrag_korrigieren',
      { p_id: n.id, p_betrag: betrag, p_vermerk: vermerk }, 'Betrag wurde korrigiert.');
  });

  el.querySelector('#d-komm-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = el.querySelector('#d-komm').value.trim();
    const fehler = el.querySelector('#d-komm-fehler');
    fehler.textContent = text ? '' : 'Der Kommentar ist leer.';
    if (!text) return;
    rpc(ev.currentTarget.querySelector('[type=submit]'), 'honorarnote_kommentieren',
      { p_id: n.id, p_text: text }, 'Kommentar gespeichert.');
  });

  el.querySelector('#d-loeschen')?.addEventListener('click', async (ev) => {
    const eingabe = prompt(`Zum endgültigen Löschen bitte die Nummer ${n.nummer} eingeben:`);
    if (eingabe?.trim() !== n.nummer) return;
    await mitSperre(ev.currentTarget, async () => {
      const { data: pfad, error } = await supabase.rpc('honorarnote_loeschen', { p_id: n.id });
      if (error) {
        meldung(fehlerText(error), 'fehler');
        return;
      }
      if (pfad) {
        const { error: sErr } = await supabase.storage.from(PDF_BUCKET).remove([pfad]);
        if (sErr) meldung('Note gelöscht, aber das PDF konnte nicht entfernt werden: ' + fehlerText(sErr), 'fehler');
      }
      meldung(`${n.nummer} wurde gelöscht.`, 'erfolg');
      navigate('redaktion');
    });
  });
}
