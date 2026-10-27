// Prüfansicht der Redaktion (rechte Seite in „Redaktion“): jede Leistung mit Haken „geprüft“, Hinweisen
// und Betrag ändern; Annehmen/Zurückgeben, interne Kommentare, Verlauf, Jahressumme der Person.
// Ohne IBAN und Adresse.
import {
  AKTION_LABEL, KATEGORIE_LABEL, artText, esc, formatDatum, formatEuro, formatMonat, formatZeitpunkt, parseBetrag, vollerName,
} from '../lib/format.js';
import { bestaetigen, fehlerText, meldung, statusBadge } from '../lib/ui.js';
import { hatArtikel, mediumBadge, titelLink } from '../lib/campus.js';
import { standardBetrag, weichtAb } from '../lib/honorarsaetze.js';

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

/** Hinweise zu einer Leistung: Satz, Artikel-Link, schon anderswo abgerechnet */
function hinweise(p, n, alle, saetze) {
  const h = [];
  const pos = { ...p, medium: n.medium };
  if (weichtAb(pos, saetze)) {
    const soll = standardBetrag(saetze, pos);
    h.push(['warn', `${(p.betrag_eingereicht ?? p.betrag) > soll ? 'über' : 'unter'} Satz (${formatEuro(soll)})`]);
  }
  if (p.kategorie !== 'redigieren') {
    if (!hatArtikel(p.artikel_url)) {
      h.push(['warn', 'ohne Artikel-Link']);
    } else {
      // derselbe Artikel in einer anderen Abrechnung (zurückgegebene zählen nicht, deren Leistungen kommen neu)
      const doppelt = alle.find((x) => x.id !== n.id && x.status !== 'abgelehnt'
        && x.positionen.some((y) => y.artikel_url === p.artikel_url));
      h.push(doppelt ? ['fehler', `schon in ${doppelt.nummer}`] : ['ok', 'Artikel verknüpft']);
    }
  }
  return h;
}

