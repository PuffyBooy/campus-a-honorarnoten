// „Hilfe“: Tour starten und die wichtigsten Abläufe zum Nachlesen – passend zu den eigenen Rollen
import { esc } from '../lib/format.js';
import { tourAnleitung, tourStarten } from '../lib/tour.js';

const FRAGEN = [
  ['Ich habe mein Passwort vergessen.', 'Auf der Anmeldeseite „Passwort vergessen?“ – du bekommst einen Link per E-Mail.'],
  ['Wo ändere ich Adresse, Bankverbindung oder Profil-Link?', 'Oben rechts auf deinen Namen → Mein Profil.'],
  ['Ich habe mich bei einer eingereichten Abrechnung vertan.', 'Solange die Redaktion sie noch nicht angenommen hat: in „Meine Abrechnungen“ zurückziehen, ändern und neu einreichen.'],
  ['Wie bekomme ich Mitteilungen aufs Handy?', 'Mein Profil → „Handy-App und Push-Mitteilungen“: App installieren und Mitteilungen einschalten.'],
  ['Wen frage ich bei Problemen?', 'Die Redaktion oder den Admin der App – oder per Rückfrage direkt an der Abrechnung.'],
];

export async function render(el, { store, nutzer }) {
  const anleitung = tourAnleitung(nutzer);
  el.innerHTML = `
    <div class="kopfzeile"><h1>Hilfe</h1></div>
    <section class="karte hilfe-start">
      <h2>Geführte Tour</h2>
      <p>In einer Minute durch die wichtigsten Stellen der App – passend zu deinen Aufgaben. Die Tour zeigt dir jede Stelle direkt auf der Seite.</p>
      <p><button type="button" class="btn btn-primaer" id="tour-starten">Tour starten</button></p>
    </section>
    <section class="karte">
      <h2>So funktioniert’s</h2>
      <ol class="hilfe-schritte">${anleitung.map((s) => `
        <li><strong>${esc(s.titel)}</strong><br>${esc(s.text)}${s.route ? ` <a href="#/${esc(s.route)}" class="klein">Hingehen →</a>` : ''}</li>`).join('')}
      </ol>
    </section>
    <section class="karte">
      <h2>Häufige Fragen</h2>
      ${FRAGEN.map(([f, a]) => `<details class="aufklapp"><summary>${esc(f)}</summary><p>${esc(a)}</p></details>`).join('')}
      <p class="klein">Mehr zu Datenschutz und Betreiber: <a href="#/datenschutz">Datenschutzerklärung</a> · <a href="#/impressum">Impressum</a></p>
    </section>`;
  el.querySelector('#tour-starten').addEventListener('click', () => tourStarten({ nutzer, store }));
}
