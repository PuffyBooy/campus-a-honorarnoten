// Anmelden / Zugang anfragen, dazu Schnellzugang zu den Demo-Konten.
// Selbst registrieren geht nur mit einem Registrierungslink vom Admin (views/registrieren.js), sonst schaltet ein Admin Anfragen frei.
import { DEMO_KONTEN, DEMO_PASSWORT } from '../demo-konten.js';
import { esc } from '../lib/format.js';
import { fehlerText, mitSperre } from '../lib/ui.js';
import { ZUSTIMMUNG_TEXT, hinweisHtml } from '../lib/rechtliches.js';

export function render(el, { store, istDemo, recht, nachAnmeldung }) {
  el.innerHTML = `
    <div class="login-raster">
      <section class="login-intro">
        <div class="login-logos">
          <img src="img/logo-campus-a.svg" width="112" height="40" alt="campus a – Das Studierendenmagazin">
          <img src="img/logo-campus-a-college.png" width="175" height="40" alt="campus a college – Die Schülerzeitung für alle Schüler*innen">
        </div>
        <p>Hier erfasst ihr eure Beiträge für campus a und campus a college und reicht sie einmal im Monat als Prämienabrechnung ein.</p>
      </section>
      <section class="karte">
        <h1>Anmelden</h1>
        <div class="reiter" role="tablist">
          <button type="button" role="tab" id="t-anmelden" aria-selected="true" aria-controls="p-anmelden">Anmelden</button>
          <button type="button" role="tab" id="t-registrieren" aria-selected="false" aria-controls="p-registrieren">Zugang anfragen</button>
        </div>

        <form id="p-anmelden" role="tabpanel" aria-labelledby="t-anmelden" novalidate>
          <label for="a-email">E-Mail-Adresse</label>
          <input id="a-email" name="email" type="email" autocomplete="username" inputmode="email" required>
          <label for="a-pw">Passwort</label>
          <input id="a-pw" name="passwort" type="password" autocomplete="current-password" required>
          <p class="feldfehler" role="alert"></p>
          <button class="btn btn-primaer btn-breit" type="submit">Anmelden</button>
          <p class="login-vergessen"><button type="button" class="link-knopf" id="a-vergessen">Passwort vergessen?</button></p>
        </form>

        <form id="p-code" hidden novalidate>
          <h2>Bestätigungscode</h2>
          <p>Für dein Konto ist die Zwei-Faktor-Anmeldung eingeschaltet. Öffne deine Authenticator-App und gib den Code ein.</p>
          <label for="a-code">Code aus der App</label>
          <input id="a-code" class="code-eingabe" name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="11"
                 spellcheck="false" placeholder="123 456">
          <p class="tipp">Handy nicht zur Hand? Dann einen deiner Ersatz-Codes eingeben.</p>
          <p class="feldfehler" role="alert"></p>
          <button class="btn btn-primaer btn-breit" type="submit">Bestätigen</button>
          <p class="login-vergessen"><button type="button" class="link-knopf" data-zurueck>Zurück zur Anmeldung</button></p>
        </form>

        <form id="p-vergessen" hidden novalidate>
          <h2>Passwort vergessen</h2>
          <p>Gib deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du ein neues Passwort festlegst. Er gilt eine Stunde.</p>
          <label for="v-email">E-Mail-Adresse</label>
          <input id="v-email" name="email" type="email" autocomplete="username" inputmode="email" required>
          <p class="feldfehler" role="alert"></p>
          <button class="btn btn-primaer btn-breit" type="submit">Link schicken</button>
          <p class="login-vergessen"><button type="button" class="link-knopf" data-zurueck>Zurück zur Anmeldung</button></p>
        </form>

        <form id="p-registrieren" role="tabpanel" aria-labelledby="t-registrieren" hidden novalidate>
          <div class="zeile">
            <div class="feld"><label for="r-vorname">Vorname</label>
              <input id="r-vorname" name="vorname" autocomplete="given-name" required></div>
            <div class="feld"><label for="r-nachname">Nachname</label>
              <input id="r-nachname" name="nachname" autocomplete="family-name" required></div>
          </div>
          <label for="r-email">E-Mail-Adresse</label>
          <input id="r-email" name="email" type="email" autocomplete="email" inputmode="email" required>
          <label for="r-nachricht">Nachricht an die Redaktion <span class="optional">(optional)</span></label>
          <textarea id="r-nachricht" name="nachricht" rows="2" maxlength="1000"
                    placeholder="z. B. Schule, Klasse oder wofür du schreibst"></textarea>
          <label class="check bestaetigen"><input type="checkbox" name="zustimmung" required>
            <span>${ZUSTIMMUNG_TEXT} <span class="pflicht" aria-hidden="true">*</span></span></label>
          <p class="feldfehler" role="alert"></p>
          <button class="btn btn-primaer btn-breit" type="submit">Zugang anfragen</button>
          <p class="tipp">Die Redaktion schickt dir nach der Freischaltung ein Startpasswort.</p>
        </form>
        ${recht && hinweisHtml(recht) ? `<aside class="hinweis-betreiber">${hinweisHtml(recht)}</aside>` : ''}
      </section>

      ${istDemo ? `<section class="karte demo">
        <h2>Demo-Zugänge</h2>
        <p class="tipp">Passwort: <code>${esc(DEMO_PASSWORT)}</code> · Tipp: In zwei Tabs lassen sich zwei Rollen gleichzeitig testen.</p>
        <ul class="demo-liste">
          ${DEMO_KONTEN.map((k) => `
            <li><button type="button" class="btn btn-breit demo-knopf${k.frisch ? ' demo-frisch' : ''}" data-email="${esc(k.email)}"
                        ${k.frisch ? 'data-frisch' : ''}>
              <span><strong>${esc(k.rolle)}</strong><br><span class="klein">${esc(k.text)} · ${esc(k.email)}</span></span>
              <span aria-hidden="true">→</span></button></li>`).join('')}
        </ul>
      </section>` : ''}
    </div>`;

  const reiter = { anmelden: el.querySelector('#t-anmelden'), registrieren: el.querySelector('#t-registrieren') };
  const panels = { anmelden: el.querySelector('#p-anmelden'), registrieren: el.querySelector('#p-registrieren') };
  for (const [name, knopf] of Object.entries(reiter)) {
    knopf.addEventListener('click', () => {
      for (const k of Object.keys(reiter)) {
        reiter[k].setAttribute('aria-selected', String(k === name));
        panels[k].hidden = k !== name;
      }
      panels[name].querySelector('input').focus();
    });
  }

  // Zweiter Schritt nur für Konten mit Zwei-Faktor: eigene Ansicht für den Code
  const codeForm = el.querySelector('#p-code');
  const codeZeigen = (an) => {
    codeForm.hidden = !an;
    el.querySelector('.reiter').hidden = an;
    panels.anmelden.hidden = an;
    codeForm.code.value = '';
    codeForm.querySelector('.feldfehler').textContent = '';
    (an ? codeForm.code : panels.anmelden.passwort).focus();
  };
  panels.anmelden.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const fehler = f.querySelector('.feldfehler');
    fehler.textContent = '';
    await mitSperre(f.querySelector('button[type=submit]'), async () => {
      try {
        const r = await store.anmelden(f.email.value, f.passwort.value);
        if (r?.code_noetig) codeZeigen(true); // Passwort stimmt, jetzt noch der Code
        else nachAnmeldung();
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });
  const codeAbschicken = () => {
    const fehler = codeForm.querySelector('.feldfehler');
    fehler.textContent = '';
    mitSperre(codeForm.querySelector('button[type=submit]'), async () => {
      try {
        await store.anmelden(panels.anmelden.email.value, panels.anmelden.passwort.value, codeForm.code.value);
        nachAnmeldung();
      } catch (e) {
        fehler.textContent = fehlerText(e);
        codeForm.code.select();
      }
    });
  };
  codeForm.addEventListener('submit', (ev) => { ev.preventDefault(); codeAbschicken(); });
  // 6 Ziffern eingetippt: gleich bestätigen
  codeForm.code.addEventListener('input', () => { if (/^\d{3} ?\d{3}$/.test(codeForm.code.value.trim())) codeAbschicken(); });
  codeForm.addEventListener('click', (ev) => { if (ev.target.closest('[data-zurueck]')) codeZeigen(false); });

  // Passwort vergessen: eigene Ansicht statt der Reiter
  const vergessen = el.querySelector('#p-vergessen');
  const reiterLeiste = el.querySelector('.reiter');
  const vergessenZeigen = (an) => {
    vergessen.hidden = !an;
    reiterLeiste.hidden = an;
    panels.anmelden.hidden = an;
    panels.registrieren.hidden = true;
    reiter.anmelden.setAttribute('aria-selected', 'true');
    reiter.registrieren.setAttribute('aria-selected', 'false');
    (an ? vergessen.email : panels.anmelden.email).focus();
  };
  el.querySelector('#a-vergessen').addEventListener('click', () => {
    vergessen.email.value = panels.anmelden.email.value;
    vergessenZeigen(true);
  });
  vergessen.addEventListener('click', (ev) => { if (ev.target.closest('[data-zurueck]')) vergessenZeigen(false); });
  vergessen.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fehler = vergessen.querySelector('.feldfehler');
    fehler.textContent = '';
    mitSperre(vergessen.querySelector('button[type=submit]'), async () => {
      try {
        const r = await store.passwortVergessen(vergessen.email.value);
        vergessen.querySelector('h2').insertAdjacentHTML('afterend', `<p class="erfolgbox" role="status">
          Falls es ein Konto mit <strong>${esc(vergessen.email.value.trim())}</strong> gibt, ist die E-Mail mit dem Link unterwegs.
          Schau auch im Spam-Ordner nach.</p>
          ${istDemo ? `<p class="hinweisbox">Demo: Es werden keine E-Mails verschickt. ${r?.demo_link
            ? `<a href="${esc(r.demo_link)}">Link aus der E-Mail öffnen</a>` : 'Zu dieser Adresse gibt es kein aktives Konto.'}</p>` : ''}`);
        vergessen.querySelectorAll('p:not(.erfolgbox):not(.hinweisbox):not(.login-vergessen), label, input, button[type=submit]').forEach((x) => x.remove());
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });

  panels.registrieren.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const fehler = f.querySelector('.feldfehler');
    fehler.textContent = '';
    if (!f.zustimmung.checked) {
      fehler.textContent = 'Bitte bestätige, dass du die Datenschutzerklärung und den Hinweis gelesen hast.';
      f.zustimmung.focus();
      return;
    }
    const knopf = f.querySelector('button[type=submit]');
    knopf.disabled = true;
    try {
      await store.zugangAnfragen({
        vorname: f.vorname.value, nachname: f.nachname.value, email: f.email.value, nachricht: f.nachricht.value, zustimmung: true,
      });
    } catch (e) {
      fehler.textContent = fehlerText(e);
      knopf.disabled = false;
      return;
    }
    f.innerHTML = `<p class="erfolgbox" role="status"><strong>Anfrage gesendet.</strong> Du bekommst ein Startpasswort, sobald du freigeschaltet bist.</p>`;
  });

  el.querySelectorAll('.demo-knopf').forEach((knopf) => knopf.addEventListener('click', () =>
    mitSperre(knopf, async () => {
      try {
        // „Erstes Anmelden“: Konto jedes Mal neu anlegen, damit die Einrichtung immer zu sehen ist
        if ('frisch' in knopf.dataset) await store.demoKontoFrisch(knopf.dataset.email);
        await store.anmelden(knopf.dataset.email, DEMO_PASSWORT);
        nachAnmeldung();
      } catch (e) {
        panels.anmelden.querySelector('.feldfehler').textContent = fehlerText(e);
      }
    })));
}
