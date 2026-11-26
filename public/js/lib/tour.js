// Geführte Tour für neue Konten: Schritt für Schritt durch die wichtigsten Stellen, passend zu den Rollen.
// Startet nach dem ersten Einrichten von selbst (einmal) und jederzeit über „Hilfe“. Die Karte steht unten am
// Bildschirm, die erklärte Stelle wird hervorgehoben (Klasse .tour-ziel – keine Inline-Stile wegen der CSP).
import { esc } from './format.js';
import { darfRedigieren } from './konto.js';

/** Schritte je Rolle: route (ohne #/), ziel (CSS-Selektor, optional), titel, text */
function schritteFuer(nutzer) {
  const r = nutzer.rollen ?? [];
  const zaehler = Boolean(nutzer.redigier_zaehler);
  const s = [{
    titel: `Willkommen, ${nutzer.vorname || 'schön, dass du da bist'}!`,
    text: 'In einer Minute zeigen wir dir, wie die App funktioniert. Mit „Weiter“ geht es Schritt für Schritt – du kannst jederzeit beenden. '
      + 'Die Tour findest du später wieder oben unter „Hilfe“.',
  }];
  if (r.includes('autor')) {
    s.push(
      { route: 'leistungen', ziel: '#l-form', titel: 'Leistung speichern',
        text: 'Sobald ein Beitrag erschienen ist, trägst du ihn hier ein: Kategorie, Titel und Datum. Der übliche Betrag wird vorgeschlagen. '
          + 'Bis zum Einreichen kannst du alles jederzeit ändern.' },
      { route: 'leistungen', ziel: '#artikel-karte', titel: 'Deine Artikel',
        text: 'Hier erscheinen deine Artikel von campus-a-college.at und campus-a.at (über den Profil-Link). '
          + 'Mit „Übernehmen“ wird das Formular automatisch ausgefüllt – kein Abtippen.' },
      { route: 'leistungen', ziel: '#abrechnungen', titel: 'Einmal im Monat einreichen',
        text: 'Alles Gespeicherte sammelt sich hier, getrennt für campus a college und campus a. Am Monatsende einmal auf „einreichen“ '
          + 'tippen – daraus wird deine Prämienabrechnung mit Nummer. Bis die Redaktion sie annimmt, kannst du sie zurückziehen.' },
    );
    if (zaehler && darfRedigieren(nutzer)) {
      s.push({ route: 'leistungen', ziel: '#zaehler', titel: 'Redigieren mitzählen',
        text: 'Nach jedem redigierten Text auf „＋1 redigiert“ tippen – der Stapel wächst mit. Am Monatsende übernimmst du die Anzahl mit einem Klick. '
          + 'Automatisch geht es auch: Mein Profil → „Automatisch zählen“.' });
    }
    s.push(
      { route: 'noten', ziel: 'main .kennzahlen', titel: 'Meine Abrechnungen',
        text: 'Hier siehst du, was eingereicht, angenommen und bezahlt ist. Hat die Redaktion eine Rückfrage, steht sie hier – einfach antworten. '
          + 'Jede Abrechnung gibt es auch als PDF und Word, dazu eine Jahresübersicht.' },
      { route: 'profil', ziel: '#app-karte', titel: 'Aufs Handy holen',
        text: 'Die App lässt sich wie eine normale App aufs Handy installieren. Mit Push-Mitteilungen erfährst du sofort von Rückfragen und Zahlungen. '
          + 'Adresse, Bankverbindung und Profil-Links änderst du ebenfalls hier im Profil.' },
    );
  }
  if (r.includes('redaktion') || r.includes('admin')) {
    s.push(
      { route: 'redaktion', ziel: '.medium-schalter', titel: 'Redaktion: campus a oder college',
        text: 'Oben wählst du, für welches Medium du prüfst. Die Zahl zeigt, wie viele Abrechnungen dort auf dich warten.' },
      { route: 'redaktion', ziel: 'main nav.reiter', titel: 'Was zu tun ist',
        text: '„Zu prüfen“ zeigt neue Abrechnungen. Eine antippen: die Prüfansicht zeigt alle Leistungen mit Artikel-Links. '
          + 'Dann annehmen, mit Begründung zurückgeben oder eine Rückfrage stellen. Am Computer geht das auch mit Tastenkürzeln (Taste ?).' },
    );
    if (zaehler) {
      s.push({ route: 'redigieren', ziel: 'main .kopfzeile', titel: 'Redigieren live',
        text: 'Wie viele Texte diesen Monat schon redigiert wurden – je Person, mit Verlauf. Lässt sich auch als kleines eigenes Fenster öffnen.' });
    }
  }
  if (r.includes('buchhaltung') || r.includes('admin')) {
    s.push({ route: 'zahlung', ziel: 'main nav.reiter', titel: 'Buchhaltung',
      text: 'Unter „Offen“ stehen die angenommenen Abrechnungen, nach Wochen geordnet – mit SEPA-Datei, PDFs und „als bezahlt markieren“. '
        + 'Die Autor:innen bekommen dann automatisch ihr Zahlungsavis.' });
  }
  if (r.includes('admin')) {
    s.push(
      { route: 'admin/uebersicht', ziel: 'main nav.reiter', titel: 'Admin',
        text: 'Hier schaltest du Zugangsanfragen frei, lädst Leute mit einem Link ein oder legst Konten direkt an – auf Wunsch mit persönlicher Nachricht in der E-Mail. '
          + 'Unter „Einstellungen“ stehen Prämiensätze, Rechnungsempfänger und Impressum.' },
      { route: 'admin/uebersicht', ziel: 'a[href="#/admin/server"]', titel: 'Kommandozentrale',
        text: 'Zustand des Servers: Sicherungen, E-Mail-Versand, Geschwindigkeit und Fehler – mit Leistungstest und Engpass-Analyse.' },
    );
  }
  s.push({ ziel: '#hilfe-oeffnen', titel: 'Fertig!',
    text: 'Das war’s. Diese Tour und kurze Anleitungen findest du jederzeit oben unter „Hilfe“. Viel Freude mit der App!' });
  return s;
}

