// Einstieg: Anmeldung, Navigation und Hash-Routing (funktioniert auf GitHub Pages)
import { MODUS } from './modus.js';
import { esc } from './lib/format.js';
import { fehlerText, ladeAnzeige } from './lib/ui.js';
import * as login from './views/login.js';
import * as einrichtung from './views/einrichtung.js';
import * as profil from './views/profil.js';
import * as leistungen from './views/leistungen.js';
import * as noten from './views/noten.js';
import * as redaktion from './views/redaktion.js';
import * as zahlung from './views/zahlung.js';
import * as admin from './views/admin.js';
import * as generator from './views/generator.js';
import * as rechtlichesSeite from './views/rechtliches.js';
import * as registrieren from './views/registrieren.js';
import * as passwortSeite from './views/passwort.js';
import { hinweisOffen, zustimmungHtml } from './lib/rechtliches.js';
import { cookieBanner, gewaehlt } from './lib/cookies.js';

// Demo: Daten im Browser (store.js). Server: Daten über die API (api.js).
const IST_DEMO = MODUS !== 'server';
const store = IST_DEMO ? await import('./store.js') : await import('./api.js');
const demoModul = IST_DEMO ? await import('./demo.js') : null;
const demoDaten = demoModul?.demoDaten ?? null;

const main = document.getElementById('app');
const nav = document.getElementById('nav');
const banner = document.getElementById('banner');
let flash = null;

const ROUTEN = [
  { pfad: 'leistungen', view: leistungen, rolle: ['autor'], titel: 'Mein Monat' },
  { pfad: 'noten', view: noten, rolle: ['autor'], titel: 'Meine Abrechnungen' },
  { pfad: 'extern', view: generator, rolle: ['autor'], titel: 'Externe Honorarnote' },
  { pfad: 'redaktion', view: redaktion, rolle: ['redaktion', 'admin'], titel: 'Redaktion' },
  { pfad: 'redaktion/:id', view: redaktion, rolle: ['redaktion', 'admin'] },
  { pfad: 'zahlung', view: zahlung, rolle: ['buchhaltung', 'admin'], titel: 'Buchhaltung' },
  { pfad: 'zahlung/:tab', view: zahlung, rolle: ['buchhaltung', 'admin'] },
  { pfad: 'admin', view: admin, rolle: ['admin'], titel: 'Admin' },
  { pfad: 'admin/:tab', view: admin, rolle: ['admin'] },
  { pfad: 'profil', view: profil, rolle: ['autor', 'redaktion', 'buchhaltung', 'admin'] },
];

/** „Maria Muster“ -> „MM“ für den runden Knopf zum Profil */
const initialen = (n) => (`${n.vorname?.[0] ?? ''}${n.nachname?.[0] ?? ''}`.toUpperCase() || (n.email?.[0] ?? '?').toUpperCase());

const darf = (nutzer, route) => route.rolle.some((r) => nutzer.rollen.includes(r));
const kontoEinrichten = (nutzer) => nutzer.muss_passwort_aendern || !store.profilVollstaendig(nutzer);

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

// Datumsfeld: Klick irgendwo ins Feld öffnet den Kalender (nicht nur auf das Symbol)
document.addEventListener('click', (e) => {
  if (e.target.matches?.('input[type="date"]:not([readonly]):not([disabled])')) {
    try { e.target.showPicker(); } catch { /* ältere Browser: Standardverhalten */ }
  }
});

async function renderNav(nutzer, pfad) {
  menueSchliessen();
  const mitMenue = Boolean(nutzer && !kontoEinrichten(nutzer));
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
         title="Mein Profil · ${esc(nutzer.email)}"><span class="avatar" aria-hidden="true">${esc(initialen(nutzer))}</span>${esc(nutzer.vorname)} ${esc(nutzer.nachname)}</a>
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

/**
 * Datenschutzerklärung und Hinweis „Betreiber nicht bei campus a angestellt“: nach dem Anmelden oben, bis sie
 * zur Kenntnis genommen wurden (beim Konto einrichten stehen sie im Formular). Ändern sich die Angaben, erneut.
 */
function hinweisBanner(nutzer, recht) {
  const zeigen = recht && nutzer && !kontoEinrichten(nutzer) && hinweisOffen(nutzer, recht.betreiber);
  banner.innerHTML = zeigen ? `<aside class="hinweis-betreiber" role="note"><span>${zustimmungHtml(recht)}</span>
    <button type="button" class="btn btn-klein" id="hinweis-ok">Gelesen und zur Kenntnis genommen</button></aside>` : '';
  banner.querySelector('#hinweis-ok')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await store.hinweisBestaetigen();
      banner.innerHTML = '';
    } catch (e) {
      ev.currentTarget.disabled = false;
      alert(fehlerText(e));
    }
  });
}

/**
 * „Wird geladen …“ erst zeigen, wenn das Laden länger dauert: bei schnellen Seitenwechseln und beim Filtern
 * bleibt der bisherige Inhalt stehen, statt kurz zu verschwinden und die Seite springen zu lassen.
 * Liefert eine Funktion, die die Anzeige abbricht.
 */
function ladenSpaeter() {
  const vorher = main.firstElementChild;
  const t = setTimeout(() => { if (main.firstElementChild === vorher) ladeAnzeige(main); }, 400);
  return () => clearTimeout(t);
}

