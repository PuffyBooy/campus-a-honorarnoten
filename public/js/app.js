// Einstieg: Anmeldung, Rollen laden, Navigation und Hash-Routing
import { supabase, konfigFehlt } from './supabase.js';
import { esc } from './lib/format.js';
import { fehlerText, ladeAnzeige } from './lib/ui.js';
import * as login from './views/login.js';
import * as einreichen from './views/einreichen.js';
import * as meine from './views/meine.js';
import * as redaktion from './views/redaktion.js';
import * as redaktionDetail from './views/redaktion-detail.js';
import * as zahlung from './views/zahlung.js';

const main = document.getElementById('app');
const nav = document.getElementById('nav');

const state = { session: null, rollen: [], flash: null };

const ROUTEN = [
  { pfad: 'einreichen', view: einreichen, rolle: ['autor'], titel: 'Einreichen' },
  { pfad: 'meine', view: meine, rolle: ['autor'], titel: 'Meine Noten' },
  { pfad: 'redaktion', view: redaktion, rolle: ['redaktion', 'admin'], titel: 'Redaktion' },
  { pfad: 'redaktion/:id', view: redaktionDetail, rolle: ['redaktion', 'admin'] },
  { pfad: 'zahlung', view: zahlung, rolle: ['buchhaltung', 'admin'], titel: 'Zahlung' },
  { pfad: 'zahlung/:tab', view: zahlung, rolle: ['buchhaltung', 'admin'] },
];

function darf(route) {
  return route.rolle.some((r) => state.rollen.includes(r));
}

function aktuellerPfad() {
  const h = location.hash;
  // Token-Fragmente vom Magic Link (#access_token=…, #error=…) sind keine Route
  if (!h.startsWith('#/')) return '';
  return decodeURIComponent(h.slice(2)).replace(/\/+$/, '');
}

function finde(pfad) {
  const teile = pfad.split('/');
  for (const route of ROUTEN) {
    const muster = route.pfad.split('/');
    if (muster.length !== teile.length) continue;
    const params = {};
    const passt = muster.every((m, i) => {
      if (m.startsWith(':')) {
        params[m.slice(1)] = teile[i];
        return true;
      }
      return m === teile[i];
    });
    if (passt) return { route, params };
  }
  return null;
}

function startseite() {
  if (state.rollen.includes('redaktion')) return 'redaktion';
  if (state.rollen.includes('buchhaltung')) return 'zahlung';
  if (state.rollen.includes('admin')) return 'redaktion';
  return 'meine';
}

export function navigate(pfad) {
  if (aktuellerPfad() === pfad) render();
  else location.hash = '#/' + pfad;
}

function renderNav(pfad) {
  if (!state.session) {
    nav.innerHTML = '';
    return;
  }
  const links = ROUTEN.filter((r) => r.titel && darf(r))
    .map((r) => {
      const aktiv = pfad === r.pfad || pfad.startsWith(r.pfad + '/');
      return `<a href="#/${r.pfad}"${aktiv ? ' aria-current="page"' : ''}>${esc(r.titel)}</a>`;
    })
    .join('');
  nav.innerHTML = `${links}
    <span class="nav-user" title="${esc(state.session.user.email)}">${esc(state.session.user.email)}</span>
    <button type="button" class="btn-link" id="abmelden">Abmelden</button>`;
  nav.querySelector('#abmelden').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.hash = '';
  });
}

let renderZaehler = 0;

async function render() {
  const lauf = ++renderZaehler;
  const pfad = aktuellerPfad();
  window.scrollTo(0, 0);

  if (!state.session) {
    renderNav('');
    login.render(main, { supabase });
    return;
  }

  renderNav(pfad);

  if (!pfad) {
    location.replace('#/' + startseite());
    return;
  }

  const treffer = finde(pfad);
  if (!treffer || !darf(treffer.route)) {
    main.innerHTML = state.rollen.length
      ? `<section class="karte"><h1>Seite nicht verfügbar</h1>
           <p>Diese Seite gibt es nicht oder du hast keine Berechtigung dafür.</p>
           <p><a href="#/${startseite()}">Zur Startseite</a></p></section>`
      : `<section class="karte"><h1>Noch keine Rolle</h1>
           <p>Dein Konto hat noch keine Berechtigung. Bitte wende dich an die Redaktion.</p></section>`;
    return;
  }

  const flash = state.flash;
  state.flash = null;
  ladeAnzeige(main);
  try {
    await treffer.route.view.render(main, {
      supabase,
      session: state.session,
      rollen: state.rollen,
      params: treffer.params,
      navigate,
      flash,
      setFlash: (f) => (state.flash = f),
      istAktuell: () => lauf === renderZaehler,
    });
  } catch (e) {
    console.error(e);
    if (lauf === renderZaehler) {
      main.innerHTML = `<section class="karte fehlerbox" role="alert">
        <h1>Fehler</h1><p>${esc(fehlerText(e))}</p>
        <p><button type="button" class="btn" id="nochmal">Erneut versuchen</button></p></section>`;
      main.querySelector('#nochmal').addEventListener('click', render);
    }
  }
}

async function ladeRollen() {
  const { data, error } = await supabase.rpc('meine_rollen');
  if (error) throw error;
  state.rollen = data ?? [];
}

async function sessionGeaendert(session) {
  const vorher = state.session?.user?.id;
  state.session = session;
  if (session && session.user.id !== vorher) {
    try {
      await ladeRollen();
    } catch (e) {
      console.error(e);
      state.rollen = [];
    }
  }
  if (!session) state.rollen = [];
  if ((session?.user?.id ?? null) !== (vorher ?? null)) render();
}

async function start() {
  if (konfigFehlt) {
    main.innerHTML = `<section class="karte fehlerbox"><h1>Konfiguration fehlt</h1>
      <p>Die Datei <code>config.js</code> mit Supabase-URL und anon-Key fehlt.
      Siehe README, Abschnitt „Deployment“.</p></section>`;
    return;
  }
  // wertet ggf. den Magic-Link im URL-Fragment aus
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) {
    try {
      await ladeRollen();
    } catch (e) {
      console.error(e);
    }
  }
  render();

  supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase empfiehlt, im Callback keine weiteren Supabase-Aufrufe abzuwarten
    setTimeout(() => sessionGeaendert(session), 0);
  });
  window.addEventListener('hashchange', render);
}

start();
