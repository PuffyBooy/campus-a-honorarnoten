// Cookies und Speicher im Browser: Auswahl beim ersten Besuch, jederzeit änderbar (Fußzeile „Cookie-Einstellungen“).
// Notwendig (ohne Einwilligung, § 165 Abs. 3 TKG 2021): Sitzungs-Cookie und das Merken dieser Auswahl.
// Optional (nur mit Einwilligung): „Komfort“ – Entwurf der Externen Honorarnote auf diesem Gerät merken.

const KEY = 'campus-a-honorare:cookie-wahl';
const VERSION = 1; // erhöhen, wenn neue optionale Zwecke dazukommen -> Auswahl wird erneut abgefragt
const KOMFORT_PREFIX = 'campus-a-honorare:generator';

export const COOKIES = [
  { name: 'hn_sitzung', art: 'Cookie', notwendig: true, zweck: 'Hält dich angemeldet. Wird beim Abmelden gelöscht, läuft nach 14 Tagen ab.' },
  { name: 'Cookie-Auswahl', art: 'Browser-Speicher', notwendig: true, zweck: 'Merkt sich deine Auswahl auf diesem Gerät.' },
  { name: 'Redigier-Zähler', art: 'Browser-Speicher', notwendig: true, zweck: 'Nur wer redigiert: Klicks auf „＋1 redigiert“, die noch nicht beim Server angekommen sind (z. B. ohne Netz). Werden gelöscht, sobald sie übertragen sind.' },
  { name: 'Komfort', art: 'Browser-Speicher', notwendig: false, zweck: 'Merkt den Entwurf und die Nummern der Externen Honorarnote auf diesem Gerät, damit nichts verloren geht. Ohne Zustimmung bleibt der Entwurf nur, bis du die Seite schließt.' },
];

function lesen() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return w && w.version === VERSION ? w : null;
  } catch {
    return null;
  }
}

/** Hat die Person schon gewählt? */
export const gewaehlt = () => lesen() !== null;

/** Darf der Komfort-Speicher verwendet werden? */
export const komfortErlaubt = () => lesen()?.komfort === true;

export function waehlen(komfort) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, komfort: Boolean(komfort), am: new Date().toISOString() }));
    if (!komfort) {
      // Widerruf: bisher Gespeichertes löschen
      for (const k of Object.keys(localStorage)) if (k.startsWith(KOMFORT_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* Speicher gesperrt: dann wird ohnehin nichts gemerkt */ }
  window.dispatchEvent(new CustomEvent('honorare:cookie-wahl', { detail: { komfort: Boolean(komfort) } }));
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Banner unten anzeigen (beim ersten Besuch oder über „Cookie-Einstellungen“) */
export function cookieBanner({ details = false } = {}) {
  document.getElementById('cookie-banner')?.remove();
  const komfort = komfortErlaubt();
  const el = document.createElement('section');
  el.id = 'cookie-banner';
  el.className = 'cookie-banner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'cookie-titel');
  el.innerHTML = `
    <div class="cookie-innen">
      <h2 id="cookie-titel">Cookies und Speicher</h2>
      <p>Diese App verwendet <strong>keine Werbung, kein Tracking und keine Analyse</strong>. Notwendig ist nur ein
        Cookie für die Anmeldung. Optional kann sich dein Browser Entwürfe merken. Mehr in der
        <a href="#/datenschutz">Datenschutzerklärung</a>.</p>
      <details class="cookie-details" ${details ? 'open' : ''}>
        <summary>Einstellungen und Details</summary>
        <ul class="cookie-liste">${COOKIES.map((c) => `
          <li><label class="check"><input type="checkbox" ${c.notwendig ? 'checked disabled' : `name="komfort" ${komfort ? 'checked' : ''}`}>
            <span><strong>${esc(c.name)}</strong> <span class="klein">(${esc(c.art)}, ${c.notwendig ? 'notwendig' : 'optional'})</span><br>
            <span class="klein">${esc(c.zweck)}</span></span></label></li>`).join('')}
        </ul>
        <button type="button" class="btn btn-klein" data-wahl="auswahl">Auswahl speichern</button>
      </details>
      <div class="aktionen">
        <button type="button" class="btn" data-wahl="notwendig">Nur notwendige</button>
        <button type="button" class="btn" data-wahl="alle">Alle erlauben</button>
      </div>
    </div>`;
  el.addEventListener('click', (ev) => {
    const w = ev.target.closest('[data-wahl]')?.dataset.wahl;
    if (!w) return;
    waehlen(w === 'alle' || (w === 'auswahl' && el.querySelector('[name=komfort]').checked));
    el.remove();
  });
  document.body.append(el);
  el.querySelector('[data-wahl=notwendig]').focus({ preventScroll: true });
}
