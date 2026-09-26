// Autor:in: Leistungen laufend speichern und einmal im Monat als Honorarnote abschicken
import {
  ART_LABEL, KATEGORIE_LABEL, esc, formatBetragPlain, formatDatum, formatEuro, formatMonat, heuteIso, parseBetrag, summe,
} from '../lib/format.js';
import { formatIban } from '../lib/iban.js';
import { fehlerText, meldung, mitSperre } from '../lib/ui.js';

let bearbeiteId = null; // Leistung, die gerade im Formular bearbeitet wird

function formularHtml(p) {
  const kat = p?.kategorie ?? 'kolumne';
  return `
    <form class="karte" id="l-form" novalidate>
      <h2>${p ? 'Leistung bearbeiten' : 'Neue Leistung speichern'}</h2>
      <fieldset class="kategorie">
        <legend class="sr-only">Art des Honorars</legend>
        <label class="radio"><input type="radio" name="kategorie" value="kolumne" ${kat === 'kolumne' ? 'checked' : ''}>
          <span><strong>Kolumne</strong><br><span class="klein">reguläres Honorar</span></span></label>
        <label class="radio"><input type="radio" name="kategorie" value="ausserordentlich" ${kat === 'ausserordentlich' ? 'checked' : ''}>
          <span><strong>Außerordentliches Honorar</strong><br><span class="klein">extra mit der Redaktion vereinbart</span></span></label>
      </fieldset>
      <div class="feld">
        <label for="l-titel">Titel des Beitrags <span class="pflicht" aria-hidden="true">*</span></label>
        <input id="l-titel" name="titel" required maxlength="200" value="${esc(p?.titel)}">
        <p class="feldfehler" data-fehler="titel"></p>
      </div>
      <div class="zeile">
        <div class="feld">
          <label for="l-art">Art der Leistung</label>
          <select id="l-art" name="art">
            ${Object.entries(ART_LABEL).map(([w, l]) => `<option value="${w}" ${(p?.art ?? 'artikel') === w ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="feld">
          <label for="l-datum">Veröffentlichung <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-datum" name="veroeffentlichung" type="date" required value="${esc(p?.veroeffentlichung ?? heuteIso())}">
          <p class="feldfehler" data-fehler="veroeffentlichung"></p>
        </div>
      </div>
      <div class="zeile">
        <div class="feld">
          <label for="l-betrag">Betrag in EUR <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-betrag" name="betrag" inputmode="decimal" autocomplete="off" placeholder="15,00" required
                 value="${p ? esc(formatBetragPlain(p.betrag)) : ''}">
          <p class="feldfehler" data-fehler="betrag"></p>
        </div>
        <div class="feld" id="l-vereinbart-feld" ${kat === 'ausserordentlich' ? '' : 'hidden'}>
          <label for="l-vereinbart">Vereinbart mit <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-vereinbart" name="vereinbart_mit" maxlength="100" placeholder="Name aus der Redaktion" value="${esc(p?.vereinbart_mit)}">
          <p class="feldfehler" data-fehler="vereinbart_mit"></p>
        </div>
      </div>
      <details class="aufklapp" ${p?.ausgabe || p?.notiz ? 'open' : ''}>
        <summary>Ausgabe und Notiz (optional)</summary>
        <div class="feld">
          <label for="l-ausgabe">Ausgabe</label>
          <input id="l-ausgabe" name="ausgabe" maxlength="100" placeholder="z. B. Ausgabe 3/2026" value="${esc(p?.ausgabe)}">
        </div>
        <div class="feld">
          <label for="l-notiz">Notiz an die Redaktion</label>
          <textarea id="l-notiz" name="notiz" rows="2" maxlength="1000">${esc(p?.notiz)}</textarea>
        </div>
      </details>
      <p class="feldfehler" data-fehler="formular" role="alert"></p>
      <div class="aktionen">
        <button class="btn btn-primaer" type="submit">${p ? 'Änderung speichern' : 'Leistung speichern'}</button>
        ${p ? '<button class="btn" type="button" id="l-abbrechen">Abbrechen</button>' : ''}
      </div>
    </form>`;
}

export async function render(el, { store, nutzer, navigate, setFlash, neuLaden, istAktuell }) {
  const [liste, diesenMonat, naechste, einstellungen] = await Promise.all([
    store.meineLeistungen(), store.notenDiesenMonat(), store.naechsteNummer(), store.einstellungen(),
  ]);
  if (!istAktuell()) return;
  const bearbeite = liste.find((p) => p.id === bearbeiteId) ?? null;
  if (!bearbeite) bearbeiteId = null;
  const profilOk = store.profilVollstaendig(nutzer);
  const gesamt = summe(liste);

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Meine Leistungen</h1>
      <a href="#/noten" class="btn">Meine Honorarnoten</a>
    </div>
    <p class="einleitung">Speichere deine Beiträge, sobald sie erschienen sind. Einmal im Monat schickst du alle
      gesammelten Leistungen gemeinsam als Honorarnote ab.</p>
    ${!profilOk ? `<p class="hinweisbox">Bevor du abschicken kannst: Bitte <a href="#/profil">Adresse und
      Bankverbindung im Profil</a> ergänzen. Du musst sie nur einmal eingeben.</p>` : ''}

    <div class="spalten">
      <div>${formularHtml(bearbeite)}</div>
      <div>
        <section class="karte">
          <h2>Gespeichert, noch nicht abgerechnet</h2>
          ${liste.length ? `
          <form id="abrechnung-form">
            <ul class="positionen">
              ${liste.map((p) => `
                <li class="position${p.id === bearbeiteId ? ' in-bearbeitung' : ''}">
                  <label class="position-wahl">
                    <input type="checkbox" name="pos" value="${esc(p.id)}" checked aria-label="${esc(p.titel)} abrechnen">
                    <span>
                      <strong>${esc(p.titel)}</strong><br>
                      <span class="klein">${esc(KATEGORIE_LABEL[p.kategorie])} · ${esc(ART_LABEL[p.art] ?? '')} · ${esc(formatDatum(p.veroeffentlichung))}
                        ${p.vereinbart_mit ? ` · vereinbart mit ${esc(p.vereinbart_mit)}` : ''}</span>
                    </span>
                  </label>
                  <span class="position-betrag">${esc(formatEuro(p.betrag))}</span>
                  <span class="position-aktionen">
                    <button type="button" class="btn btn-klein" data-bearbeiten="${esc(p.id)}">Bearbeiten</button>
                    <button type="button" class="btn btn-klein btn-gefahr" data-loeschen="${esc(p.id)}">Löschen</button>
                  </span>
                </li>`).join('')}
            </ul>
            <p class="summenzeile">Ausgewählt: <strong id="abr-summe">${esc(formatEuro(gesamt))}</strong></p>
          </form>` : '<p class="klein">Noch keine Leistungen gespeichert.</p>'}
        </section>

        ${liste.length ? `
        <section class="karte abschicken">
          <h2>Monatsabrechnung ${esc(formatMonat(heuteIso()))}</h2>
          ${diesenMonat.length ? `<p class="hinweisbox">Du hast diesen Monat schon ${diesenMonat.map((n) => `<strong>${esc(n.nummer)}</strong>`).join(', ')}
            abgeschickt. Normalerweise wird einmal pro Monat abgerechnet – weitere Leistungen kannst du auch
            nächsten Monat mitschicken.</p>` : ''}
          <dl class="angaben kompakt">
            <dt>Nummer</dt><dd class="nummer">${esc(naechste.nummer)}</dd>
            <dt>An</dt><dd>${esc(einstellungen.empfaenger.name)}</dd>
            <dt>Überweisung an</dt><dd>${profilOk ? `${esc(nutzer.profil.kontoinhaber)}<br><span class="mono">${esc(formatIban(nutzer.profil.iban))}</span>` : '–'}</dd>
          </dl>
          <button type="button" class="btn btn-primaer btn-breit" id="abschicken" ${profilOk ? '' : 'disabled'}>
            Honorarnote abschicken
          </button>
          <p class="hinweis">Die Adresse und Bankverbindung kommen aus deinem <a href="#/profil">Profil</a>.
            Der Rechnungsbetrag ist laut § 6 Abs 1 Z 27 UStG umsatzsteuerfrei.</p>
        </section>` : ''}
      </div>
    </div>`;

  // ---- Formular
  const form = el.querySelector('#l-form');
  const fehler = (name, t) => { const e = form.querySelector(`[data-fehler="${name}"]`); if (e) e.textContent = t || ''; };
  form.addEventListener('input', (ev) => ev.target.name && fehler(ev.target.name, ''));
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'kategorie') {
      el.querySelector('#l-vereinbart-feld').hidden = form.kategorie.value !== 'ausserordentlich';
    }
  });
  el.querySelector('#l-abbrechen')?.addEventListener('click', () => { bearbeiteId = null; neuLaden(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    ['titel', 'veroeffentlichung', 'betrag', 'vereinbart_mit', 'formular'].forEach((n) => fehler(n, ''));
    const betrag = parseBetrag(form.betrag.value);
    const f = {};
    if (!form.titel.value.trim()) f.titel = 'Bitte den Titel angeben.';
    if (!form.veroeffentlichung.value) f.veroeffentlichung = 'Bitte Datum wählen.';
    if (!betrag) f.betrag = 'Bitte einen Betrag wie 15 oder 15,50 eingeben.';
    if (form.kategorie.value === 'ausserordentlich' && !form.vereinbart_mit.value.trim()) {
      f.vereinbart_mit = 'Mit wem aus der Redaktion wurde das vereinbart?';
    }
    if (Object.keys(f).length) {
      Object.entries(f).forEach(([n, t]) => fehler(n, t));
      form.elements[Object.keys(f)[0]].focus();
      return;
    }
    const knopf = form.querySelector('button[type=submit]');
    knopf.disabled = true;
    try {
      await store.leistungSpeichern({
        id: bearbeiteId ?? undefined,
        kategorie: form.kategorie.value, art: form.art.value, titel: form.titel.value,
        veroeffentlichung: form.veroeffentlichung.value, betrag, vereinbart_mit: form.vereinbart_mit.value,
        ausgabe: form.ausgabe.value, notiz: form.notiz.value,
      });
      meldung(bearbeiteId ? 'Änderung gespeichert.' : 'Leistung gespeichert.', 'erfolg');
      bearbeiteId = null;
      neuLaden();
    } catch (e) {
      fehler('formular', fehlerText(e));
      knopf.disabled = false;
    }
  });

  // ---- Liste
  const abrForm = el.querySelector('#abrechnung-form');
  const gewaehlt = () => Array.from(abrForm?.querySelectorAll('input[name=pos]:checked') ?? [], (i) => i.value);
  abrForm?.addEventListener('change', () => {
    const ids = gewaehlt();
    el.querySelector('#abr-summe').textContent = formatEuro(summe(liste.filter((p) => ids.includes(p.id))));
    const knopf = el.querySelector('#abschicken');
    if (knopf) knopf.disabled = !profilOk || !ids.length;
  });
  abrForm?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-bearbeiten]');
    const l = ev.target.closest('[data-loeschen]');
    if (b) {
      bearbeiteId = b.dataset.bearbeiten;
      neuLaden();
    } else if (l) {
      const p = liste.find((x) => x.id === l.dataset.loeschen);
      if (!confirm(`„${p.titel}“ wirklich löschen?`)) return;
      try {
        await store.leistungLoeschen(p.id);
        meldung('Leistung gelöscht.');
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
      if (bearbeiteId === p.id) bearbeiteId = null;
      neuLaden();
    }
  });

  el.querySelector('#abschicken')?.addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    const ids = gewaehlt();
    const auswahl = liste.filter((p) => ids.includes(p.id));
    const text = `${auswahl.length} ${auswahl.length === 1 ? 'Leistung' : 'Leistungen'} über ${formatEuro(summe(auswahl))} `
      + `als Honorarnote ${naechste.nummer} abschicken?`
      + (diesenMonat.length ? '\n\nHinweis: Du hast diesen Monat schon eine Honorarnote abgeschickt.' : '');
    if (!confirm(text)) return;
    try {
      const note = await store.abrechnungAbschicken(ids);
      bearbeiteId = null;
      setFlash({ neu: note.nummer });
      navigate('noten');
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    }
  }));
}
