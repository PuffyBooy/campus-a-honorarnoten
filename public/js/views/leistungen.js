// Autor:in: Leistungen laufend speichern und einmal im Monat als Honorarnote abschicken
import {
  KATEGORIE_LABEL, artText, esc, formatBetragPlain, formatDatum, formatEuro, formatMonat, heuteIso, parseBetrag, summe,
} from '../lib/format.js';
import { formatIban } from '../lib/iban.js';
import {
  MEDIEN, MEDIUM_KEYS, PROFIL_FELD, STANDARD_MEDIUM, artikelLink, hatArtikel, mediumBadge, mediumName, mediumOder,
} from '../lib/campus.js';
import { satzFuer } from '../lib/honorarsaetze.js';
import { fehlerText, meldung, mitSperre } from '../lib/ui.js';

let bearbeiteId = null; // Leistung, die gerade im Formular bearbeitet wird

const satzText = (satz) => (satz != null ? formatBetragPlain(satz) : '');

function satzHinweis(medium, kategorie, saetze) {
  const satz = satzFuer(saetze, medium, kategorie);
  if (satz == null) return kategorie === 'ausserordentlich' ? 'Betrag laut Vereinbarung mit der Redaktion.' : '';
  return `Standardsatz ${mediumName(medium)}: ${formatEuro(satz)}`;
}

const artikelVermerk = (url, medium) => `Verknüpft mit ${artikelLink(url, 'dem Artikel', '', medium)} ·
  <button type="button" class="link-knopf" id="l-artikel-loesen">Verknüpfung lösen</button>`;

/** Vorauswahl des Mediums: das, für das ein Profil-Link hinterlegt ist (bei beiden: campus a college) */
function standardMedium(nutzer) {
  return MEDIUM_KEYS.find((m) => nutzer.profil?.[PROFIL_FELD[m]]) ?? STANDARD_MEDIUM;
}

function artikelKarteHtml(daten) {
  if (!daten) return '<p class="klein" role="status">Artikel werden geladen … Beim ersten Mal kann das bis zu einer Minute dauern.</p>';
  if (daten.fehler) return `<p class="fehlerbox" role="alert">${esc(daten.fehler)}</p>`;
  if (!daten.verknuepft) {
    return '<p class="klein">Trag im <a href="#/profil">Profil</a> den Link zu deiner Profilseite auf campus-a-college.at oder campus-a.at ein, dann erscheinen hier alle deine Artikel.</p>';
  }
  const offen = daten.artikel.filter((a) => !a.erfasst).length;
  const seiten = (daten.medien ?? []).map((m) => MEDIEN[m].seite).join(' und ');
  return `
    ${daten.demo ? `<p class="tipp">Demo: Beispielartikel. Im echten Betrieb stehen hier deine Artikel von ${esc(seiten)}.</p>` : ''}
    ${daten.warnung ? `<p class="hinweisbox">${esc(daten.warnung)}</p>` : ''}
    <p class="klein">${daten.artikel.length} Artikel von ${esc(seiten)}, davon ${offen} noch nicht erfasst.</p>
    ${daten.artikel.length ? `<ul class="artikel-liste">
      ${daten.artikel.map((a, i) => `
        <li class="artikel${a.erfasst ? ' erfasst' : ''}">
          <span>
            <strong>${artikelLink(a.url, a.titel, '', a.medium)}</strong><br>
            <span class="klein">${(daten.medien ?? []).length > 1 ? `${mediumBadge(a.medium)} ` : ''}${[a.datum ? formatDatum(a.datum) : 'Datum unbekannt', a.ressort, a.kategorie].filter(Boolean).map(esc).join(' · ')}</span>
          </span>
          ${a.erfasst ? '<span class="badge badge-bezahlt">erfasst</span>'
            : `<button type="button" class="btn btn-klein" data-uebernehmen="${i}">Übernehmen</button>`}
        </li>`).join('')}
    </ul>` : ''}
    <button type="button" class="link-knopf" id="artikel-neu">Liste aktualisieren</button>`;
}

