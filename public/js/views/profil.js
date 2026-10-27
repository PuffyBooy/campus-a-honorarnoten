// Profil: Name, Adresse und Bankverbindung einmal speichern – wird für jede Prämienabrechnung übernommen
import { ROLLEN_LABEL, esc } from '../lib/format.js';
import { formatIban, ibanFehler, bicIstGueltig } from '../lib/iban.js';
import { MEDIEN, MEDIUM_KEYS, PROFIL_FELD, profilIdAusLink, profilLink } from '../lib/campus.js';
import { fehlerText, meldung, mitSperre } from '../lib/ui.js';
import { bekommt, verfuegbareBenachrichtigungen } from '../lib/benachrichtigungen.js';

function feld(name, label, wert, { typ = 'text', pflicht = true, attrs = '' } = {}) {
  return `
    <div class="feld">
      <label for="p-${name}">${esc(label)}${pflicht ? ' <span class="pflicht" aria-hidden="true">*</span>' : ' <span class="optional">(optional)</span>'}</label>
      <input id="p-${name}" name="${name}" type="${typ}" value="${esc(wert)}" ${pflicht ? 'required' : ''} ${attrs}>
      <p class="feldfehler" id="pe-${name}"></p>
    </div>`;
}

export async function render(el, { store, nutzer, navigate, neuLaden, istDemo }) {
  const p = nutzer.profil;
  const istAutor = nutzer.rollen.includes('autor');
  const vollstaendig = store.profilVollstaendig(nutzer);
  const kontakt = (await store.einstellungen()).datenschutzKontakt;

  el.innerHTML = `
    <h1>Mein Profil</h1>
    ${istAutor && !vollstaendig ? `<p class="hinweisbox" role="status">Bitte Adresse, Bankverbindung und mindestens einen Profil-Link ergänzen.</p>` : ''}
    <div class="spalten">
      <form class="karte" id="profil-form" novalidate>
        <fieldset>
          <legend>Persönliche Daten</legend>
          <div class="zeile">
            ${feld('vorname', 'Vorname', nutzer.vorname, { attrs: 'autocomplete="given-name" maxlength="100"' })}
            ${feld('nachname', 'Nachname', nutzer.nachname, { attrs: 'autocomplete="family-name" maxlength="100"' })}
          </div>
          ${feld('email', 'E-Mail', nutzer.email, { typ: 'email', attrs: 'autocomplete="email" inputmode="email"' })}
          ${istAutor ? `
          ${feld('strasse', 'Straße und Hausnummer', p.strasse, { attrs: 'autocomplete="address-line1" maxlength="150"' })}
          ${feld('plz_ort', 'PLZ und Ort', p.plz_ort, { attrs: 'autocomplete="postal-code" maxlength="100" placeholder="1010 Wien"' })}` : ''}
        </fieldset>
        ${istAutor ? `
        <fieldset>
          <legend>Bankverbindung</legend>
          ${feld('kontoinhaber', 'Kontoinhaber:in', p.kontoinhaber, { attrs: 'autocomplete="name" maxlength="70"' })}
          ${feld('iban', 'IBAN', formatIban(p.iban), { attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="42" placeholder="AT.. .... .... .... ...."' })}
          ${feld('bic', 'BIC', p.bic, { pflicht: false, attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="11"' })}
        </fieldset>
        <fieldset>
          <legend>Profil auf der Webseite</legend>
          <p class="hinweis">Mindestens einen Link angeben. „Meine Leistungen“ zeigt dann alle deine Artikel zum Übernehmen an.</p>
          ${MEDIUM_KEYS.map((m) => feld(PROFIL_FELD[m], `${MEDIEN[m].seite} (${MEDIEN[m].name})`, profilLink(p[PROFIL_FELD[m]], m), {
            typ: 'url',
            pflicht: false,
            attrs: `autocomplete="off" spellcheck="false" maxlength="200" placeholder="${esc(MEDIEN[m].basis)}/profil/…"`,
          })).join('')}
        </fieldset>
        <aside class="datenschutz" aria-label="Datenschutzhinweis">
          <strong>Datenschutz:</strong> Adresse und Bankverbindung sieht nur die Buchhaltung, sie dienen nur der Auszahlung. Mehr in der <a href="#/datenschutz">Datenschutzerklärung</a>.
          ${kontakt ? `Fragen, Auskunft oder Löschung: <a href="mailto:${esc(kontakt)}">${esc(kontakt)}</a>.` : ''}
        </aside>` : ''}
        <p class="feldfehler" id="pe-formular" role="alert"></p>
        <button class="btn btn-primaer" type="submit">Profil speichern</button>
      </form>

      <div>
        <section class="karte">
          <h2>Meine Rollen</h2>
          <p>${nutzer.rollen.map((r) => `<span class="badge badge-rolle">${esc(ROLLEN_LABEL[r])}</span>`).join(' ') || '–'}</p>
        </section>
        ${verfuegbareBenachrichtigungen(nutzer).length ? `
        <form class="karte" id="mail-form">
          <h2>E-Mail-Benachrichtigungen</h2>
          <p class="tipp">An ${esc(nutzer.email)}. Wähle aus, worüber du per E-Mail informiert werden willst.</p>
          ${istDemo ? '<p class="hinweisbox">In der Demo werden keine E-Mails verschickt – die Auswahl wird nur gespeichert.</p>' : ''}
          ${verfuegbareBenachrichtigungen(nutzer).map((b) => `
            <label class="check bestaetigen"><input type="checkbox" name="${esc(b.typ)}" ${bekommt(nutzer, b.typ) ? 'checked' : ''}> ${esc(b.text)}</label>`).join('')}
          <p><button class="btn abstand-oben" type="submit">Auswahl speichern</button></p>
        </form>` : ''}
        <form class="karte" id="pw-form" novalidate>
          <h2>Passwort ändern</h2>
          <input type="text" name="username" value="${esc(nutzer.email)}" autocomplete="username" hidden>
          <label for="pw-alt">Bisheriges Passwort</label>
          <input id="pw-alt" name="alt" type="password" autocomplete="current-password" required>
          <label for="pw-neu">Neues Passwort (mind. 8 Zeichen)</label>
          <input id="pw-neu" name="neu" type="password" autocomplete="new-password" minlength="8" required>
          <p class="feldfehler" role="alert"></p>
          <button class="btn" type="submit">Passwort ändern</button>
        </form>
      </div>
    </div>`;

  const form = el.querySelector('#profil-form');
  const setFehler = (name, t) => {
    const e = el.querySelector(`#pe-${name}`);
    if (e) e.textContent = t || '';
    form.elements[name]?.setAttribute?.('aria-invalid', t ? 'true' : 'false');
  };
  form.addEventListener('input', (ev) => ev.target.name && setFehler(ev.target.name, ''));

  if (istAutor) {
    form.iban.addEventListener('blur', () => {
      if (!form.iban.value.trim()) return;
      const f = ibanFehler(form.iban.value);
      setFehler('iban', f);
      if (!f) form.iban.value = formatIban(form.iban.value);
    });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setFehler('formular', '');
    const f = {};
    for (const n of ['vorname', 'nachname', 'strasse', 'plz_ort', 'kontoinhaber']) {
      if (form.elements[n] && !form.elements[n].value.trim()) f[n] = 'Bitte ausfüllen.';
    }
    if (istAutor) {
      const ibanF = ibanFehler(form.iban.value);
      if (ibanF) f.iban = ibanF;
      if (!bicIstGueltig(form.bic.value)) f.bic = 'Der BIC hat 8 oder 11 Zeichen, z. B. BKAUATWW.';
      for (const m of MEDIUM_KEYS) {
        if (profilIdAusLink(form.elements[PROFIL_FELD[m]].value, m) === null) {
          f[PROFIL_FELD[m]] = `Bitte den Link von deiner Profilseite auf ${MEDIEN[m].seite} kopieren, z. B. ${MEDIEN[m].basis}/profil/ae10…`;
        }
      }
      if (!MEDIUM_KEYS.some((m) => form.elements[PROFIL_FELD[m]].value.trim())) {
        f[PROFIL_FELD.college] = 'Bitte mindestens einen Profil-Link angeben (campus-a-college.at oder campus-a.at).';
      }
    }
    if (Object.keys(f).length) {
      Object.entries(f).forEach(([n, t]) => setFehler(n, t));
      form.elements[Object.keys(f)[0]].focus();
      return;
    }
    await mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        await store.profilSpeichern({
          vorname: form.vorname.value, nachname: form.nachname.value, email: form.email.value,
          strasse: form.strasse?.value ?? p.strasse, plz_ort: form.plz_ort?.value ?? p.plz_ort,
          kontoinhaber: form.kontoinhaber?.value ?? p.kontoinhaber, iban: form.iban?.value ?? p.iban,
          bic: form.bic?.value ?? p.bic,
          ...Object.fromEntries(MEDIUM_KEYS.map((m) => [PROFIL_FELD[m], form.elements[PROFIL_FELD[m]]?.value])),
        });
        meldung('Profil gespeichert.', 'erfolg');
        if (istAutor && !vollstaendig) navigate('leistungen');
        else neuLaden();
      } catch (e) {
        setFehler('formular', fehlerText(e));
      }
    });
  });

  const pwForm = el.querySelector('#pw-form');
  const mailForm = el.querySelector('#mail-form');
  mailForm?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const wahl = Object.fromEntries(verfuegbareBenachrichtigungen(nutzer).map((b) => [b.typ, mailForm.elements[b.typ].checked]));
    mitSperre(mailForm.querySelector('button'), async () => {
      try {
        await store.benachrichtigungenSpeichern(wahl);
        meldung('Auswahl gespeichert.', 'erfolg');
        neuLaden();
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });

  pwForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = pwForm.querySelector('.feldfehler');
    fehler.textContent = '';
    await mitSperre(pwForm.querySelector('[type=submit]'), async () => {
      try {
        await store.passwortAendern(pwForm.alt.value, pwForm.neu.value);
        pwForm.reset();
        meldung('Passwort geändert.', 'erfolg');
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });
}
