// Einstieg: Anmeldung, Navigation und Hash-Routing (funktioniert auf GitHub Pages)
import { MODUS } from './modus.js';
import { esc } from './lib/format.js';
import { fehlerText, ladeAnzeige } from './lib/ui.js';
import * as login from './views/login.js';
import * as profil from './views/profil.js';
import * as leistungen from './views/leistungen.js';
import * as noten from './views/noten.js';
import * as redaktion from './views/redaktion.js';
import * as redaktionDetail from './views/redaktion-detail.js';
import * as zahlung from './views/zahlung.js';
import * as admin from './views/admin.js';
import * as generator from './views/generator.js';

// Demo: Daten im Browser (store.js). Server: Daten über die API (api.js).
const IST_DEMO = MODUS !== 'server';
const store = IST_DEMO ? await import('./store.js') : await import('./api.js');
const demoDaten = IST_DEMO ? (await import('./demo.js')).demoDaten : null;

const main = document.getElementById('app');
const nav = document.getElementById('nav');
let flash = null;

const ROUTEN = [
  { pfad: 'leistungen', view: leistungen, rolle: ['autor'], titel: 'Meine Leistungen' },
  { pfad: 'noten', view: noten, rolle: ['autor'], titel: 'Meine Honorarnoten' },
  { pfad: 'extern', view: generator, rolle: ['autor'], titel: 'Externe Honorarnote' },
  { pfad: 'redaktion', view: redaktion, rolle: ['redaktion', 'admin'], titel: 'Redaktion' },
  { pfad: 'redaktion/:id', view: redaktionDetail, rolle: ['redaktion', 'admin'] },
  { pfad: 'zahlung', view: zahlung, rolle: ['buchhaltung', 'admin'], titel: 'Buchhaltung' },
  { pfad: 'zahlung/:tab', view: zahlung, rolle: ['buchhaltung', 'admin'] },
  { pfad: 'admin', view: admin, rolle: ['admin'], titel: 'Admin' },
  { pfad: 'admin/:tab', view: admin, rolle: ['admin'] },
  { pfad: 'profil', view: profil, rolle: ['autor', 'redaktion', 'buchhaltung', 'admin'] },
];

const darf = (nutzer, route) => route.rolle.some((r) => nutzer.rollen.includes(r));

function aktuellerPfad() {
  const h = location.hash;
  if (!h.startsWith('#/')) return '';
  return decodeURIComponent(h.slice(2)).replace(/\/+$/, '');
}

function finde(pfad) {
  const teile = pfad.split('/');
  for (const route of ROUTEN) {
    const muster = route.pfad.split('/');
    if (muster.length !== teile.length) continue;
    const params = {};
    if (muster.every((m, i) => (m.startsWith(':') ? ((params[m.slice(1)] = teile[i]), true) : m === teile[i]))) {
      return { route, params };
    }
  }
  return null;
}

function startseite(nutzer) {
  const r = nutzer.rollen;
  if (r.includes('redaktion')) return 'redaktion';
  if (r.includes('buchhaltung')) return 'zahlung';
  if (r.includes('admin')) return 'admin';
  return 'leistungen';
}

export function navigate(pfad) {
  if (aktuellerPfad() === pfad) render();
  else location.hash = '#/' + pfad;
}

// Handy: Menü über den Knopf mit den drei Strichen auf- und zuklappen
const menueKnopf = document.getElementById('menue-knopf');
function menueSchliessen() {
  document.body.classList.remove('menue-offen');
  menueKnopf.setAttribute('aria-expanded', 'false');
}
menueKnopf.addEventListener('click', () => {
  const offen = document.body.classList.toggle('menue-offen');
  menueKnopf.setAttribute('aria-expanded', String(offen));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menueSchliessen(); });

async function renderNav(nutzer, pfad) {
  menueSchliessen();
  const mitMenue = Boolean(nutzer && !nutzer.muss_passwort_aendern);
  document.body.classList.toggle('mit-menue', mitMenue);
  if (!mitMenue) {
    nav.innerHTML = '';
    return;
  }
  const anfragen = await Promise.resolve(store.offeneAnfragenAnzahl()).catch(() => 0);
  const links = ROUTEN.filter((r) => r.titel && darf(nutzer, r)).map((r) => {
    const aktiv = pfad === r.pfad || pfad.startsWith(r.pfad + '/');
    const zusatz = r.pfad === 'admin' && anfragen
      ? ` <span class="zaehler" title="offene Zugangsanfragen">${anfragen}</span>` : '';
    return `<a href="#/${r.pfad}"${aktiv ? ' aria-current="page"' : ''}>${esc(r.titel)}${zusatz}</a>`;
  }).join('');
  nav.innerHTML = `<div class="nav-links">${links}</div>
    <div class="nav-konto">
      <a href="#/profil" class="nav-user"${pfad === 'profil' ? ' aria-current="page"' : ''}
         title="${esc(nutzer.email)}">${esc(nutzer.vorname)} ${esc(nutzer.nachname)}</a>
      <button type="button" class="btn-link" id="abmelden">Abmelden</button>
    </div>`;
  nav.querySelector('#abmelden').addEventListener('click', async () => {
    await Promise.resolve(store.abmelden()).catch(() => {});
    // Adresse ohne Route; genau einmal neu zeichnen (sonst gehen Eingaben verloren)
    history.replaceState(null, '', location.pathname + location.search);
    render();
  });
}

