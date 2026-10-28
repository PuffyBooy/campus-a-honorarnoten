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
