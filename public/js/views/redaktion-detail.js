// Detailansicht einer Honorarnote für die Redaktion (ohne IBAN und Adresse)
import { AKTION_LABEL, esc, formatDatum, formatEuro, formatMonat, formatZeitpunkt, parseBetrag, vollerName } from '../lib/format.js';
import { fehlerText, meldung, statusBadge } from '../lib/ui.js';
import { positionenTabelle } from './noten.js';
import { mediumBadge } from '../lib/campus.js';

function verlaufDetails(e) {
  const d = e.details ?? {};
  switch (e.aktion) {
    case 'eingereicht': return d.betrag != null ? `${d.positionen ?? ''} Leistung(en), ${formatEuro(d.betrag)}` : '';
    case 'abgelehnt': return `Begründung: ${d.grund ?? ''}`;
    case 'betrag_korrigiert': return `„${d.position ?? ''}“: ${formatEuro(d.alt)} → ${formatEuro(d.neu)} · Vermerk: ${d.vermerk ?? ''}`;
    case 'bezahlt': return d.datum ? `Zahlungsdatum ${formatDatum(d.datum)}` : '';
    default: return '';
  }
}

export async function render(el, { store, nutzer, params, neuLaden, istAktuell }) {
  let n;
  try {
    n = await store.note(params.id);
  } catch {
    el.innerHTML = `<section class="karte"><h1>Nicht gefunden</h1>
      <p>Diese Honorarnote gibt es nicht (mehr).</p><p><a href="#/redaktion">Zurück zur Liste</a></p></section>`;
    return;
  }
  const [kommentare, verlauf, einstellungen] = await Promise.all([store.kommentare(n.id), store.verlaufVon(n.id), store.einstellungen()]);
  if (!istAktuell()) return;
  const kannAnnehmen = ['eingereicht', 'abgelehnt'].includes(n.status) && !n.zurueckgeholt_am;
  const kannAblehnen = ['eingereicht', 'angenommen'].includes(n.status);

  el.innerHTML = `
    <p><a href="#/redaktion" class="zurueck">← Zurück zur Liste</a></p>
    <div class="kopfzeile">
      <h1 class="nummer-titel">${esc(n.nummer)}</h1>
      ${statusBadge(n.status)}
    </div>

    <section class="karte">
      <dl class="angaben">
        <dt>Medium</dt><dd>${mediumBadge(n.medium)}</dd>
        <dt>Name</dt><dd>${esc(vollerName(n.autor))}</dd>
        <dt>E-Mail</dt><dd><a href="mailto:${esc(n.autor.email)}">${esc(n.autor.email)}</a></dd>
        <dt>Abrechnung</dt><dd>${esc(formatMonat(n.monat))}</dd>
        <dt>Abgeschickt am</dt><dd>${esc(formatZeitpunkt(n.eingereicht_am))}</dd>
        ${n.entschieden_am ? `<dt>Entschieden am</dt><dd>${esc(formatZeitpunkt(n.entschieden_am))}</dd>` : ''}
        ${n.bezahlt_am ? `<dt>Bezahlt am</dt><dd>${esc(formatDatum(n.bezahlt_am))}</dd>` : ''}
      </dl>
      <h2 class="abstand-oben">Leistungen</h2>
      ${positionenTabelle(n, { mitKorrektur: true, saetze: einstellungen.honorarsaetze, pruefen: true })}
      <form id="d-betrag-form" class="unterkarte" hidden novalidate>
        <h3 id="d-betrag-titel">Betrag ändern</h3>
        <div class="zeile">
          <div class="feld"><label for="d-betrag">Neuer Betrag in EUR</label>
            <input id="d-betrag" inputmode="decimal" autocomplete="off" required></div>
          <div class="feld"><label for="d-vermerk">Vermerk (Pflicht, die Autor:in sieht ihn)</label>
            <input id="d-vermerk" required maxlength="500"></div>
        </div>
        <p class="feldfehler" id="d-betrag-fehler" role="alert"></p>
        <div class="aktionen">
          <button type="submit" class="btn btn-primaer">Betrag speichern</button>
          <button type="button" class="btn" id="d-betrag-abbrechen">Abbrechen</button>
        </div>
      </form>
      ${n.status === 'abgelehnt' ? `<p class="fehlerbox"><strong>Ablehnungsgrund:</strong> ${esc(n.ablehnungsgrund)}</p>` : ''}
      ${n.zurueckgeholt_am ? '<p class="hinweisbox">Die Leistungen sind zur Überarbeitung zurück bei der Autor:in. Sie kommen als neue Honorarnote wieder.</p>' : ''}
    </section>

    <div class="spalten">
      <div>
        <section class="karte">
          <h2>Entscheidung</h2>
          ${n.status === 'bezahlt' ? '<p>Bereits bezahlt.</p>' : ''}
          <div class="aktionen">
            ${kannAnnehmen ? '<button type="button" class="btn btn-erfolg" id="d-annehmen">Annehmen</button>' : ''}
            ${kannAblehnen ? '<button type="button" class="btn btn-gefahr" id="d-ablehnen-oeffnen">Ablehnen …</button>' : ''}
          </div>
          <form id="d-ablehnen-form" hidden novalidate>
            <p class="klein">Die Leistungen gehen damit sofort zurück an die Autor:in zum Überarbeiten und Neu-Abschicken
              (als neue Honorarnote). Diese Honorarnote bleibt als „Abgelehnt“ stehen.</p>
            <label for="d-grund">Begründung (Pflicht, die Autor:in sieht diesen Text)</label>
            <textarea id="d-grund" rows="3" required maxlength="1000"></textarea>
            <p class="feldfehler" id="d-grund-fehler" role="alert"></p>
            <div class="aktionen">
              <button type="submit" class="btn btn-gefahr">Ablehnung bestätigen</button>
              <button type="button" class="btn" id="d-ablehnen-abbrechen">Abbrechen</button>
            </div>
          </form>
        </section>
        <section class="karte">
          <h2>Interne Kommentare</h2>
          <p class="tipp">Nur für die Redaktion sichtbar.</p>
          <ul class="kommentare">
            ${kommentare.map((k) => `<li><div class="klein">${esc(k.verfasser_name)} · ${esc(formatZeitpunkt(k.am))}</div>
              <div class="notiz">${esc(k.text)}</div></li>`).join('') || '<li class="klein">Noch keine Kommentare.</li>'}
          </ul>
          <form id="d-komm-form" novalidate>
            <label for="d-komm" class="sr-only">Neuer Kommentar</label>
            <textarea id="d-komm" rows="2" placeholder="Interner Kommentar …" maxlength="2000"></textarea>
            <p class="feldfehler" id="d-komm-fehler" role="alert"></p>
            <button type="submit" class="btn">Kommentar speichern</button>
          </form>
        </section>
      </div>
      <section class="karte">
        <h2>Verlauf</h2>
        <ol class="verlauf">${verlauf.map((e) => `
          <li><div><strong>${esc(AKTION_LABEL[e.aktion] ?? e.aktion)}</strong> – ${esc(e.akteur_name)}</div>
            <div class="klein">${esc(formatZeitpunkt(e.am))}</div>
            ${verlaufDetails(e) ? `<div class="klein">${esc(verlaufDetails(e))}</div>` : ''}</li>`).join('')}
        </ol>
      </section>
    </div>
    ${nutzer.rollen.includes('admin') ? `<p><a href="#/admin/noten">Löschen im Admin-Terminal</a></p>` : ''}`;

  // Aktion ausführen; alle Knöpfe sind währenddessen gesperrt (kein doppeltes Absenden)
  const aktion = async (fn, erfolg) => {
    const knoepfe = Array.from(el.querySelectorAll('button'));
    knoepfe.forEach((k) => { k.disabled = true; });
    try {
      await fn();
      meldung(erfolg, 'erfolg');
      neuLaden();
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
      knoepfe.forEach((k) => { k.disabled = false; });
    }
  };

  el.querySelector('#d-annehmen')?.addEventListener('click', () =>
    aktion(() => store.annehmen(n.id), `${n.nummer} wurde angenommen.`));

  const ablehnenForm = el.querySelector('#d-ablehnen-form');
  el.querySelector('#d-ablehnen-oeffnen')?.addEventListener('click', () => {
    ablehnenForm.hidden = false;
    ablehnenForm.querySelector('textarea').focus();
  });
  el.querySelector('#d-ablehnen-abbrechen').addEventListener('click', () => { ablehnenForm.hidden = true; });
  ablehnenForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const grund = el.querySelector('#d-grund').value.trim();
    el.querySelector('#d-grund-fehler').textContent = grund ? '' : 'Bitte eine Begründung angeben.';
    if (grund) aktion(() => store.ablehnen(n.id, grund), `${n.nummer} wurde abgelehnt.`);
  });

  // Betragskorrektur pro Position
  const betragForm = el.querySelector('#d-betrag-form');
  let positionId = null;
  el.querySelector('.positionen-tabelle').addEventListener('click', (ev) => {
    const knopf = ev.target.closest('[data-korrigieren]');
    if (!knopf) return;
    const p = n.positionen.find((x) => x.id === knopf.dataset.korrigieren);
    positionId = p.id;
    el.querySelector('#d-betrag-titel').textContent = `Betrag ändern: „${p.titel}“ (bisher ${formatEuro(p.betrag)})`;
    betragForm.hidden = false;
    el.querySelector('#d-betrag').focus();
  });
  el.querySelector('#d-betrag-abbrechen').addEventListener('click', () => { betragForm.hidden = true; });
  betragForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const betrag = parseBetrag(el.querySelector('#d-betrag').value);
    const vermerk = el.querySelector('#d-vermerk').value.trim();
    const fehler = el.querySelector('#d-betrag-fehler');
    fehler.textContent = !betrag ? 'Bitte einen gültigen Betrag eingeben.' : !vermerk ? 'Der Vermerk ist Pflicht.' : '';
    if (!fehler.textContent) aktion(() => store.betragKorrigieren(n.id, positionId, betrag, vermerk), 'Betrag wurde geändert.');
  });

  el.querySelector('#d-komm-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = el.querySelector('#d-komm').value.trim();
    el.querySelector('#d-komm-fehler').textContent = text ? '' : 'Der Kommentar ist leer.';
    if (text) aktion(() => store.kommentieren(n.id, text), 'Kommentar gespeichert.');
  });
}