/** Für die Hilfe-Seite: dieselben Erklärungen als Liste (ohne Begrüßung und Abschluss) */
export const tourAnleitung = (nutzer) => schritteFuer(nutzer).slice(1, -1);

let aktiv = null; // laufende Tour
const vonSelbstGezeigt = new Set(); // Konten, denen die Tour in diesem Tab schon von selbst gezeigt wurde

const warten = (ms) => new Promise((ok) => setTimeout(ok, ms));
const aktuellerPfad = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')).replace(/\/+$/, '');

/** Element suchen, bis die Seite gezeichnet ist (höchstens ~4 Sekunden) */
async function finden(selektor) {
  for (let i = 0; i < 40; i++) {
    const el = selektor && document.querySelector(selektor);
    if (el && el.getClientRects().length) return el;
    await warten(100);
  }
  return null;
}

/**
 * Tour starten. automatisch: beim ersten Mal nach dem Einrichten – beendet oder übersprungen, wird sie am Konto
 * als gesehen vermerkt und kommt nicht wieder von selbst.
 */
export function tourStarten({ nutzer, store, automatisch = false }) {
  if (aktiv || (automatisch && vonSelbstGezeigt.has(nutzer.id))) return;
  if (automatisch) vonSelbstGezeigt.add(nutzer.id);
  const schritte = schritteFuer(nutzer);
  const karte = document.createElement('div');
  karte.className = 'tour';
  karte.setAttribute('role', 'dialog');
  karte.setAttribute('aria-labelledby', 'tour-titel');
  karte.setAttribute('aria-describedby', 'tour-text');
  document.body.append(karte);
  document.body.classList.add('tour-an');
  let nr = 0;
  let lauf = 0;
  let markiert = null;

  const markierungWeg = () => { markiert?.classList.remove('tour-ziel'); markiert = null; };
  const ende = () => {
    markierungWeg();
    karte.remove();
    document.body.classList.remove('tour-an');
    document.removeEventListener('keydown', tasten, true);
    aktiv = null;
    if (!nutzer.ansicht_von && !nutzer.tutorial_gesehen) {
      nutzer.tutorial_gesehen = new Date().toISOString();
      Promise.resolve(store.tutorialGesehen()).catch(() => {});
    }
  };
  const zeigen = async () => {
    const s = schritte[nr];
    const meinLauf = ++lauf;
    markierungWeg();
    karte.innerHTML = `
      <div class="tour-karte">
        <p class="tour-schritt klein">Schritt ${nr + 1} von ${schritte.length}</p>
        <h2 id="tour-titel">${esc(s.titel)}</h2>
        <p id="tour-text">${esc(s.text)}</p>
        <div class="tour-knoepfe">
          <button type="button" class="link-knopf" data-tour="ende">${nr === schritte.length - 1 ? '' : 'Tour beenden'}</button>
          <span class="aktionen eng">
            ${nr > 0 ? '<button type="button" class="btn" data-tour="zurueck">Zurück</button>' : ''}
            <button type="button" class="btn btn-primaer" data-tour="weiter">${nr === schritte.length - 1 ? 'Fertig' : nr === 0 ? 'Los geht’s' : 'Weiter'}</button>
          </span>
        </div>
      </div>`;
    karte.querySelector('[data-tour="weiter"]').focus({ preventScroll: true });
    if (s.route && aktuellerPfad() !== s.route) {
      // erst weiter, wenn die neue Seite gezeichnet ist – sonst wird ein Element der alten Seite markiert
      const main = document.getElementById('app');
      const vorher = main?.firstElementChild;
      location.hash = `#/${s.route}`;
      for (let i = 0; i < 40 && main?.firstElementChild === vorher; i++) await warten(100);
      if (meinLauf !== lauf || !aktiv) return;
    }
    if (!s.ziel) return;
    const el = await finden(s.ziel);
    if (!el || meinLauf !== lauf || !aktiv) return;
    markiert = el;
    el.classList.add('tour-ziel');
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  };
  const weiter = () => { if (nr < schritte.length - 1) { nr++; zeigen(); } else ende(); };
  const zurueck = () => { if (nr > 0) { nr--; zeigen(); } };
  function tasten(ev) {
    if (ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (ev.key === 'Escape') { ev.stopPropagation(); ende(); } else if (ev.key === 'ArrowRight') { ev.stopPropagation(); weiter(); } else if (ev.key === 'ArrowLeft') { ev.stopPropagation(); zurueck(); }
  }
  karte.addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-tour]')?.dataset.tour;
    if (k === 'weiter') weiter();
    else if (k === 'zurueck') zurueck();
    else if (k === 'ende') ende();
  });
  document.addEventListener('keydown', tasten, true);
  aktiv = { ende, automatisch };
  zeigen();
}

export const tourLaeuft = () => Boolean(aktiv);
