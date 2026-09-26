// Anmelden / Zugang anfragen, dazu Schnellzugang zu den Demo-Konten.
// Selbst registrieren geht nicht – ein Admin schaltet Anfragen frei.
import { DEMO_KONTEN, DEMO_PASSWORT } from '../demo.js';
import { esc } from '../lib/format.js';
import { fehlerText, mitSperre } from '../lib/ui.js';

export function render(el, { store, nachAnmeldung }) {
  el.innerHTML = `
    <div class="login-raster">
      <section class="karte">
        <h1>Honorarnoten</h1>
        <p class="einleitung">Leistungen laufend erfassen, einmal im Monat als Honorarnote abschicken.</p>
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
          <p class="feldfehler" role="alert"></p>
          <button class="btn btn-primaer btn-breit" type="submit">Zugang anfragen</button>
          <p class="hinweis">Die Redaktion prüft deine Anfrage und schickt dir ein Startpasswort.
            Beim ersten Anmelden legst du dein eigenes Passwort fest.</p>
        </form>
      </section>

      <section class="karte demo">
        <h2>Demo-Zugänge</h2>
        <p class="hinweis">Zum Ausprobieren jeder Rolle. Passwort jeweils <code>${esc(DEMO_PASSWORT)}</code>.
          Tipp: In zwei Browser-Tabs kann man gleichzeitig verschiedene Rollen nutzen.</p>
        <ul class="demo-liste">
          ${DEMO_KONTEN.map((k) => `
            <li><button type="button" class="btn btn-breit demo-knopf" data-email="${esc(k.email)}">
              <span><strong>${esc(k.rolle)}</strong><br><span class="klein">${esc(k.text)} · ${esc(k.email)}</span></span>
              <span aria-hidden="true">→</span></button></li>`).join('')}
        </ul>
      </section>
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

  async function absenden(form, fn) {
    const fehler = form.querySelector('.feldfehler');
    fehler.textContent = '';
    await mitSperre(form.querySelector('button[type=submit]'), async () => {
      try {
        nachAnmeldung(await fn());
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  }

  panels.anmelden.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    absenden(f, async () => { await store.anmelden(f.email.value, f.passwort.value); });
  });

  panels.registrieren.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const fehler = f.querySelector('.feldfehler');
    fehler.textContent = '';
    try {
      store.zugangAnfragen({
        vorname: f.vorname.value, nachname: f.nachname.value, email: f.email.value, nachricht: f.nachricht.value,
      });
    } catch (e) {
      fehler.textContent = fehlerText(e);
      return;
    }
    f.innerHTML = `<p class="erfolgbox" role="status"><strong>Danke, deine Anfrage ist angekommen!</strong><br>
      Sobald die Redaktion dich freischaltet, bekommst du dein Startpasswort. Damit meldest du dich
      unter „Anmelden“ an und legst dein eigenes Passwort fest.</p>`;
  });

  el.querySelectorAll('.demo-knopf').forEach((knopf) => knopf.addEventListener('click', () =>
    mitSperre(knopf, async () => {
      try {
        await store.anmelden(knopf.dataset.email, DEMO_PASSWORT);
        nachAnmeldung();
      } catch (e) {
        panels.anmelden.querySelector('.feldfehler').textContent = fehlerText(e);
      }
    })));
}

/** Nach dem Login mit Startpasswort: eigenes Passwort festlegen (Pflicht) */
export function renderPasswortFestlegen(el, { store, nutzer, weiter, abmelden }) {
  el.innerHTML = `
    <section class="karte schmal">
      <h1>Willkommen, ${esc(nutzer.vorname)}!</h1>
      <p>Du hast dich mit einem Startpasswort angemeldet. Bitte lege jetzt dein eigenes Passwort fest.</p>
      <form id="pw-festlegen" novalidate>
        <input type="text" name="username" value="${esc(nutzer.email)}" autocomplete="username" hidden>
        <label for="pf-neu">Neues Passwort (mind. 8 Zeichen)</label>
        <input id="pf-neu" name="neu" type="password" autocomplete="new-password" minlength="8" required>
        <label for="pf-wdh">Passwort wiederholen</label>
        <input id="pf-wdh" name="wdh" type="password" autocomplete="new-password" minlength="8" required>
        <p class="feldfehler" role="alert"></p>
        <button class="btn btn-primaer btn-breit" type="submit">Passwort speichern</button>
      </form>
      <p><button type="button" class="btn-link" id="pf-abmelden">Abmelden</button></p>
    </section>`;
  const form = el.querySelector('#pw-festlegen');
  form.neu.focus();
  el.querySelector('#pf-abmelden').addEventListener('click', abmelden);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    fehler.textContent = '';
    if (form.neu.value !== form.wdh.value) {
      fehler.textContent = 'Die beiden Passwörter stimmen nicht überein.';
      return;
    }
    await mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        await store.erstesPasswortSetzen(form.neu.value);
        weiter();
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });
}