function positionenHtml(n, alle, saetze, aenderbar) {
  return `
    <table class="tabelle pruef-tabelle">
      <thead><tr><th class="spalte-haken">Geprüft</th><th>Leistung</th><th>Datum</th><th>Hinweis</th><th class="rechts">Betrag</th></tr></thead>
      <tbody>${n.positionen.map((p) => `
        <tr data-pos="${esc(p.id)}" class="${p.geprueft_am ? 'geprueft' : ''}">
          <td data-label="Geprüft" class="spalte-haken"><label class="haken">
            <input type="checkbox" data-pruefen ${p.geprueft_am ? 'checked' : ''} ${aenderbar ? '' : 'disabled'}
              aria-label="${esc(p.titel)} geprüft">
            ${p.geprueft_von ? `<span class="klein">${esc(p.geprueft_von.split(' ')[0])}</span>` : ''}</label></td>
          <td data-label="Leistung"><span>
            <strong>${p.kategorie === 'redigieren' ? esc(p.titel) : `${titelLink(p.artikel_url, p.titel, 'artikel-titel', n.medium)} <span aria-hidden="true">↗</span>`}</strong><br>
            <span class="klein">${esc([KATEGORIE_LABEL[p.kategorie], artText(p)].filter(Boolean).join(' · '))}${
              p.vereinbart_mit ? ` · vereinbart mit ${esc(p.vereinbart_mit)}` : ''}${p.ausgabe ? ` · ${esc(p.ausgabe)}` : ''}</span>
            ${p.notiz ? `<br><span class="notiz-autor">Notiz: ${esc(p.notiz)}</span>` : ''}
            ${p.betrag_vermerk ? `<br><span class="hinweisbox klein">Betrag angepasst: ${esc(p.betrag_vermerk)}</span>` : ''}</span></td>
          <td data-label="Datum">${esc(formatDatum(p.veroeffentlichung))}</td>
          <td data-label="Hinweis"><span class="hinweise">${hinweise(p, n, alle, saetze)
            .map(([art, t]) => `<span class="zeichen zeichen-${art}">${esc(t)}</span>`).join('') || '–'}</span></td>
          <td data-label="Betrag" class="rechts"><span>${esc(formatEuro(p.betrag))}
            ${p.betrag !== p.betrag_eingereicht ? `<br><span class="durchgestrichen">${esc(formatEuro(p.betrag_eingereicht))}</span>` : ''}
            ${aenderbar ? `<br><button type="button" class="link-knopf klein" data-korrigieren="${esc(p.id)}">ändern</button>` : ''}</span></td>
        </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4" class="rechts">Gesamtbetrag</td><td class="rechts"><strong>${esc(formatEuro(n.betrag))}</strong></td></tr></tfoot>
    </table>`;
}

export async function pruefungRendern(el, { store, nutzer, params, alle, einstellungen, vorige, naechste, danach, neuLaden, istAktuell }) {
  let n;
  try {
    n = await store.note(params.id);
  } catch {
    el.innerHTML = '<div class="pruefung-leer"><p><strong>Diese Prämienabrechnung gibt es nicht (mehr).</strong></p></div>';
    return;
  }
  const [kommentare, verlauf] = await Promise.all([store.kommentare(n.id), store.verlaufVon(n.id)]);
  if (!istAktuell()) return;
  const kannAnnehmen = ['eingereicht', 'abgelehnt'].includes(n.status) && !n.zurueckgeholt_am;
  const kannAblehnen = ['eingereicht', 'angenommen'].includes(n.status);
  const aenderbar = n.status !== 'bezahlt';
  const jahr = n.monat.slice(0, 4);
  const imJahr = alle.filter((x) => x.autor_id && x.autor_id === n.autor_id && x.monat.startsWith(jahr) && x.status !== 'abgelehnt');
  const geprueft = () => n.positionen.filter((p) => p.geprueft_am).length;

  el.innerHTML = `
    <p class="nur-handy"><a href="#/redaktion" class="zurueck">← Zur Liste</a></p>
    <div class="pruef-kopf">
      <div>
        <h2>${esc(vollerName(n.autor))} <span class="nummer">${esc(n.nummer)}</span></h2>
        <p class="klein">${esc(formatMonat(n.monat))} · eingereicht ${esc(formatZeitpunkt(n.eingereicht_am))}
          · <a href="mailto:${esc(n.autor.email)}">${esc(n.autor.email)}</a></p>
      </div>
      <span>${mediumBadge(n.medium)} ${statusBadge(n.status)}</span>
    </div>
    <div class="kennzahlen kennzahlen-klein">
      <div class="kennzahl"><span class="kennzahl-titel">Betrag</span><strong>${esc(formatEuro(n.betrag))}</strong></div>
      <div class="kennzahl"><span class="kennzahl-titel">Geprüft</span><strong id="p-geprueft">${geprueft()} / ${n.positionen.length}</strong></div>
      <div class="kennzahl"><span class="kennzahl-titel">${esc(jahr)} bisher (Person)</span>
        <strong>${esc(formatEuro(imJahr.reduce((s, x) => s + Math.round(x.betrag * 100), 0) / 100))}</strong>
        <span class="klein">${imJahr.length} ${imJahr.length === 1 ? 'Abrechnung' : 'Abrechnungen'}</span></div>
    </div>
    ${n.status === 'abgelehnt' ? `<p class="fehlerbox"><strong>Zurückgegeben:</strong> ${esc(n.ablehnungsgrund)}</p>` : ''}
    ${n.zurueckgeholt_am ? '<p class="hinweisbox">Die Leistungen sind zur Überarbeitung zurück bei der Autor:in. Sie kommen als neue Prämienabrechnung wieder.</p>' : ''}
    ${positionenHtml(n, alle, einstellungen.honorarsaetze, aenderbar)}
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

    <div class="entscheidung">
      <div class="aktionen">
        ${kannAnnehmen ? '<button type="button" class="btn btn-erfolg" id="d-annehmen">Annehmen</button>' : ''}
        ${kannAblehnen ? '<button type="button" class="btn btn-gefahr" id="d-ablehnen-oeffnen">Zurückgeben …</button>' : ''}
        ${n.status === 'bezahlt' ? '<span class="klein">Bereits bezahlt.</span>' : ''}
      </div>
      <div class="aktionen blaettern">
        ${vorige ? `<a class="btn" href="#/redaktion/${esc(vorige.id)}">← Vorige</a>` : ''}
        ${naechste ? `<a class="btn" href="#/redaktion/${esc(naechste.id)}">Nächste →</a>` : ''}
      </div>
    </div>
    <form id="d-ablehnen-form" class="unterkarte" hidden novalidate>
      <p class="klein">Die Leistungen gehen sofort zurück an die Autor:in. Sie überarbeitet sie in „Mein Monat“ und reicht neu ein.</p>
      <label for="d-grund">Begründung (Pflicht, die Autor:in sieht diesen Text)</label>
      <textarea id="d-grund" rows="3" required maxlength="1000"></textarea>
      <p class="feldfehler" id="d-grund-fehler" role="alert"></p>
      <div class="aktionen">
        <button type="submit" class="btn btn-gefahr">Zurückgeben</button>
        <button type="button" class="btn" id="d-ablehnen-abbrechen">Abbrechen</button>
      </div>
    </form>

    <div class="spalten pruef-unten">
      <section>
        <h3>Interne Kommentare <span class="klein">(sieht nur die Redaktion)</span></h3>
        <ul class="kommentare">
          ${kommentare.map((k) => `<li><div class="klein">${esc(k.verfasser_name)} · ${esc(formatZeitpunkt(k.am))}</div>
            <div class="notiz">${esc(k.text)}</div></li>`).join('') || '<li class="klein">Noch keine Kommentare.</li>'}
        </ul>
        <form id="d-komm-form" novalidate>
          <label for="d-komm" class="sr-only">Neuer Kommentar</label>
          <textarea id="d-komm" rows="2" placeholder="Interner Kommentar …" maxlength="2000"></textarea>
          <p class="feldfehler" id="d-komm-fehler" role="alert"></p>
          <button type="submit" class="btn btn-klein">Kommentar speichern</button>
        </form>
      </section>
      <section>
        <h3>Verlauf</h3>
        <ol class="verlauf">${verlauf.map((e) => `
          <li><div><strong>${esc(AKTION_LABEL[e.aktion] ?? e.aktion)}</strong> – ${esc(e.akteur_name)}</div>
            <div class="klein">${esc(formatZeitpunkt(e.am))}</div>
            ${verlaufDetails(e) ? `<div class="klein">${esc(verlaufDetails(e))}</div>` : ''}</li>`).join('')}
        </ol>
      </section>
    </div>
    ${nutzer.rollen.includes('admin') ? '<p class="klein"><a href="#/admin/noten">Löschen im Admin</a></p>' : ''}`;

  // Aktion ausführen; alle Knöpfe sind währenddessen gesperrt (kein doppeltes Absenden)
  const aktion = async (fn, erfolg, weiter = false) => {
    const knoepfe = Array.from(el.querySelectorAll('button'));
    knoepfe.forEach((k) => { k.disabled = true; });
    try {
      await fn();
      meldung(erfolg, 'erfolg');
      // nach der Entscheidung gleich zur nächsten Abrechnung
      if (weiter && danach) location.hash = `#/redaktion/${danach.id}`;
      else neuLaden();
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
      knoepfe.forEach((k) => { k.disabled = false; });
    }
  };

  // ---- Haken „geprüft“: sofort speichern, ohne die Seite neu aufzubauen
  el.querySelector('.pruef-tabelle').addEventListener('change', async (ev) => {
    const cb = ev.target.closest('[data-pruefen]');
    if (!cb) return;
    const tr = cb.closest('tr');
    const p = n.positionen.find((x) => x.id === tr.dataset.pos);
    cb.disabled = true;
    try {
      await store.positionPruefen(n.id, p.id, cb.checked);
      p.geprueft_am = cb.checked ? new Date().toISOString() : null;
      tr.classList.toggle('geprueft', cb.checked);
      el.querySelector('#p-geprueft').textContent = `${geprueft()} / ${n.positionen.length}`;
    } catch (e) {
      cb.checked = !cb.checked;
      meldung(fehlerText(e), 'fehler');
    }
    cb.disabled = false;
  });

  el.querySelector('#d-annehmen')?.addEventListener('click', async () => {
    const offen = n.positionen.length - geprueft();
    if (offen && !(await bestaetigen({
      titel: 'Noch nicht alles geprüft',
      html: `<p>${offen} von ${n.positionen.length} Leistungen ${offen === 1 ? 'hat' : 'haben'} noch keinen Haken „geprüft“.
        Trotzdem annehmen?</p>`,
      ja: 'Trotzdem annehmen',
    }))) return;
    aktion(() => store.annehmen(n.id), `${n.nummer} wurde angenommen.`, true);
  });

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
    if (grund) aktion(() => store.ablehnen(n.id, grund), `${n.nummer} wurde zurückgegeben.`, true);
  });

  // ---- Betragskorrektur pro Leistung
  const betragForm = el.querySelector('#d-betrag-form');
  let positionId = null;
  el.querySelector('.pruef-tabelle').addEventListener('click', (ev) => {
    const knopf = ev.target.closest('[data-korrigieren]');
    if (!knopf) return;
    const p = n.positionen.find((x) => x.id === knopf.dataset.korrigieren);
    positionId = p.id;
    el.querySelector('#d-betrag-titel').textContent = `Betrag ändern: „${p.titel}“ (bisher ${formatEuro(p.betrag)})`;
    el.querySelector('#d-betrag').value = '';
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