let renderZaehler = 0;

async function render() {
  const lauf = ++renderZaehler;
  const pfad = aktuellerPfad();
  let nutzer;
  try {
    nutzer = await store.aktuellerNutzer();
  } catch (e) {
    main.innerHTML = `<section class="karte fehlerbox" role="alert"><h1>Keine Verbindung</h1>
      <p>${esc(fehlerText(e))}</p><p><button type="button" class="btn" id="nochmal">Erneut versuchen</button></p></section>`;
    main.querySelector('#nochmal').addEventListener('click', render);
    return;
  }
  if (lauf !== renderZaehler) return; // inzwischen wurde neu navigiert
  await renderNav(nutzer, pfad);

  if (!nutzer) {
    login.render(main, { store, istDemo: IST_DEMO, nachAnmeldung: (ziel) => {
      history.replaceState(null, '', ziel ? '#/' + ziel : location.pathname + location.search);
      render();
    } });
    return;
  }
  // Erstes Login mit Startpasswort: zuerst eigenes Passwort festlegen
  if (nutzer.muss_passwort_aendern) {
    login.renderPasswortFestlegen(main, {
      store,
      nutzer,
      weiter: () => {
        // Autor:innen tragen danach gleich Adresse und Bankverbindung ein
        const ziel = nutzer.rollen.includes('autor') && !store.profilVollstaendig(nutzer) ? 'profil' : startseite(nutzer);
        if (aktuellerPfad() === ziel) render();
        else location.hash = '#/' + ziel;
      },
      abmelden: async () => { await Promise.resolve(store.abmelden()).catch(() => {}); render(); },
    });
    return;
  }

  if (!pfad) {
    location.replace('#/' + startseite(nutzer));
    return;
  }

  const treffer = finde(pfad);
  if (!treffer || !darf(nutzer, treffer.route)) {
    main.innerHTML = nutzer.rollen.length
      ? `<section class="karte"><h1>Seite nicht verfügbar</h1>
           <p>Diese Seite gibt es nicht oder du hast keine Berechtigung dafür.</p>
           <p><a href="#/${startseite(nutzer)}">Zur Startseite</a></p></section>`
      : `<section class="karte"><h1>Noch keine Rolle</h1>
           <p>Dein Konto hat noch keine Berechtigung. Bitte wende dich an die Redaktion.</p></section>`;
    return;
  }

  const f = flash;
  flash = null;
  ladeAnzeige(main);
  try {
    await treffer.route.view.render(main, {
      store,
      nutzer,
      params: treffer.params,
      navigate,
      flash: f,
      setFlash: (x) => { flash = x; },
      neuLaden: render,
      demoDaten,
      istDemo: IST_DEMO,
      istAktuell: () => lauf === renderZaehler,
    });
  } catch (e) {
    console.error(e);
    if (lauf !== renderZaehler) return;
    main.innerHTML = `<section class="karte fehlerbox" role="alert">
      <h1>Fehler</h1><p>${esc(fehlerText(e))}</p>
      <p><a href="#/${startseite(nutzer)}">Zur Startseite</a></p></section>`;
  }
}

async function start() {
  if (IST_DEMO && !window.crypto?.subtle) {
    main.innerHTML = `<section class="karte fehlerbox"><h1>Nicht unterstützt</h1>
      <p>Bitte die Seite über https (z. B. GitHub Pages) oder <code>npm run dev</code> öffnen –
      nicht direkt als Datei.</p></section>`;
    return;
  }
  document.body.classList.toggle('modus-demo', IST_DEMO);
  await store.initialisieren({ demoDaten });
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  // Demo: Änderung in einem anderen Tab -> neu zeichnen, außer man tippt gerade etwas
  // oder ist nicht angemeldet (Login-Seite zeigt keine Daten an)
  window.addEventListener('honorare:extern', async () => {
    const fokus = document.activeElement;
    if ((await store.aktuellerNutzer()) && !fokus?.closest('form')) render();
  });
  // Server: Sitzung abgelaufen -> zurück zur Anmeldung
  window.addEventListener('honorare:abgemeldet', () => render());
  render();
}

start();