async function render() {
  const lauf = ++renderZaehler;
  const pfad = aktuellerPfad();
  // Breite der Seite (die Redaktion ist breiter) erst umstellen, wenn der neue Inhalt kommt –
  // sonst springt der alte Inhalt kurz in die neue Breite
  const seite = pfad.split('/')[0];
  if (main.dataset.seite !== seite) {
    const beobachter = new MutationObserver(() => { main.dataset.seite = seite; beobachter.disconnect(); });
    beobachter.observe(main, { childList: true });
  }
  let nutzer;
  try {
    nutzer = await store.aktuellerNutzer();
  } catch (e) {
    // Hinweis auf die Einrichtung als Link (z. B. „Bitte zuerst …/einrichten.php öffnen“)
    const text = esc(fehlerText(e)).replace(/(https?:\/\/[^\s<]+einrichten\.php)/, '<a href="$1">$1</a>');
    main.innerHTML = `<section class="karte fehlerbox" role="alert"><h1>Die App ist gerade nicht erreichbar</h1>
      <p>${text}</p><p><button type="button" class="btn" id="nochmal">Erneut versuchen</button></p></section>`;
    main.querySelector('#nochmal').addEventListener('click', render);
    return;
  }
  if (lauf !== renderZaehler) return; // inzwischen wurde neu navigiert
  await renderNav(nutzer, pfad);
  // Impressum und Datenschutz: für alle lesbar, auch ohne Anmeldung
  const recht = await Promise.resolve(store.rechtliches()).catch(() => null);
  if (lauf !== renderZaehler) return;
  hinweisBanner(nutzer, recht);
  if (pfad === 'impressum' || pfad === 'datenschutz') {
    ladeAnzeige(main);
    await rechtlichesSeite.render(main, { store, istDemo: IST_DEMO, seite: pfad, angemeldet: Boolean(nutzer) }).catch((e) => {
      main.innerHTML = `<section class="karte fehlerbox" role="alert"><p>${esc(fehlerText(e))}</p></section>`;
    });
    return;
  }

  // Link aus der Zugangs-Mail: direkt anmelden, Token danach aus der Adresszeile entfernen
  if (pfad.startsWith('link/')) {
    ladeAnzeige(main);
    try {
      await store.linkAnmelden(pfad.slice(5));
      history.replaceState(null, '', location.pathname + location.search);
      render();
    } catch (e) {
      history.replaceState(null, '', location.pathname + location.search);
      main.innerHTML = `<section class="karte schmal"><h1>Anmelden</h1><p class="fehlerbox">${esc(fehlerText(e))}</p>
        <p><a href="#/" class="btn btn-primaer">Zur Anmeldung</a></p></section>`;
    }
    return;
  }
  // Link aus „Passwort vergessen“
  if (pfad.startsWith('passwort/')) {
    passwortSeite.render(main, { store, token: pfad.slice(9), fertig: () => {
      history.replaceState(null, '', location.pathname + location.search);
      render();
    } });
    return;
  }
  // Registrierungslink vom Admin
  if (pfad.startsWith('registrieren/')) {
    ladeAnzeige(main);
    await registrieren.render(main, { store, token: pfad.slice(13), recht, fertig: () => {
      history.replaceState(null, '', location.pathname + location.search);
      render();
    } });
    return;
  }

  if (!nutzer) {
    login.render(main, { store, istDemo: IST_DEMO, recht, nachAnmeldung: (ziel) => {
      history.replaceState(null, '', ziel ? '#/' + ziel : location.pathname + location.search);
      render();
    } });
    return;
  }
  // Erstes Login mit Startpasswort bzw. Konto noch nicht fertig: zuerst Konto einrichten
  // (eigenes Passwort; Autor:innen zusätzlich Adresse, Bankverbindung und Profil-Link)
  if (kontoEinrichten(nutzer)) {
    einrichtung.render(main, {
      store,
      nutzer,
      recht,
      weiter: () => {
        const ziel = startseite(nutzer);
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
  const ladenFertig = ladenSpaeter();
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
    ladenFertig();
  } catch (e) {
    console.error(e);
    if (lauf !== renderZaehler) return;
    ladenFertig();
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
  await store.initialisieren({ demoDaten, demoAktualisieren: demoModul?.demoKontenAktualisieren });
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  // Demo: Änderung in einem anderen Tab -> neu zeichnen, außer man tippt gerade etwas
  // oder ist nicht angemeldet (Login-Seite zeigt keine Daten an)
  window.addEventListener('honorare:extern', async () => {
    const fokus = document.activeElement;
    if ((await store.aktuellerNutzer()) && !fokus?.closest('form')) render();
  });
  // Server: Sitzung abgelaufen -> zurück zur Anmeldung
  window.addEventListener('honorare:abgemeldet', () => render());
  // Cookies: beim ersten Besuch fragen, über die Fußzeile jederzeit änderbar
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#cookie-einstellungen, [data-cookie-einstellungen]')) cookieBanner({ details: true });
  });
  window.addEventListener('honorare:cookie-wahl', () => { if (location.hash.startsWith('#/extern')) render(); });
  if (!gewaehlt()) cookieBanner();
  render();
}

start();