function formularHtml(p, einstellungen, nutzer) {
  const saetze = einstellungen.honorarsaetze;
  const kat = p?.kategorie ?? 'kolumne';
  const medium = p ? mediumOder(p.medium) : standardMedium(nutzer);
  return `
    <form class="karte" id="l-form" novalidate>
      <h2>${p ? 'Leistung bearbeiten' : 'Neue Leistung speichern'}</h2>
      <fieldset class="kategorie medium-wahl">
        <legend>Für</legend>
        ${MEDIUM_KEYS.map((m) => `
        <label class="radio"><input type="radio" name="medium" value="${m}" ${m === medium ? 'checked' : ''}>
          <span><strong>${esc(MEDIEN[m].name)}</strong></span></label>`).join('')}
      </fieldset>
      <fieldset class="kategorie">
        <legend class="sr-only">Kategorie</legend>
        <label class="radio"><input type="radio" name="kategorie" value="kolumne" ${kat === 'kolumne' ? 'checked' : ''}>
          <span><strong>Kolumne</strong></span></label>
        <label class="radio"><input type="radio" name="kategorie" value="ausserordentlich" ${kat === 'ausserordentlich' ? 'checked' : ''}>
          <span><strong>Außerordentliches Honorar</strong></span></label>
      </fieldset>
      <div class="feld">
        <label for="l-titel">Titel des Beitrags <span class="pflicht" aria-hidden="true">*</span></label>
        <input id="l-titel" name="titel" required maxlength="200" value="${esc(p?.titel)}">
        <p class="feldfehler" data-fehler="titel"></p>
        <input type="hidden" name="artikel_url" value="${esc(p?.artikel_url)}">
        <p class="klein" id="l-artikel" ${p?.artikel_url ? '' : 'hidden'}>${p?.artikel_url ? artikelVermerk(p.artikel_url, medium) : ''}</p>
      </div>
      <div class="zeile">
        <div class="feld" id="l-art-feld" ${kat === 'kolumne' ? 'hidden' : ''}>
          <label for="l-art">Art des Honorars <span class="pflicht" aria-hidden="true">*</span></label>
          <input id="l-art" name="art" maxlength="100" autocomplete="off" placeholder="z. B. Interview, Reportage, Fotostrecke"
                 value="${esc(p ? artText(p) : '')}">
          <p class="feldfehler" data-fehler="art"></p>
        </div>
        <div class="feld" id="l-kolumnenart-feld" ${kat === 'kolumne' ? '' : 'hidden'}>
          <label for="l-kolumnenart">Art der Kolumne <span class="optional">(optional)</span></label>
          <input id="l-kolumnenart" name="kolumnenart" maxlength="100" autocomplete="off" value="${esc(p?.kolumnenart)}">
          <p class="feldfehler" data-fehler="kolumnenart"></p>
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
                 value="${p ? esc(formatBetragPlain(p.betrag)) : esc(satzText(satzFuer(saetze, medium, kat)))}" aria-describedby="l-satz-hinweis">
          <p class="hinweis" id="l-satz-hinweis">${esc(satzHinweis(medium, kat, saetze))}</p>
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
  // campus a und campus a college werden getrennt abgerechnet: eine Karte pro Medium
  const gruppen = MEDIUM_KEYS.map((m) => ({ medium: m, positionen: liste.filter((p) => mediumOder(p.medium) === m) }))
    .filter((g) => g.positionen.length);

  el.innerHTML = `
    <div class="kopfzeile">
      <h1>Meine Leistungen</h1>
      <a href="#/noten" class="btn">Meine Honorarnoten</a>
    </div>
    <p class="tipp">Beiträge speichern, sobald sie erschienen sind – einmal im Monat gesammelt abschicken,
      getrennt für campus a college und campus a.</p>

    <div class="spalten">
      <div>
        ${formularHtml(bearbeite, einstellungen, nutzer)}
        <section class="karte" id="artikel-karte" aria-live="polite">
          <h2>Meine Artikel</h2>
          <div id="artikel-inhalt">${artikelKarteHtml(null)}</div>
        </section>
      </div>
      <div id="abrechnungen">
        ${gruppen.length ? gruppen.map(({ medium, positionen }) => {
          const schon = diesenMonat.filter((n) => mediumOder(n.medium) === medium);
          return `
        <section class="karte abschicken" data-medium="${esc(medium)}">
          <h2>${mediumBadge(medium)} Noch nicht abgerechnet</h2>
          <ul class="positionen">
            ${positionen.map((p) => `
              <li class="position${p.id === bearbeiteId ? ' in-bearbeitung' : ''}">
                <label class="position-wahl">
                  <input type="checkbox" name="pos" value="${esc(p.id)}" checked aria-label="${esc(p.titel)} abrechnen">
                  <span>
                    <strong>${esc(p.titel)}</strong><br>
                    <span class="klein">${[KATEGORIE_LABEL[p.kategorie], artText(p), formatDatum(p.veroeffentlichung)].filter(Boolean).map(esc).join(' · ')}
                      ${p.vereinbart_mit ? ` · vereinbart mit ${esc(p.vereinbart_mit)}` : ''}
                      ${hatArtikel(p.artikel_url) ? ` · ${artikelLink(p.artikel_url, 'Artikel ansehen', '', medium)}` : ''}</span>
                  </span>
                </label>
                <span class="position-betrag">${esc(formatEuro(p.betrag))}</span>
                <span class="position-aktionen">
                  <button type="button" class="btn btn-klein" data-bearbeiten="${esc(p.id)}">Bearbeiten</button>
                  <button type="button" class="btn btn-klein btn-gefahr" data-loeschen="${esc(p.id)}">Löschen</button>
                </span>
              </li>`).join('')}
          </ul>
          <p class="summenzeile">Ausgewählt: <strong data-summe>${esc(formatEuro(summe(positionen)))}</strong></p>
          <h3>Monatsabrechnung ${esc(formatMonat(heuteIso()))} · ${esc(mediumName(medium))}</h3>
          ${schon.length ? `<p class="hinweisbox">Diesen Monat schon abgeschickt: ${schon.map((n) => `<strong>${esc(n.nummer)}</strong>`).join(', ')}</p>` : ''}
          <dl class="angaben kompakt">
            <dt>Nummer</dt><dd class="nummer">${esc(naechste.nummer)}</dd>
            <dt>An</dt><dd>${esc(einstellungen.empfaenger.name)}</dd>
            <dt>Überweisung an</dt><dd>${esc(nutzer.profil.kontoinhaber)}<br><span class="mono">${esc(formatIban(nutzer.profil.iban))}</span></dd>
          </dl>
          <button type="button" class="btn btn-primaer btn-breit" data-abschicken>Honorarnote ${esc(mediumName(medium))} abschicken</button>
        </section>`;
        }).join('') : '<section class="karte"><h2>Noch nicht abgerechnet</h2><p class="klein">Noch keine Leistungen gespeichert.</p></section>'}
      </div>
    </div>`;

  // ---- Formular
  const form = el.querySelector('#l-form');
  const fehler = (name, t) => { const e = form.querySelector(`[data-fehler="${name}"]`); if (e) e.textContent = t || ''; };
  form.addEventListener('input', (ev) => ev.target.name && fehler(ev.target.name, ''));
  // Medium oder Kategorie gewechselt: Standardsatz übernehmen, solange der Betrag nicht selbst geändert wurde
  const saetze = einstellungen.honorarsaetze ?? {};
  let letzterSatz = satzFuer(saetze, form.medium.value, form.kategorie.value);
  const auswahlAnpassen = () => {
    const kat = form.kategorie.value;
    const medium = form.medium.value;
    el.querySelector('#l-vereinbart-feld').hidden = kat !== 'ausserordentlich';
    el.querySelector('#l-art-feld').hidden = kat === 'kolumne';
    el.querySelector('#l-kolumnenart-feld').hidden = kat !== 'kolumne';
    el.querySelector('#l-satz-hinweis').textContent = satzHinweis(medium, kat, saetze);
    const satz = satzFuer(saetze, medium, kat);
    const bisher = form.betrag.value.trim();
    if (!bisher || parseBetrag(bisher) === letzterSatz) form.betrag.value = satzText(satz);
    letzterSatz = satz;
  };
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'kategorie') auswahlAnpassen();
    if (ev.target.name === 'medium') {
      auswahlAnpassen();
      // ein verknüpfter Artikel gehört zu einem Medium – passt er nicht mehr, Verknüpfung lösen
      if (form.artikel_url.value && artikelMedium !== form.medium.value) artikelSetzen('');
    }
  });
  el.querySelector('#l-abbrechen')?.addEventListener('click', () => { bearbeiteId = null; neuLaden(); });

  // ---- Artikel von campus-a-college.at und campus-a.at
  const artikelAnzeige = el.querySelector('#l-artikel');
  let artikelMedium = bearbeite ? mediumOder(bearbeite.medium) : null;
  function artikelSetzen(url, medium = form.medium.value) {
    form.artikel_url.value = url;
    artikelMedium = url ? medium : null;
    artikelAnzeige.hidden = !url;
    artikelAnzeige.innerHTML = url ? artikelVermerk(url, medium) : '';
  }
  artikelAnzeige.addEventListener('click', (ev) => {
    if (ev.target.closest('#l-artikel-loesen')) artikelSetzen('');
  });

  const artikelInhalt = el.querySelector('#artikel-inhalt');
  let artikelDaten = null;
  const artikelLaden = async (neu = false) => {
    artikelInhalt.innerHTML = artikelKarteHtml(null);
    try {
      artikelDaten = await store.meineArtikel({ neu });
    } catch (e) {
      artikelDaten = { fehler: fehlerText(e) };
    }
    if (!istAktuell()) return;
    artikelInhalt.innerHTML = artikelKarteHtml(artikelDaten);
  };
  artikelInhalt.addEventListener('click', (ev) => {
    if (ev.target.closest('#artikel-neu')) {
      artikelLaden(true);
      return;
    }
    const knopf = ev.target.closest('[data-uebernehmen]');
    const a = knopf && artikelDaten?.artikel?.[Number(knopf.dataset.uebernehmen)];
    if (!a) return;
    form.titel.value = a.titel;
    if (a.datum) form.veroeffentlichung.value = a.datum;
    if (form.medium.value !== a.medium) {
      form.medium.value = a.medium;
      auswahlAnpassen();
    }
    artikelSetzen(a.url, a.medium);
    ['titel', 'veroeffentlichung', 'formular'].forEach((n) => fehler(n, ''));
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.titel.focus({ preventScroll: true });
    meldung('Artikel übernommen – bitte prüfen und speichern.');
  });
  artikelLaden();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    ['titel', 'art', 'veroeffentlichung', 'betrag', 'vereinbart_mit', 'formular'].forEach((n) => fehler(n, ''));
    const betrag = parseBetrag(form.betrag.value);
    const f = {};
    if (!form.titel.value.trim()) f.titel = 'Bitte den Titel angeben.';
    if (!form.veroeffentlichung.value) f.veroeffentlichung = 'Bitte Datum wählen.';
    if (!betrag) f.betrag = 'Bitte einen Betrag wie 15 oder 15,50 eingeben.';
    if (form.kategorie.value === 'ausserordentlich' && !form.art.value.trim()) f.art = 'Bitte die Art des Honorars angeben.';
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
        medium: form.medium.value, kategorie: form.kategorie.value, art: form.art.value, kolumnenart: form.kolumnenart.value, titel: form.titel.value,
        artikel_url: form.artikel_url.value,
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

  // ---- Listen (eine pro Medium)
  const abrechnungen = el.querySelector('#abrechnungen');
  const gewaehlt = (karte) => Array.from(karte.querySelectorAll('input[name=pos]:checked'), (i) => i.value);
  abrechnungen.addEventListener('change', (ev) => {
    const karte = ev.target.closest('[data-medium]');
    if (!karte) return;
    const ids = gewaehlt(karte);
    karte.querySelector('[data-summe]').textContent = formatEuro(summe(liste.filter((p) => ids.includes(p.id))));
    karte.querySelector('[data-abschicken]').disabled = !ids.length;
  });
  abrechnungen.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-bearbeiten]');
    const l = ev.target.closest('[data-loeschen]');
    const a = ev.target.closest('[data-abschicken]');
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
    } else if (a) {
      const karte = a.closest('[data-medium]');
      const medium = karte.dataset.medium;
      const ids = gewaehlt(karte);
      const auswahl = liste.filter((p) => ids.includes(p.id));
      const schon = diesenMonat.some((n) => mediumOder(n.medium) === medium);
      const text = `${auswahl.length} ${auswahl.length === 1 ? 'Leistung' : 'Leistungen'} über ${formatEuro(summe(auswahl))} `
        + `als Honorarnote ${mediumName(medium)} (${naechste.nummer}) abschicken?`
        + (schon ? `\n\nHinweis: Du hast diesen Monat schon eine Honorarnote für ${mediumName(medium)} abgeschickt.` : '');
      if (!confirm(text)) return;
      await mitSperre(a, async () => {
        try {
          const note = await store.abrechnungAbschicken(ids);
          bearbeiteId = null;
          setFlash({ neu: note.nummer });
          navigate('noten');
        } catch (e) {
          meldung(fehlerText(e), 'fehler');
        }
      });
    }
  });
}
