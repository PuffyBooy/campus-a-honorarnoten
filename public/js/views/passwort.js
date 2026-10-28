// Neues Passwort festlegen mit dem Link aus „Passwort vergessen“ (gilt eine Stunde, einmal)
import { fehlerText, mitSperre } from '../lib/ui.js';

export function render(el, { store, token, fertig }) {
  el.innerHTML = `
    <section class="karte schmal">
      <h1>Neues Passwort festlegen</h1>
      <form id="neu-form" novalidate>
        <div class="feld"><label for="n-pw">Neues Passwort (mind. 8 Zeichen)</label>
          <input id="n-pw" name="passwort" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="feld"><label for="n-pw2">Passwort wiederholen</label>
          <input id="n-pw2" name="passwort2" type="password" autocomplete="new-password" required></div>
        <p class="feldfehler" role="alert"></p>
        <button class="btn btn-primaer btn-breit" type="submit">Passwort speichern</button>
      </form>
    </section>`;
  const form = el.querySelector('#neu-form');
  form.passwort.focus();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    fehler.textContent = '';
    if (form.passwort.value.length < 8) fehler.textContent = 'Das Passwort muss mindestens 8 Zeichen haben.';
    else if (form.passwort.value !== form.passwort2.value) fehler.textContent = 'Die beiden Passwörter sind nicht gleich.';
    if (fehler.textContent) return;
    mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        const r = await store.passwortNeuSetzen(token, form.passwort.value);
        if (r.angemeldet) { fertig(); return; }
        // mit Zwei-Faktor: neu anmelden (Passwort + Code)
        form.outerHTML = `<p class="erfolgbox" role="status">Dein neues Passwort ist gespeichert.
          Melde dich jetzt mit dem neuen Passwort und dem Code aus deiner App an.</p>
          <p><button type="button" class="btn btn-primaer" id="n-weiter">Zur Anmeldung</button></p>`;
        el.querySelector('#n-weiter').addEventListener('click', fertig);
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });
}
