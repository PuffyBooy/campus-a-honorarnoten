// Registrieren mit einem Link vom Admin: Konto selbst anlegen, ohne Freischalten.
// Der Link gilt nur eine bestimmte Zeit und meist nur einmal.
import { ROLLEN_LABEL, esc, formatZeitpunkt } from '../lib/format.js';
import { fehlerText, mitSperre } from '../lib/ui.js';
import { ZUSTIMMUNG_TEXT, hinweisHtml } from '../lib/rechtliches.js';

export async function render(el, { store, token, recht, fertig }) {
  let info;
  try {
    info = await store.einladungPruefen(token);
  } catch (e) {
    el.innerHTML = `<section class="karte schmal"><h1>Registrieren</h1>
      <p class="fehlerbox">${esc(fehlerText(e))}</p>
      <p><a href="#/" class="btn">Zur Anmeldung</a></p></section>`;
    return;
  }
  el.innerHTML = `
    <section class="karte schmal">
      <h1>Konto anlegen</h1>
      <p>Du wurdest zu den Anerkennungsprämien von campus a und campus a college eingeladen.
        Dein Konto bekommt die Rolle <strong>${esc(info.rollen.map((r) => ROLLEN_LABEL[r] ?? r).join(', '))}</strong>.</p>
      <p class="klein">Der Link gilt bis ${esc(formatZeitpunkt(info.gueltig_bis))}.</p>
      <form id="reg-form" novalidate>
        <div class="zeile">
          <div class="feld"><label for="g-vorname">Vorname</label><input id="g-vorname" name="vorname" autocomplete="given-name" required></div>
          <div class="feld"><label for="g-nachname">Nachname</label><input id="g-nachname" name="nachname" autocomplete="family-name" required></div>
        </div>
        <label for="g-email">E-Mail-Adresse</label>
        <input id="g-email" name="email" type="email" autocomplete="email" inputmode="email" required>
        <div class="zeile">
          <div class="feld"><label for="g-pw">Passwort (mind. 8 Zeichen)</label>
            <input id="g-pw" name="passwort" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="feld"><label for="g-pw2">Passwort wiederholen</label>
            <input id="g-pw2" name="passwort2" type="password" autocomplete="new-password" required></div>
        </div>
        ${recht && hinweisHtml(recht) ? `<aside class="hinweis-betreiber">${hinweisHtml(recht)}</aside>` : ''}
        <label class="check bestaetigen"><input type="checkbox" name="zustimmung" required>
          <span>${ZUSTIMMUNG_TEXT} <span class="pflicht" aria-hidden="true">*</span></span></label>
        <p class="feldfehler" role="alert"></p>
        <button class="btn btn-primaer btn-breit" type="submit">Konto anlegen</button>
      </form>
    </section>`;

  const form = el.querySelector('#reg-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    fehler.textContent = '';
    if (form.passwort.value.length < 8) fehler.textContent = 'Das Passwort muss mindestens 8 Zeichen haben.';
    else if (form.passwort.value !== form.passwort2.value) fehler.textContent = 'Die beiden Passwörter sind nicht gleich.';
    else if (!form.zustimmung.checked) fehler.textContent = 'Bitte bestätige, dass du die Datenschutzerklärung und den Hinweis gelesen hast.';
    if (fehler.textContent) return;
    await mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        await store.mitLinkRegistrieren(token, {
          vorname: form.vorname.value, nachname: form.nachname.value, email: form.email.value,
          passwort: form.passwort.value, zustimmung: true,
        });
        fertig();
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });
}
