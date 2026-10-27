// Konto einrichten: Pflicht beim ersten Anmelden mit dem Startpasswort.
// Alle legen ein eigenes Passwort fest; Autor:innen tragen außerdem Adresse, Bankverbindung und
// mindestens einen Profil-Link (campus-a-college.at und/oder campus-a.at) ein. Vorher geht nichts anderes.
import { esc } from '../lib/format.js';
import { formatIban, ibanFehler, bicIstGueltig } from '../lib/iban.js';
import { MEDIEN, MEDIUM_KEYS, PROFIL_FELD, profilIdAusLink, profilLink } from '../lib/campus.js';
import { fehlerText, mitSperre } from '../lib/ui.js';
import { hinweisHtml, hinweisOffen } from '../lib/rechtliches.js';

function feld(name, label, wert, { typ = 'text', pflicht = true, attrs = '', hinweis = '' } = {}) {
  return `
    <div class="feld">
      <label for="e-${name}">${esc(label)}${pflicht ? ' <span class="pflicht" aria-hidden="true">*</span>' : ' <span class="optional">(optional)</span>'}</label>
      <input id="e-${name}" name="${name}" type="${typ}" value="${esc(wert)}" ${pflicht ? 'required' : ''} ${attrs}>
      ${hinweis ? `<p class="hinweis">${hinweis}</p>` : ''}
      <p class="feldfehler" data-fehler="${name}"></p>
    </div>`;
}

