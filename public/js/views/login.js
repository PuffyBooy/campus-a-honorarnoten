// Anmeldung per Magic Link (alternativ 6-stelliger Code aus derselben E-Mail)
import { esc } from '../lib/format.js';
import { fehlerText, mitSperre } from '../lib/ui.js';

function fehlerAusUrl() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const q = new URLSearchParams(location.search);
  const code = h.get('error_code') || q.get('error_code');
  if (code === 'otp_expired') return 'Der Anmeldelink ist abgelaufen oder wurde schon verwendet. Bitte fordere einen neuen an.';
  return h.get('error_description') || q.get('error_description');
}

export function render(el, { supabase }) {
  const urlFehler = fehlerAusUrl();
  el.innerHTML = `
    <section class="karte schmal">
      <h1>Anmelden</h1>
      <p>Gib deine E-Mail-Adresse ein. Du bekommst einen Anmeldelink per E-Mail – kein Passwort nötig.</p>
      ${urlFehler ? `<p class="fehlerbox" role="alert">${esc(urlFehler)}</p>` : ''}
      <form id="login-form" novalidate>
        <label for="login-email">E-Mail-Adresse</label>
        <input id="login-email" name="email" type="email" autocomplete="email" inputmode="email" required>
        <p class="feldfehler" id="login-fehler" role="alert"></p>
        <button class="btn btn-primaer btn-breit" type="submit">Anmeldelink senden</button>
      </form>
      <div id="login-gesendet" hidden>
        <p class="erfolgbox">Link wurde gesendet an <strong id="login-adresse"></strong>.
          Bitte öffne die E-Mail und tippe auf den Link. Schau auch im Spam-Ordner nach.</p>
        <form id="code-form" novalidate>
          <label for="login-code">Oder Code aus der E-Mail eingeben</label>
          <input id="login-code" name="code" inputmode="numeric" autocomplete="one-time-code"
                 pattern="[0-9]{6,10}" maxlength="10">
          <p class="feldfehler" id="code-fehler" role="alert"></p>
          <button class="btn btn-breit" type="submit">Mit Code anmelden</button>
        </form>
        <p><button type="button" class="btn-link" id="login-zurueck">Andere E-Mail-Adresse verwenden</button></p>
      </div>
    </section>`;

  const form = el.querySelector('#login-form');
  const gesendet = el.querySelector('#login-gesendet');
  let email = '';

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = el.querySelector('#login-fehler');
    email = form.email.value.trim().toLowerCase();
    fehler.textContent = '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      fehler.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.';
      return;
    }
    await mitSperre(form.querySelector('button'), async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) {
        fehler.textContent = /rate limit|security purposes/i.test(error.message)
          ? 'Bitte warte kurz, bevor du einen neuen Link anforderst.'
          : fehlerText(error);
        return;
      }
      el.querySelector('#login-adresse').textContent = email;
      form.hidden = true;
      gesendet.hidden = false;
    });
  });

  el.querySelector('#code-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const codeForm = ev.currentTarget;
    const fehler = el.querySelector('#code-fehler');
    const token = codeForm.code.value.replace(/\s/g, '');
    fehler.textContent = '';
    if (!/^\d{6,10}$/.test(token)) {
      fehler.textContent = 'Bitte den Code aus der E-Mail eingeben.';
      return;
    }
    await mitSperre(codeForm.querySelector('button'), async () => {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (error) fehler.textContent = 'Der Code ist ungültig oder abgelaufen.';
      // Bei Erfolg rendert app.js über onAuthStateChange neu
    });
  });

  el.querySelector('#login-zurueck').addEventListener('click', () => {
    gesendet.hidden = true;
    form.hidden = false;
  });
}