export function render(el, { store, nutzer, recht, weiter, abmelden }) {
  const p = nutzer.profil ?? {};
  const istAutor = nutzer.rollen.includes('autor');
  let passwortNoetig = nutzer.muss_passwort_aendern;
  // Hinweis zum Betreiber (nicht bei campus a angestellt) muss beim Einrichten bestätigt werden
  const hinweisNoetig = Boolean(recht && hinweisOffen(nutzer, recht.betreiber));

  el.innerHTML = `
    <section class="karte einrichtung">
      <h1>Willkommen, ${esc(nutzer.vorname)}!</h1>
      <p>${istAutor
        ? 'Bevor du loslegst, richte bitte dein Konto ein. Diese Angaben kommen automatisch auf jede Honorarnote.'
        : 'Bevor du loslegst, lege bitte dein eigenes Passwort fest.'}</p>
      <form id="einrichtung-form" novalidate>
        <fieldset id="e-passwort" ${passwortNoetig ? '' : 'hidden'}>
          <legend>1. Eigenes Passwort</legend>
          <input type="text" name="username" value="${esc(nutzer.email)}" autocomplete="username" hidden>
          <div class="zeile">
            ${feld('neu', 'Neues Passwort (mind. 8 Zeichen)', '', { typ: 'password', attrs: 'autocomplete="new-password" minlength="8"' })}
            ${feld('wdh', 'Passwort wiederholen', '', { typ: 'password', attrs: 'autocomplete="new-password" minlength="8"' })}
          </div>
        </fieldset>
        <fieldset>
          <legend>${passwortNoetig ? '2. ' : ''}Persönliche Daten</legend>
          <div class="zeile">
            ${feld('vorname', 'Vorname', nutzer.vorname, { attrs: 'autocomplete="given-name" maxlength="100"' })}
            ${feld('nachname', 'Nachname', nutzer.nachname, { attrs: 'autocomplete="family-name" maxlength="100"' })}
          </div>
          ${istAutor ? `
          ${feld('strasse', 'Straße und Hausnummer', p.strasse, { attrs: 'autocomplete="address-line1" maxlength="150"' })}
          ${feld('plz_ort', 'PLZ und Ort', p.plz_ort, { attrs: 'autocomplete="postal-code" maxlength="100" placeholder="1010 Wien"' })}` : ''}
        </fieldset>
        ${istAutor ? `
        <fieldset>
          <legend>${passwortNoetig ? '3. ' : ''}Bankverbindung</legend>
          ${feld('kontoinhaber', 'Kontoinhaber:in', p.kontoinhaber || `${nutzer.vorname} ${nutzer.nachname}`.trim(), { attrs: 'autocomplete="name" maxlength="70"' })}
          <div class="zeile">
            ${feld('iban', 'IBAN', formatIban(p.iban), { attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="42" placeholder="AT.. .... .... .... ...."' })}
            ${feld('bic', 'BIC', p.bic, { pflicht: false, attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="11"' })}
          </div>
        </fieldset>
        <fieldset>
          <legend>${passwortNoetig ? '4. ' : ''}Dein Profil auf der Webseite</legend>
          <p class="hinweis">Mindestens einen Link angeben – für das Medium, für das du schreibst. Den Link findest du,
            wenn du auf der Webseite auf deinen Namen klickst.</p>
          ${MEDIUM_KEYS.map((m) => feld(PROFIL_FELD[m], `Profil auf ${MEDIEN[m].seite} (${MEDIEN[m].name})`, profilLink(p[PROFIL_FELD[m]], m), {
            typ: 'url', pflicht: false,
            attrs: `autocomplete="off" spellcheck="false" maxlength="200" placeholder="${esc(MEDIEN[m].basis)}/profil/…"`,
          })).join('')}
          <p class="feldfehler" data-fehler="links"></p>
        </fieldset>
        <aside class="datenschutz" aria-label="Datenschutzhinweis">
          <strong>Datenschutz:</strong> Adresse und Bankverbindung sieht nur die Buchhaltung, sie dienen nur der Auszahlung. Mehr in der <a href="#/datenschutz" target="_blank">Datenschutzerklärung</a>.
        </aside>` : ''}
        ${hinweisNoetig ? `
        <aside class="hinweis-betreiber">${hinweisHtml(recht)}</aside>
        <label class="check bestaetigen"><input type="checkbox" name="hinweis" required>
          Ich habe den Hinweis und die <a href="#/datenschutz" target="_blank">Datenschutzerklärung</a> zur Kenntnis genommen.</label>
        <p class="feldfehler" data-fehler="hinweis"></p>` : ''}
        <p class="feldfehler" data-fehler="formular" role="alert"></p>
        <button class="btn btn-primaer btn-breit" type="submit">${istAutor ? 'Konto einrichten' : 'Passwort speichern'}</button>
      </form>
      <p><button type="button" class="btn-link" id="e-abmelden">Abmelden</button></p>
    </section>`;

  const form = el.querySelector('#einrichtung-form');
  const fehler = (name, t) => {
    const f = form.querySelector(`[data-fehler="${name}"]`);
    if (f) f.textContent = t || '';
    form.elements[name]?.setAttribute?.('aria-invalid', t ? 'true' : 'false');
  };
  form.addEventListener('input', (ev) => ev.target.name && fehler(ev.target.name, ''));
  el.querySelector('#e-abmelden').addEventListener('click', abmelden);
  (passwortNoetig ? form.neu : form.vorname).focus();

  if (istAutor) {
    form.iban.addEventListener('blur', () => {
      if (!form.iban.value.trim()) return;
      const f = ibanFehler(form.iban.value);
      fehler('iban', f);
      if (!f) form.iban.value = formatIban(form.iban.value);
    });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    form.querySelectorAll('[data-fehler]').forEach((f) => { f.textContent = ''; });
    const f = {};
    if (passwortNoetig) {
      if (form.neu.value.length < 8) f.neu = 'Mindestens 8 Zeichen.';
      else if (form.neu.value !== form.wdh.value) f.wdh = 'Die beiden Passwörter stimmen nicht überein.';
    }
    for (const n of ['vorname', 'nachname', 'strasse', 'plz_ort', 'kontoinhaber']) {
      if (form.elements[n] && !form.elements[n].value.trim()) f[n] = 'Bitte ausfüllen.';
    }
    if (istAutor) {
      const ibanF = ibanFehler(form.iban.value);
      if (ibanF) f.iban = ibanF;
      if (!bicIstGueltig(form.bic.value)) f.bic = 'Der BIC hat 8 oder 11 Zeichen, z. B. BKAUATWW.';
      for (const m of MEDIUM_KEYS) {
        if (profilIdAusLink(form.elements[PROFIL_FELD[m]].value, m) === null) {
          f[PROFIL_FELD[m]] = `Bitte den Link von deiner Profilseite auf ${MEDIEN[m].seite} kopieren.`;
        }
      }
      if (!MEDIUM_KEYS.some((m) => form.elements[PROFIL_FELD[m]].value.trim())) {
        f.links = 'Bitte mindestens einen Profil-Link angeben.';
      }
    }
    if (hinweisNoetig && !form.hinweis.checked) f.hinweis = 'Bitte bestätigen, dass du den Hinweis gelesen hast.';
    if (Object.keys(f).length) {
      Object.entries(f).forEach(([n, t]) => fehler(n, t));
      (form.elements[Object.keys(f)[0]] ?? form.elements[PROFIL_FELD.college])?.focus();
      return;
    }

    await mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        if (passwortNoetig) {
          await store.erstesPasswortSetzen(form.neu.value);
          // Passwort steht – falls danach etwas schiefgeht, nicht noch einmal verlangen
          passwortNoetig = false;
          el.querySelector('#e-passwort').hidden = true;
        }
        if (hinweisNoetig) await store.hinweisBestaetigen();
        await store.profilSpeichern({
          vorname: form.vorname.value, nachname: form.nachname.value, email: nutzer.email,
          strasse: form.strasse?.value ?? p.strasse, plz_ort: form.plz_ort?.value ?? p.plz_ort,
          kontoinhaber: form.kontoinhaber?.value ?? p.kontoinhaber, iban: form.iban?.value ?? p.iban,
          bic: form.bic?.value ?? p.bic,
          ...Object.fromEntries(MEDIUM_KEYS.map((m) => [PROFIL_FELD[m], form.elements[PROFIL_FELD[m]]?.value ?? p[PROFIL_FELD[m]]])),
        });
        weiter();
      } catch (e) {
        fehler('formular', fehlerText(e));
      }
    });
  });
}
