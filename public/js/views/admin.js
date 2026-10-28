// Admin-Terminal: Benutzer & Rollen, Prämienabrechnungen löschen, Einstellungen, Datensicherung
import {
  ROLLEN_LABEL, esc, formatBetragPlain, formatEuro, formatMonat, formatZeitpunkt, parseBetrag, vollerName,
} from '../lib/format.js';
import { downloadBlob, downloadText } from '../lib/csv.js';
import { MEDIEN, MEDIUM_KEYS } from '../lib/campus.js';
import { formatIban } from '../lib/iban.js';
import { bestaetigen, fehlerText, kopierenMitFeedback, meldung, mitSperre, statusBadge } from '../lib/ui.js';
import { STANDARD_HOSTER, betreiberOder } from '../lib/rechtliches.js';
import * as kommandozentrale from './kommandozentrale.js';

const REITER = {
  uebersicht: 'Übersicht', anfragen: 'Anfragen', einladen: 'Einladen', benutzer: 'Benutzer', noten: 'Abrechnungen',
  protokoll: 'Protokoll', einstellungen: 'Einstellungen', mail: 'E-Mail', daten: 'Daten',
};

const STUFE_LABEL = { info: 'Info', warnung: 'Warnung', fehler: 'Fehler' };
const stufeBadge = (s) => `<span class="stufe stufe-${esc(s)}">${esc(STUFE_LABEL[s] ?? s)}</span>`;
const groesse = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1).replace('.', ',')} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);

/** Startseite: das Wichtigste auf einen Blick, letzte Aktivität und Zustand des Systems */
async function uebersicht(inhalt, { store }) {
  const d = await store.dashboard();
  const z = d.zahlen;
  const sys = d.system;
  const karte = (link, titel, wert, unten, art = '') => `
    <a class="kennzahl kennzahl-link${art}" href="${link}"><span class="kennzahl-titel">${esc(titel)}</span>
      <strong>${esc(String(wert))}</strong><span class="klein">${esc(unten)}</span></a>`;
  inhalt.innerHTML = `
    <section class="kennzahlen kennzahlen-5" aria-label="Überblick">
      ${karte('#/redaktion', 'Zu prüfen', z.zu_pruefen, 'Abrechnungen bei der Redaktion', z.zu_pruefen ? ' kennzahl-marke' : '')}
      ${karte('#/zahlung', 'Offen zur Zahlung', formatEuro(z.zur_zahlung_summe), `${z.zur_zahlung} angenommen`)}
      ${karte('#/admin/anfragen', 'Zugangsanfragen', z.anfragen, 'offen', z.anfragen ? ' kennzahl-achtung' : '')}
      ${karte('#/admin/benutzer', 'Konten', z.konten, `aktiv · ${z.entwuerfe} gespeicherte Leistungen`)}
      ${karte('#/admin/protokoll', 'Letzte 7 Tage', `${z.fehler} / ${z.warnungen}`, 'Fehler / Warnungen',
        z.fehler ? ' kennzahl-fehler' : z.warnungen ? ' kennzahl-achtung' : '')}
    </section>
    <div class="spalten">
      <section class="karte">
        <div class="kopfzeile"><h2>Letzte Aktivität</h2><a href="#/admin/protokoll" class="klein">Ganzes Protokoll</a></div>
        ${d.aktivitaet.length ? `<ul class="aktivitaet">${d.aktivitaet.map((e) => `
          <li><span class="punkt punkt-${esc(e.stufe)}" title="${esc(STUFE_LABEL[e.stufe])}"></span>
            <span><span class="aktivitaet-text">${esc(e.text)}</span><br>
              <span class="klein">${esc(formatZeitpunkt(e.zeit))}${e.wer ? ` · ${esc(e.wer)}` : ''}</span></span></li>`).join('')}</ul>`
          : '<p class="klein">Noch keine Einträge.</p>'}
      </section>
      <section class="karte">
        <h2>System</h2>
        <dl class="angaben">
          <dt>Datenbank</dt><dd>${esc(sys.datenbank)}</dd>
          <dt>PHP</dt><dd>${esc(sys.php)}</dd>
          ${sys.version ? `<dt>App-Version</dt><dd class="mono">${esc(sys.version)}</dd>` : ''}
          <dt>E-Mail-Versand</dt><dd>${sys.mail.aktiv ? '<span class="badge badge-bezahlt">aktiv</span>' : '<span class="badge badge-abgelehnt">aus</span>'}
            ${sys.mail.offen ? ` · ${sys.mail.offen} in der Warteschlange` : ''}
            ${sys.mail.fehlgeschlagen ? ` · <a href="#/admin/mail">${sys.mail.fehlgeschlagen} fehlgeschlagen</a>` : ''}</dd>
          <dt>Sicherungen</dt><dd>${sys.letzte_sicherung
            ? `letzte ${esc(formatZeitpunkt(sys.letzte_sicherung.zeit))} (${esc(groesse(sys.letzte_sicherung.groesse))}) · ${sys.sicherungen} vorhanden`
            : 'noch keine'} · <a href="#/admin/daten">ansehen</a></dd>
        </dl>
      </section>
    </div>`;
}

// Filter des Protokolls (bleiben beim Neuladen erhalten)
const protokollFilter = { stufe: '', bereich: '', suche: '' };

/** Protokoll: alles, was im Hintergrund passiert, nach Info, Warnung und Fehler */
async function protokoll(inhalt, { store, neuLaden }) {
  const daten = await store.protokollLesen(protokollFilter);
  let eintraege = daten.eintraege;
  const zeilen = (liste) => liste.map((e) => `
    <tr class="zeile-${esc(e.stufe)}">
      <td data-label="Zeit" class="nowrap">${esc(formatZeitpunkt(e.zeit))}</td>
      <td data-label="Stufe">${stufeBadge(e.stufe)}</td>
      <td data-label="Bereich">${esc(daten.bereiche[e.bereich] ?? e.bereich)}</td>
      <td data-label="Ereignis" class="umbruch">${esc(e.text)}</td>
      <td data-label="Wer">${esc(e.wer || '–')}</td>
    </tr>`).join('');
  inhalt.innerHTML = `
    <div class="protokoll-filter">
      <div class="chips" role="group" aria-label="Stufe">
        ${[['', 'Alle', daten.zaehler.alle], ...Object.entries(STUFE_LABEL).map(([k, l]) => [k, l, daten.zaehler[k]])].map(([k, l, n]) => `
          <button type="button" class="chip${k ? ` chip-${k}` : ''}" data-stufe="${k}" aria-pressed="${protokollFilter.stufe === k}">${esc(l)} <span>${n}</span></button>`).join('')}
      </div>
      <select id="p-bereich" aria-label="Bereich"><option value="">Alle Bereiche</option>
        ${Object.entries(daten.bereiche).map(([k, l]) => `<option value="${k}" ${protokollFilter.bereich === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <input id="p-suche" type="search" placeholder="Suchen (Text oder Name)" value="${esc(protokollFilter.suche)}" aria-label="Suchen">
      <button type="button" class="btn btn-klein" id="p-csv">CSV</button>
    </div>
    <p class="tipp">Wird automatisch im Hintergrund geschrieben und 1 Jahr aufgehoben. IP-Adressen nur gekürzt.</p>
    ${eintraege.length ? `<table class="tabelle protokoll-tabelle">
      <thead><tr><th>Zeit</th><th>Stufe</th><th>Bereich</th><th>Ereignis</th><th>Wer</th></tr></thead>
      <tbody>${zeilen(eintraege)}</tbody></table>
      ${daten.mehr ? '<p><button type="button" class="btn" id="p-mehr">Ältere laden</button></p>' : ''}`
      : '<section class="karte"><p>Keine Einträge gefunden.</p></section>'}`;

  const setzen = (feld, wert) => { protokollFilter[feld] = wert; neuLaden(); };
  inhalt.querySelector('.chips').addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-stufe]');
    if (k) setzen('stufe', k.dataset.stufe);
  });
  inhalt.querySelector('#p-bereich').addEventListener('change', (ev) => setzen('bereich', ev.target.value));
  let warten;
  inhalt.querySelector('#p-suche').addEventListener('input', (ev) => {
    clearTimeout(warten);
    warten = setTimeout(async () => {
      protokollFilter.suche = ev.target.value;
      await neuLaden();
      const f = document.getElementById('p-suche');
      f?.focus();
      f?.setSelectionRange(f.value.length, f.value.length);
    }, 300);
  });
  inhalt.querySelector('#p-mehr')?.addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    const mehr = await store.protokollLesen({ ...protokollFilter, vor: eintraege.at(-1).zeit });
    eintraege = [...eintraege, ...mehr.eintraege];
    inhalt.querySelector('.protokoll-tabelle tbody').insertAdjacentHTML('beforeend', zeilen(mehr.eintraege));
    if (!mehr.mehr) ev.target.remove();
  }));
  inhalt.querySelector('#p-csv').addEventListener('click', () => {
    const csv = [['Zeit', 'Stufe', 'Bereich', 'Ereignis', 'Wer'],
      ...eintraege.map((e) => [e.zeit, STUFE_LABEL[e.stufe], daten.bereiche[e.bereich] ?? e.bereich, e.text, e.wer])]
      .map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadText(`protokoll-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}`);
  });
}

// Zuletzt erzeugte Zugangsdaten – bleiben sichtbar, bis der Admin sie wegklickt
let zugangsdaten = null;

function zugangsText(z) {
  return `Hallo ${z.vorname},\n\ndein Zugang zu den Anerkennungsprämien von campus a college und campus a ist bereit.\n\n`
    + `Mit diesem Link bist du direkt angemeldet (gilt einmal, 7 Tage):\n${z.link}\n\n`
    + `Oder anmelden mit\nE-Mail: ${z.email}\nStartpasswort: ${z.passwort}\n\n`
    + 'Beim ersten Anmelden legst du dein eigenes Passwort fest.\n\nLiebe Grüße\ndeine Redaktion';
}

function zugangsdatenHtml(z) {
  // Mit eingerichtetem E-Mail-Versand geht alles automatisch hinaus – dann nur zur Info
  const mailto = `mailto:${encodeURIComponent(z.email)}?subject=${encodeURIComponent('Dein Zugang zu den Anerkennungsprämien')}`
    + `&body=${encodeURIComponent(zugangsText(z))}`;
  return `
    <section class="karte zugangsdaten" role="status">
      <h2>Zugangsdaten für ${esc(z.vorname)}</h2>
      ${z.mail && !z.mail_fehler ? `<p class="erfolgbox">Die Zugangs-Mail wurde an <strong>${esc(z.email)}</strong> verschickt,
        mit einem Knopf, der direkt anmeldet. Du musst nichts weiter tun.</p>`
        : z.mail ? `<p class="fehlerbox"><strong>Die E-Mail an ${esc(z.email)} konnte nicht verschickt werden.</strong>
          Meldung des Mailservers: ${esc(z.mail_fehler)}<br>Die App versucht es später automatisch noch einmal.
          Sicherer: Zugangsdaten jetzt selbst weitergeben und unter Admin → E-Mail die Einstellungen prüfen.</p>`
        : '<p>Der E-Mail-Versand ist nicht eingerichtet (Admin → E-Mail). Bitte die Zugangsdaten selbst weitergeben. Sie werden nur jetzt angezeigt.</p>'}
      <div class="kopierblock">
        <div class="kopierzeile"><span class="kopier-label">E-Mail</span><span class="kopier-wert">${esc(z.email)}</span><span></span></div>
        <div class="kopierzeile"><span class="kopier-label">Startpasswort</span>
          <span class="kopier-wert mono">${esc(z.passwort)}</span>
          <button type="button" class="btn btn-klein" data-z="pw">Kopieren</button></div>
        ${z.link ? `<div class="kopierzeile"><span class="kopier-label">Link zum direkten Anmelden (einmal, 7 Tage)</span>
          <span class="kopier-wert klein">${esc(z.link)}</span>
          <button type="button" class="btn btn-klein" data-z="link">Kopieren</button></div>` : ''}
      </div>
      <div class="aktionen">
        ${z.mail && !z.mail_fehler ? '' : `<a class="btn btn-primaer" href="${esc(mailto)}">E-Mail vorbereiten</a>
        <button type="button" class="btn" data-z="text">Text kopieren</button>`}
        <button type="button" class="btn" data-z="fertig">${z.mail && !z.mail_fehler ? 'Ok' : 'Erledigt'}</button>
      </div>
    </section>`;
}

function zugangsdatenBinden(box, neuLaden) {
  box.querySelector('.zugangsdaten')?.addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-z]');
    if (!k || !zugangsdaten) return;
    if (k.dataset.z === 'pw') kopierenMitFeedback(k, zugangsdaten.passwort);
    if (k.dataset.z === 'link') kopierenMitFeedback(k, zugangsdaten.link);
    if (k.dataset.z === 'text') kopierenMitFeedback(k, zugangsText(zugangsdaten));
    if (k.dataset.z === 'fertig') { zugangsdaten = null; neuLaden(); }
  });
}

function rollenAuswahl(vorauswahl = ['autor'], ohne = []) {
  return `<span class="rollen-wahl">${Object.entries(ROLLEN_LABEL).filter(([r]) => !ohne.includes(r)).map(([r, l]) => `
    <label class="check"><input type="checkbox" data-rolle="${r}" ${vorauswahl.includes(r) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</span>`;
}

const gewaehlteRollen = (el) => Array.from(el.querySelectorAll('[data-rolle]:checked'), (x) => x.dataset.rolle);

// Zuletzt erstellter Registrierungslink – der Link selbst ist nur jetzt sichtbar (gespeichert wird nur ein Hash)
let neuerLink = null;
const LINK_GUELTIG = { 1: '1 Tag', 3: '3 Tage', 7: '7 Tage', 14: '14 Tage', 30: '30 Tage' };

/** Registrierungslinks: verschicken, wer ihn hat, legt sein Konto selbst an (begrenzte Zeit und Anzahl) */
async function einladen(inhalt, { store, neuLaden, istDemo }) {
  const links = await store.registrierungslinks();
  const nutzbar = (l) => (l.max == null ? `${l.nutzungen} verwendet` : `${l.nutzungen} von ${l.max} verwendet`);
  inhalt.innerHTML = `
    ${neuerLink ? `<section class="karte zugangsdaten" role="status">
      <h2>Registrierungslink erstellt</h2>
      ${neuerLink.mail && !neuerLink.mail_fehler ? '<p class="erfolgbox">Die Einladung wurde per E-Mail verschickt.</p>' : ''}
      ${neuerLink.mail_fehler ? `<p class="fehlerbox"><strong>Die Einladung konnte nicht per E-Mail verschickt werden.</strong>
        Meldung des Mailservers: ${esc(neuerLink.mail_fehler)}. Bitte den Link selbst weitergeben.</p>` : ''}
      <p>Gilt ${esc(LINK_GUELTIG[neuerLink.tage])}, ${neuerLink.max == null ? 'beliebig oft' : neuerLink.max === 1 ? 'für eine Person' : `für ${neuerLink.max} Personen`}.
        <strong>Der Link wird nur jetzt angezeigt.</strong></p>
      <div class="kopierblock"><div class="kopierzeile"><span class="kopier-label">Link</span>
        <span class="kopier-wert klein">${esc(neuerLink.link)}</span>
        <button type="button" class="btn btn-klein" id="l-kopieren">Kopieren</button></div></div>
      <div class="aktionen"><button type="button" class="btn" id="l-ok">Ok</button></div>
    </section>` : ''}
    <form class="karte" id="l-form" novalidate>
      <h2>Registrierungslink erstellen</h2>
      <p class="tipp">Wer den Link bekommt, legt sein Konto selbst an, ohne dass du freischalten musst.
        Der Link läuft ab und gilt nur so oft, wie du hier einstellst.</p>
      <div class="zeile">
        <div class="feld"><label for="l-tage">Gültig</label>
          <select id="l-tage" name="tage">${Object.entries(LINK_GUELTIG).map(([t, l]) => `<option value="${t}" ${t === '7' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="feld"><label for="l-max">Wie oft</label>
          <select id="l-max" name="max"><option value="1">Für eine Person</option><option value="5">Für bis zu 5 Personen</option>
            <option value="20">Für bis zu 20 Personen</option><option value="">Beliebig oft (bis zum Ablauf)</option></select></div>
      </div>
      <p class="klein">Rollen der neuen Konten:</p>
      ${rollenAuswahl(['autor'], ['admin'])}
      <div class="zeile">
        <div class="feld"><label for="l-email">Gleich per E-Mail schicken an <span class="optional">(optional)</span></label>
          <input id="l-email" name="email" type="email" inputmode="email" placeholder="name@example.org"></div>
        <div class="feld"><label for="l-notiz">Notiz <span class="optional">(optional, nur für dich)</span></label>
          <input id="l-notiz" name="notiz" maxlength="200" placeholder="z. B. Neue Klasse 7B"></div>
      </div>
      ${istDemo ? '<p class="klein">In der Demo werden keine E-Mails verschickt. Den Link kannst du hier kopieren und im selben Browser öffnen.</p>' : ''}
      <p class="feldfehler" role="alert"></p>
      <button type="submit" class="btn btn-primaer">Link erstellen</button>
    </form>
    <section class="karte">
      <h2>Bisherige Links</h2>
      ${links.length ? `<table class="tabelle"><thead><tr><th>Erstellt</th><th>Notiz</th><th>Rollen</th><th>Nutzung</th><th>Gültig bis</th><th></th></tr></thead>
        <tbody>${links.map((l) => `<tr data-id="${esc(l.id)}">
          <td data-label="Erstellt"><span>${esc(formatZeitpunkt(l.erstellt_am))}<br><span class="klein">${esc(l.erstellt_von)}</span></span></td>
          <td data-label="Notiz">${esc(l.notiz || '–')}</td>
          <td data-label="Rollen">${esc(l.rollen.map((r) => ROLLEN_LABEL[r] ?? r).join(', '))}</td>
          <td data-label="Nutzung">${esc(nutzbar(l))}</td>
          <td data-label="Gültig bis"><span>${esc(formatZeitpunkt(l.gueltig_bis))}<br>${l.aktiv ? '<span class="badge badge-bezahlt">aktiv</span>'
            : `<span class="badge badge-abgelehnt">${l.widerrufen_am ? 'zurückgezogen' : 'abgelaufen'}</span>`}</span></td>
          <td data-label="">${l.aktiv ? '<button type="button" class="btn btn-klein btn-gefahr" data-widerrufen>Zurückziehen</button>' : ''}</td>
        </tr>`).join('')}</tbody></table>` : '<p class="klein">Noch keine Registrierungslinks.</p>'}
    </section>`;

  inhalt.querySelector('#l-kopieren')?.addEventListener('click', (ev) => kopierenMitFeedback(ev.currentTarget, neuerLink.link));
  inhalt.querySelector('#l-ok')?.addEventListener('click', () => { neuerLink = null; neuLaden(); });
  const form = inhalt.querySelector('#l-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    fehler.textContent = '';
    await mitSperre(form.querySelector('[type=submit]'), async () => {
      try {
        neuerLink = await store.registrierungslinkErstellen({
          tage: Number(form.tage.value), max: form.max.value === '' ? null : Number(form.max.value),
          rollen: gewaehlteRollen(form), email: form.email.value, notiz: form.notiz.value,
        });
        neuLaden();
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });
  inhalt.querySelector('tbody')?.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-widerrufen]')) return;
    const id = ev.target.closest('tr').dataset.id;
    if (!confirm('Diesen Link zurückziehen? Danach kann sich niemand mehr damit registrieren.')) return;
    versuche(() => store.registrierungslinkWiderrufen(id), 'Link zurückgezogen.', neuLaden);
  });
}

async function anfragen(inhalt, { store, neuLaden }) {
  const alle = await store.anfragen();
  const offen = alle.filter((a) => a.status === 'offen');
  const erledigt = alle.filter((a) => a.status !== 'offen').slice(0, 30);
  inhalt.innerHTML = `
    ${offen.length ? `<ul class="liste">${offen.map((a) => `
      <li class="karte anfrage" data-id="${esc(a.id)}">
        <div class="note-kopf"><h2>${esc(a.vorname)} ${esc(a.nachname)}</h2>
          <span class="klein">${esc(formatZeitpunkt(a.am))}</span></div>
        <p><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>
        ${a.nachricht ? `<p class="notiz zitat">${esc(a.nachricht)}</p>` : ''}
        <p class="klein">${a.zustimmung_am ? `✓ Datenschutzerklärung und Hinweis bestätigt am ${esc(formatZeitpunkt(a.zustimmung_am))}`
          : 'Ältere Anfrage: Datenschutzerklärung wird beim ersten Anmelden bestätigt.'}</p>
        <p class="klein">Rollen beim Freischalten:</p>
        ${rollenAuswahl()}
        <div class="aktionen">
          <button type="button" class="btn btn-erfolg" data-freischalten>Freischalten</button>
          <button type="button" class="btn btn-gefahr" data-ablehnen>Ablehnen</button>
        </div>
      </li>`).join('')}</ul>`
    : '<section class="karte"><p>Keine offenen Zugangsanfragen.</p></section>'}
    <p class="tipp">Beim Freischalten entsteht ein Startpasswort, das du weitergibst.</p>
    ${erledigt.length ? `<section class="karte">
      <h2>Bearbeitet</h2>
      <ul class="verlauf">${erledigt.map((a) => `<li>${esc(a.vorname)} ${esc(a.nachname)} · ${esc(a.email)} –
        <strong>${a.status === 'freigeschaltet' ? 'freigeschaltet' : 'abgelehnt'}</strong>
        ${a.bearbeitet_am ? `<span class="klein">am ${esc(formatZeitpunkt(a.bearbeitet_am))}${a.bearbeitet_von ? ` von ${esc(a.bearbeitet_von)}` : ''}</span>` : ''}</li>`).join('')}
      </ul></section>` : ''}`;

  inhalt.querySelector('.liste')?.addEventListener('click', async (ev) => {
    const karte = ev.target.closest('.anfrage');
    const knopf = ev.target.closest('button');
    if (!karte || !knopf) return;
    const a = offen.find((x) => x.id === karte.dataset.id);
    if ('freischalten' in knopf.dataset) {
      await mitSperre(knopf, async () => {
        try {
          zugangsdaten = await store.anfrageFreischalten(a.id, gewaehlteRollen(karte));
          meldung(`${a.vorname} ${a.nachname} ist freigeschaltet.`, 'erfolg');
          neuLaden();
        } catch (e) {
          meldung(fehlerText(e), 'fehler');
        }
      });
    } else if ('ablehnen' in knopf.dataset) {
      if (!confirm(`Anfrage von ${a.vorname} ${a.nachname} ablehnen?`)) return;
      versuche(() => store.anfrageAblehnen(a.id), 'Anfrage abgelehnt.', neuLaden);
    }
  });
}

/** Aktion ausführen, Meldung zeigen und neu laden (bei Fehlern nur, wenn immerNeuLaden) */
async function versuche(fn, erfolg, neuLaden, { immerNeuLaden = false } = {}) {
  try {
    const r = await fn();
    if (erfolg) meldung(erfolg, 'erfolg');
    neuLaden();
    return r;
  } catch (e) {
    meldung(fehlerText(e), 'fehler');
    if (immerNeuLaden) neuLaden(); // z. B. Checkbox wieder auf den gespeicherten Stand
    return undefined;
  }
}

async function benutzer(inhalt, { store, nutzer: ich, neuLaden }) {
  const liste = await store.nutzerListe();
  inhalt.innerHTML = `
    <details class="karte aufklapp" id="neu-anlegen">
      <summary>+ Person direkt anlegen</summary>
      <form id="anlegen-form" novalidate>
        <div class="zeile">
          <div class="feld"><label for="n-vorname">Vorname</label><input id="n-vorname" name="vorname" required></div>
          <div class="feld"><label for="n-nachname">Nachname</label><input id="n-nachname" name="nachname" required></div>
        </div>
        <label for="n-email">E-Mail-Adresse</label>
        <input id="n-email" name="email" type="email" inputmode="email" required>
        <p class="klein">Rollen:</p>
        ${rollenAuswahl()}
        <p class="feldfehler" role="alert"></p>
        <button type="submit" class="btn btn-primaer">Konto anlegen</button>
      </form>
    </details>
    <p class="treffer">${liste.length} Konten</p>
    <table class="tabelle">
      <thead><tr><th>Name</th><th>E-Mail</th><th>Rollen</th><th>Profil</th><th>Aktionen</th></tr></thead>
      <tbody>${liste.map((n) => `
        <tr data-id="${esc(n.id)}" class="${n.aktiv ? '' : 'inaktiv'}">
          <td data-label="Name"><span><strong>${esc(vollerName(n))}</strong>${n.id === ich.id ? ' <span class="klein">(du)</span>' : ''}
            ${n.aktiv ? '' : '<br><span class="badge badge-abgelehnt">deaktiviert</span>'}
            ${n.muss_passwort_aendern ? '<br><span class="klein">noch nicht angemeldet</span>' : ''}
            ${n.zwei_faktor ? '<br><span class="klein">🔒 Zwei-Faktor an</span>' : ''}</span></td>
          <td data-label="E-Mail">${esc(n.email)}</td>
          <td data-label="Rollen"><span class="rollen-wahl">${Object.entries(ROLLEN_LABEL).map(([r, l]) => `
            <label class="check"><input type="checkbox" data-rolle="${r}" ${n.rollen.includes(r) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
          </span></td>
          <td data-label="Profil">${n.rollen.includes('autor')
            ? (store.profilVollstaendig(n) ? '✓ vollständig' : '<span class="klein">unvollständig</span>') : '–'}</td>
          <td data-label="Aktionen"><span class="aktionen eng">
            <button type="button" class="btn btn-klein" data-aktion="email">E-Mail ändern</button>
            <button type="button" class="btn btn-klein" data-aktion="pw">Passwort zurücksetzen</button>
            ${n.zwei_faktor ? '<button type="button" class="btn btn-klein" data-aktion="zf">Zwei-Faktor zurücksetzen</button>' : ''}
            <button type="button" class="btn btn-klein" data-aktion="aktiv">${n.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
            <button type="button" class="btn btn-klein btn-gefahr" data-aktion="loeschen">Löschen</button>
          </span></td>
        </tr>`).join('')}</tbody>
    </table>
`;

  const anlegen = inhalt.querySelector('#anlegen-form');
  anlegen.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = anlegen.querySelector('.feldfehler');
    fehler.textContent = '';
    await mitSperre(anlegen.querySelector('[type=submit]'), async () => {
      try {
        zugangsdaten = await store.nutzerAnlegen({
          vorname: anlegen.vorname.value, nachname: anlegen.nachname.value,
          email: anlegen.email.value, rollen: gewaehlteRollen(anlegen),
        });
        meldung('Konto angelegt.', 'erfolg');
        neuLaden();
      } catch (e) {
        fehler.textContent = fehlerText(e);
      }
    });
  });

  const tabelle = inhalt.querySelector('tbody');
  tabelle.addEventListener('change', (ev) => {
    const cb = ev.target.closest('[data-rolle]');
    if (!cb) return;
    const tr = cb.closest('tr');
    const rollen = Array.from(tr.querySelectorAll('[data-rolle]:checked'), (x) => x.dataset.rolle);
    versuche(() => store.rollenSetzen(tr.dataset.id, rollen), 'Rollen gespeichert.', neuLaden, { immerNeuLaden: true });
  });
  tabelle.addEventListener('click', async (ev) => {
    const knopf = ev.target.closest('[data-aktion]');
    if (!knopf) return;
    const n = liste.find((x) => x.id === knopf.closest('tr').dataset.id);
    if (knopf.dataset.aktion === 'aktiv') {
      versuche(() => store.nutzerAktivSetzen(n.id, !n.aktiv), n.aktiv ? 'Konto deaktiviert.' : 'Konto aktiviert.', neuLaden);
    } else if (knopf.dataset.aktion === 'loeschen') {
      if (!confirm(`Konto von ${vollerName(n)} löschen?\n\nGespeicherte, nicht abgeschickte Leistungen werden mitgelöscht. `
        + 'Abgeschickte Prämienabrechnungen bleiben für die Buchhaltung erhalten.')) return;
      versuche(() => store.nutzerLoeschen(n.id), 'Konto gelöscht.', neuLaden);
    } else if (knopf.dataset.aktion === 'email') {
      const neu = await emailAbfragen(n);
      if (!neu) return;
      try {
        const r = await store.emailAendern(n.id, neu);
        meldung(`E-Mail von ${vollerName(n)} geändert${r.mail ? '. Alte und neue Adresse bekommen eine Info-Mail' : ''}.`, 'erfolg');
        neuLaden();
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    } else if (knopf.dataset.aktion === 'zf') {
      if (!confirm(`Zwei-Faktor-Anmeldung von ${vollerName(n)} ausschalten?\n\nNur, wenn die Person Handy und Ersatz-Codes verloren hat. `
        + 'Sie meldet sich danach nur mit dem Passwort an und kann Zwei-Faktor im Profil neu einrichten.')) return;
      versuche(() => store.zweiFaktorZuruecksetzen(n.id), 'Zwei-Faktor zurückgesetzt.', neuLaden);
    } else if (knopf.dataset.aktion === 'pw') {
      if (!confirm(`Passwort von ${vollerName(n)} zurücksetzen? Es wird ein neues Startpasswort erzeugt.`)) return;
      try {
        zugangsdaten = await store.passwortZuruecksetzen(n.id);
        neuLaden();
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    }
  });
}

/** Neue E-Mail-Adresse für ein Konto abfragen (null = abgebrochen) */
const emailAbfragen = (n) => bestaetigen({
  titel: `E-Mail von ${vollerName(n)} ändern`,
  html: `<p>Bisher: <strong>${esc(n.email)}</strong></p>
    <p class="klein">Angemeldet wird ab dann mit der neuen Adresse, das Passwort bleibt gleich. Alte und neue Adresse
      bekommen eine Info-Mail (wenn der E-Mail-Versand eingerichtet ist).</p>`,
  eingabe: { label: 'Neue E-Mail-Adresse', wert: n.email, typ: 'email' },
  ja: 'E-Mail ändern',
});

// Suche in Admin → Abrechnungen (bleibt beim Neuladen erhalten)
let notenSuche = '';

/** Alle Prämienabrechnungen (neueste zuerst, seitenweise) mit Löschen und Löschprotokoll */
async function noten(inhalt, { store, neuLaden }) {
  const filter = { status: '', suche: notenSuche, sortierung: 'eingereicht_desc', limit: 100 };
  const [daten, protokoll] = await Promise.all([store.redaktionListe(filter), store.loeschprotokoll()]);
  const liste = daten.noten;
  const zeilen = (noten) => noten.map((n) => `
        <tr data-id="${esc(n.id)}">
          <td data-label="Nummer"><a href="#/redaktion/${esc(n.id)}" class="nummer">${esc(n.nummer)}</a></td>
          <td data-label="Name">${esc(vollerName(n.autor))}</td>
          <td data-label="Abrechnung">${esc(formatMonat(n.monat))}</td>
          <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
          <td data-label="Status">${statusBadge(n.status)}</td>
          <td data-label=""><button type="button" class="btn btn-klein btn-gefahr" data-loeschen>Löschen</button></td>
        </tr>`).join('');
  inhalt.innerHTML = `
    <div class="protokoll-filter">
      <input id="n-suche" type="search" placeholder="Name oder Nummer suchen" value="${esc(notenSuche)}" aria-label="Suchen">
      <span class="klein">${daten.anzahl} ${daten.anzahl === 1 ? 'Abrechnung' : 'Abrechnungen'}, neueste zuerst</span>
    </div>
    ${liste.length ? `<table class="tabelle">
      <thead><tr><th>Nummer</th><th>Name</th><th>Abrechnung</th><th class="rechts">Betrag</th><th>Status</th><th></th></tr></thead>
      <tbody>${zeilen(liste)}</tbody></table>
      ${daten.anzahl > liste.length ? '<p><button type="button" class="btn" id="n-mehr">Weitere laden</button></p>' : ''}`
    : '<section class="karte"><p>Keine Prämienabrechnungen gefunden.</p></section>'}
    <p class="tipp">Löschen ist endgültig – bezahlte Prämienabrechnungen vorher sichern.</p>
    <section class="karte">
      <h2>Löschprotokoll</h2>
      ${protokoll.length ? `<ul class="verlauf">${protokoll.map((p) => `<li><strong class="nummer">${esc(p.nummer)}</strong>
        – gelöscht von ${esc(p.geloescht_von)} am ${esc(formatZeitpunkt(p.am))}</li>`).join('')}</ul>`
        : '<p class="klein">Noch nichts gelöscht.</p>'}
    </section>`;

  let warten;
  inhalt.querySelector('#n-suche').addEventListener('input', (ev) => {
    clearTimeout(warten);
    warten = setTimeout(async () => {
      notenSuche = ev.target.value;
      await neuLaden();
      const f = document.getElementById('n-suche');
      f?.focus();
      f?.setSelectionRange(f.value.length, f.value.length);
    }, 300);
  });
  inhalt.querySelector('#n-mehr')?.addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    const mehr = await store.redaktionListe({ ...filter, offset: liste.length });
    liste.push(...mehr.noten);
    inhalt.querySelector('tbody').insertAdjacentHTML('beforeend', zeilen(mehr.noten));
    if (liste.length >= daten.anzahl) ev.target.remove();
  }));
  inhalt.querySelector('tbody')?.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-loeschen]')) return;
    const n = liste.find((x) => x.id === ev.target.closest('tr').dataset.id);
    const eingabe = prompt(`Zum endgültigen Löschen bitte die Nummer ${n.nummer} eingeben:`);
    if (eingabe?.trim() !== n.nummer) return;
    versuche(() => store.noteLoeschen(n.id), `${n.nummer} wurde gelöscht.`, neuLaden);
  });
}

async function einstellungen(inhalt, { store, neuLaden }) {
  const [e, konto, w] = await Promise.all([store.einstellungen(), store.zahlungskonto(), store.wartung()]);
  const b = betreiberOder(e.betreiber);
  inhalt.innerHTML = `
    <form class="karte${w.an ? ' wartung-an' : ''}" id="w-form" novalidate>
      <h2>Wartungsmodus ${w.an ? '<span class="badge badge-abgelehnt">An</span>' : ''}</h2>
      <p class="tipp">${w.an ? `Eingeschaltet${w.seit ? ` am ${esc(formatZeitpunkt(w.seit))}` : ''}${w.von ? ` von ${esc(w.von)}` : ''}.
        Nur Admins können die App benutzen, alle anderen sehen diesen Text.`
        : 'Für Umbauten oder Updates: Solange er an ist, kommen nur Admins in die App. Alle anderen sehen diesen Text.'}</p>
      <label for="w-text">Text für alle anderen</label>
      <textarea id="w-text" name="text" rows="2" maxlength="500">${esc(w.text)}</textarea>
      <p class="feldfehler" role="alert"></p>
      <button type="submit" class="btn ${w.an ? 'btn-primaer' : 'btn-gefahr'}">${w.an ? 'Wartungsmodus ausschalten' : 'Wartungsmodus einschalten'}</button>
    </form>
    <form class="karte" id="k-form" novalidate>
      <h2>Zahlungskonto für die Sammelüberweisung</h2>
      <p class="tipp">Von diesem Konto gehen die Auszahlungen ab. Die Buchhaltung erstellt damit pro Woche eine
        SEPA-Datei (pain.001) zum Hochladen ins Online-Banking. Sehen können es nur Buchhaltung und Admin.</p>
      <label for="k-name">Kontoinhaber:in</label>
      <input id="k-name" name="name" maxlength="70" value="${esc(konto.name)}" placeholder="${esc(e.empfaenger.name)}">
      <div class="zeile">
        <div class="feld"><label for="k-iban">IBAN</label>
          <input id="k-iban" name="iban" autocomplete="off" spellcheck="false" value="${esc(formatIban(konto.iban))}" placeholder="AT.. .... .... .... ...."></div>
        <div class="feld"><label for="k-bic">BIC <span class="optional">(optional)</span></label>
          <input id="k-bic" name="bic" autocomplete="off" spellcheck="false" value="${esc(konto.bic)}"></div>
      </div>
      <p class="feldfehler" role="alert"></p>
      <button type="submit" class="btn btn-primaer">Zahlungskonto speichern</button>
    </form>
    <form class="karte" id="e-form" novalidate>
      <h2>Rechnungsempfänger</h2>
      <label for="e-name">Name</label><input id="e-name" name="name" value="${esc(e.empfaenger.name)}" required>
      <label for="e-strasse">Straße und Hausnummer</label><input id="e-strasse" name="strasse" value="${esc(e.empfaenger.strasse)}">
      <label for="e-plz">PLZ und Ort</label><input id="e-plz" name="plz_ort" value="${esc(e.empfaenger.plz_ort)}">
      <label for="e-uid">UID-Nummer</label><input id="e-uid" name="uid" value="${esc(e.empfaenger.uid)}">
      <h2 class="abstand-oben">Prämiensätze</h2>
      <p class="tipp">Wird als Betrag vorausgefüllt, getrennt für campus a college und campus a. Leer = kein Standardsatz.</p>
      ${MEDIUM_KEYS.map((m) => {
        const s = e.honorarsaetze?.[m] ?? {};
        const wert = (k) => (s[k] != null ? esc(formatBetragPlain(s[k])) : '');
        return `
      <h3>${esc(MEDIEN[m].name)}</h3>
      <div class="zeile">
        <div class="feld"><label for="e-satz-${m}-kolumne">Kolumne (EUR)</label>
          <input id="e-satz-${m}-kolumne" name="satz_${m}_kolumne" inputmode="decimal" autocomplete="off" value="${wert('kolumne')}"></div>
        <div class="feld"><label for="e-satz-${m}-ausser">Außerordentliche Anerkennungsprämie (EUR)</label>
          <input id="e-satz-${m}-ausser" name="satz_${m}_ausserordentlich" inputmode="decimal" autocomplete="off" placeholder="individuell"
                 value="${wert('ausserordentlich')}"></div>
        ${Object.hasOwn(s, 'redigieren') ? `
        <div class="feld"><label for="e-satz-${m}-redigieren">Redigieren pro Text (EUR)</label>
          <input id="e-satz-${m}-redigieren" name="satz_${m}_redigieren" inputmode="decimal" autocomplete="off" placeholder="2,00"
                 value="${wert('redigieren')}"></div>` : ''}
      </div>`;
      }).join('')}
      <h2 class="abstand-oben">Vorlagen für Rückgabegründe</h2>
      <p class="tipp">Die Redaktion übernimmt sie mit einem Klick beim Zurückgeben. Eine Vorlage pro Zeile, höchstens 15.</p>
      <label for="e-vorlagen" class="sr-only">Vorlagen</label>
      <textarea id="e-vorlagen" name="vorlagen" rows="6">${esc((e.rueckgabe_vorlagen ?? []).join('\n'))}</textarea>
      <h2 class="abstand-oben">Erinnerung zum Monatsende</h2>
      <p class="tipp">Wer Leistungen gespeichert, aber noch nicht eingereicht hat, bekommt einmal pro Monat eine E-Mail.
        Jede Person kann das im Profil abschalten.</p>
      <label for="e-erinnerung">Tage vor Monatsende (0 = keine Erinnerung)</label>
      <input id="e-erinnerung" name="erinnerung" type="number" min="0" max="31" step="1" inputmode="numeric" value="${esc(e.erinnerung_tage ?? 3)}">
      <h2 class="abstand-oben">Datenschutz</h2>
      <label for="e-kontakt">Kontakt für Datenschutzanfragen (E-Mail)</label>
      <input id="e-kontakt" name="kontakt" type="email" value="${esc(e.datenschutzKontakt)}">
      <h2 class="abstand-oben" id="betreiber">Betreiber der App (Impressum und Datenschutz)</h2>
      <p class="tipp">Daraus entstehen <a href="#/impressum" target="_blank">Impressum</a> und
        <a href="#/datenschutz" target="_blank">Datenschutzerklärung</a>. Die Texte sind eine Vorlage, keine
        Rechtsberatung – am besten einmal prüfen lassen.</p>
      <label for="e-b-name">Name (Person oder Verein, der die App betreibt)</label>
      <input id="e-b-name" name="b_name" maxlength="150" value="${esc(b.name)}">
      <label for="e-b-anschrift">Anschrift</label>
      <textarea id="e-b-anschrift" name="b_anschrift" rows="2" maxlength="300">${esc(b.anschrift)}</textarea>
      <div class="zeile">
        <div class="feld"><label for="e-b-email">E-Mail</label><input id="e-b-email" name="b_email" type="email" value="${esc(b.email)}"></div>
        <div class="feld"><label for="e-b-telefon">Telefon <span class="optional">(optional)</span></label>
          <input id="e-b-telefon" name="b_telefon" maxlength="50" value="${esc(b.telefon)}"></div>
      </div>
      <label class="check bestaetigen"><input type="checkbox" name="b_extern" ${b.extern ? 'checked' : ''}>
        Der Betreiber ist <strong>nicht</strong> bei der ${esc(e.empfaenger.name || 'campus a Medien GmbH')} angestellt – alle
        bekommen einen Hinweis, den sie zur Kenntnis nehmen müssen.</label>
      <label for="e-b-hoster">Hosting</label>
      <input id="e-b-hoster" name="b_hoster" maxlength="300" value="${esc(b.hoster)}" placeholder="${esc(STANDARD_HOSTER)}">
      <label for="e-b-zi">Zusätzlicher Text fürs Impressum <span class="optional">(optional)</span></label>
      <textarea id="e-b-zi" name="b_zusatz_impressum" rows="2" maxlength="5000">${esc(b.zusatz_impressum)}</textarea>
      <label for="e-b-zd">Zusätzlicher Text für die Datenschutzerklärung <span class="optional">(optional)</span></label>
      <textarea id="e-b-zd" name="b_zusatz_datenschutz" rows="2" maxlength="5000">${esc(b.zusatz_datenschutz)}</textarea>
      <p class="tipp">Ändern sich Name, Anschrift, Hosting oder „nicht angestellt“, müssen alle den Hinweis neu bestätigen.</p>
      <p class="feldfehler" role="alert"></p>
      <button type="submit" class="btn btn-primaer">Speichern</button>
    </form>`;
  const wForm = inhalt.querySelector('#w-form');
  wForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!w.an && !confirm('Wartungsmodus einschalten? Alle außer Admins kommen dann nicht mehr in die App.')) return;
    versuche(() => store.wartungSetzen(!w.an, wForm.text.value), w.an ? 'Wartungsmodus ausgeschaltet.' : 'Wartungsmodus eingeschaltet.',
      neuLaden);
  });

  const kForm = inhalt.querySelector('#k-form');
  kForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = kForm.querySelector('.feldfehler');
    fehler.textContent = '';
    await mitSperre(kForm.querySelector('[type=submit]'), async () => {
      try {
        await store.zahlungskontoSpeichern({ name: kForm.name.value, iban: kForm.iban.value, bic: kForm.bic.value });
        meldung('Zahlungskonto gespeichert.', 'erfolg');
        neuLaden();
      } catch (err) {
        fehler.textContent = fehlerText(err);
      }
    });
  });

  const form = inhalt.querySelector('#e-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    // leeres Feld = kein Standardsatz; sonst Betrag wie 15 oder 15,50
    const satz = (feld) => {
      const roh = feld.value.trim();
      if (!roh) return null;
      const b = parseBetrag(roh);
      if (!b) throw new Error(`Ungültiger Prämiensatz: „${roh}“ (z. B. 15 oder 15,50)`);
      return b;
    };
    let honorarsaetze;
    try {
      honorarsaetze = Object.fromEntries(MEDIUM_KEYS.map((m) => [m, {
        kolumne: satz(form.elements[`satz_${m}_kolumne`]),
        ausserordentlich: satz(form.elements[`satz_${m}_ausserordentlich`]),
        // Redigieren gibt es nur bei campus a college; leer = Standard (2 € pro Text)
        ...(form.elements[`satz_${m}_redigieren`] ? { redigieren: satz(form.elements[`satz_${m}_redigieren`]) } : {}),
      }]));
      fehler.textContent = '';
    } catch (e) {
      fehler.textContent = e.message;
      return;
    }
    versuche(() => store.einstellungenSpeichern({
      empfaenger: { name: form.name.value, strasse: form.strasse.value, plz_ort: form.plz_ort.value, uid: form.uid.value },
      datenschutzKontakt: form.kontakt.value,
      honorarsaetze,
      rueckgabe_vorlagen: form.vorlagen.value.split('\n'),
      erinnerung_tage: Number(form.erinnerung.value || 0),
      betreiber: {
        name: form.b_name.value, anschrift: form.b_anschrift.value, email: form.b_email.value, telefon: form.b_telefon.value,
        extern: form.b_extern.checked, hoster: form.b_hoster.value,
        zusatz_impressum: form.b_zusatz_impressum.value, zusatz_datenschutz: form.b_zusatz_datenschutz.value,
      },
    }), 'Einstellungen gespeichert.', neuLaden);
  });
}

/** E-Mail-Versand (SMTP, z. B. World4You): wer bekommt welche Benachrichtigung, Test-E-Mail */
async function mail(inhalt, { store, nutzer: ich, neuLaden, istDemo }) {
  const e = await store.mailEinstellungen();
  const w = e.warteschlange ?? {};
  const feld = (name, label, { typ = 'text', tipp = '', wert = e[name] ?? '', platzhalter = '' } = {}) => `
      <label for="m-${name}">${esc(label)}</label>
      <input id="m-${name}" name="${name}" type="${typ}" autocomplete="off" value="${esc(wert)}"${platzhalter ? ` placeholder="${esc(platzhalter)}"` : ''}>
      ${tipp ? `<p class="tipp">${esc(tipp)}</p>` : ''}`;
  inhalt.innerHTML = `
    ${istDemo ? '<p class="hinweisbox">In der Demo werden keine E-Mails verschickt. Auf dem eigenen Server (z. B. World4You) gehen die Benachrichtigungen automatisch hinaus.</p>' : ''}
    <div class="spalten">
      <form class="karte" id="m-form" novalidate>
        <h2>E-Mail-Benachrichtigungen</h2>
        <label class="check"><input type="checkbox" name="aktiv" ${e.aktiv ? 'checked' : ''}> E-Mails automatisch verschicken</label>
        <h3>Wer bekommt was?</h3>
        <p class="tipp">Benachrichtigungen gehen an die <strong>Konten selbst</strong>: neue Prämienabrechnungen an alle mit der
          Rolle Redaktion, angenommene an die Buchhaltung, Zugangsanfragen an Admins, Bestätigungen an die Autor:innen.
          Jede:r kann im <a href="#/profil">Profil</a> auswählen, welche E-Mails sie bekommen will.</p>
        <label class="check"><input type="checkbox" name="zugangsdaten" ${e.zugangsdaten ? 'checked' : ''}> Startpasswörter neuer Konten automatisch per E-Mail schicken</label>
        <h3 class="abstand-oben">Absender (SMTP)</h3>
        <p class="tipp">Bei World4You: Server <strong>smtp.world4you.com</strong>, Port <strong>587</strong>, als Benutzer die
          E-Mail-Adresse des Postfachs und dessen Passwort.</p>
        ${feld('absender', 'Absender-Adresse', { typ: 'email', platzhalter: 'office@deine-domain.at' })}
        ${feld('absender_name', 'Absendername')}
        ${feld('antwort_an', 'Antworten gehen an (optional)', { typ: 'email', tipp: 'Wer auf eine automatische E-Mail antwortet, schreibt an diese Adresse, z. B. deine zweite Adresse. Leer = an die Absender-Adresse.' })}
        <div class="zeile">
          <div class="feld">${feld('host', 'SMTP-Server')}</div>
          <div class="feld">${feld('port', 'Port', { wert: String(e.port ?? 587) })}</div>
        </div>
        <label for="m-verschluesselung">Verschlüsselung</label>
        <select id="m-verschluesselung" name="verschluesselung">
          ${[['starttls', 'STARTTLS (Port 587)'], ['ssl', 'SSL/TLS (Port 465)'], ['keine', 'keine (nicht empfohlen)']]
            .map(([v, l]) => `<option value="${v}"${e.verschluesselung === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        ${feld('benutzer', 'Benutzername', { tipp: 'Meist die Absender-Adresse.' })}
        ${feld('passwort', 'Passwort des Postfachs', { typ: 'password', wert: '', platzhalter: e.passwort_gesetzt ? '•••••••• (gespeichert – leer lassen = unverändert)' : '' })}
        ${feld('adresse', 'Adresse der App (für Links in den E-Mails)', { platzhalter: e.adresse_vorschlag ?? 'https://deine-domain.at/' })}
        <p class="feldfehler" role="alert"></p>
        <button type="submit" class="btn btn-primaer">Speichern</button>
      </form>
      <section class="karte">
        <h2>Testen</h2>
        <p>Schickt sofort eine Test-E-Mail mit den gespeicherten Einstellungen.</p>
        <label for="m-test">An</label>
        <input id="m-test" type="email" value="${esc(ich.email)}">
        <button type="button" class="btn abstand-oben" id="m-test-knopf">Test-E-Mail senden</button>
        ${istDemo ? '' : `
        <h3 class="abstand-oben">Versand</h3>
        <p>${w.gesendet ?? 0} verschickt · ${w.offen ?? 0} warten${w.fehlgeschlagen ? ` · <strong>${w.fehlgeschlagen} fehlgeschlagen</strong>` : ''}</p>
        ${w.letzter_fehler ? `<p class="fehlerbox">Letzter Fehler: ${esc(w.letzter_fehler)}</p>` : ''}`}
      </section>
    </div>`;
  const form = inhalt.querySelector('#m-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const daten = Object.fromEntries(['absender', 'absender_name', 'antwort_an', 'host', 'port', 'verschluesselung',
      'benutzer', 'passwort', 'adresse'].map((k) => [k, form.elements[k].value]));
    daten.aktiv = form.elements.aktiv.checked;
    daten.zugangsdaten = form.elements.zugangsdaten.checked;
    if (!daten.benutzer) daten.benutzer = daten.absender;
    mitSperre(form.querySelector('button[type=submit]'), () => versuche(() => store.mailEinstellungenSpeichern(daten), 'E-Mail-Einstellungen gespeichert.', neuLaden));
  });
  inhalt.querySelector('#m-test-knopf').addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    try {
      const r = await store.testMail(inhalt.querySelector('#m-test').value);
      meldung(`Test-E-Mail an ${r.an} verschickt.`, 'erfolg');
    } catch (f) {
      meldung(fehlerText(f), 'fehler');
    }
  }));
}

async function daten(inhalt, { store, demoDaten, neuLaden, istDemo }) {
  const sich = istDemo ? null : await store.sicherungen();
  inhalt.innerHTML = istDemo ? `
    <div class="spalten">
      <section class="karte">
        <h2>Sicherung</h2>
        <p><strong>Enthält IBANs und Adressen – vertraulich aufbewahren.</strong></p>
        <div class="aktionen">
          <button type="button" class="btn btn-primaer" id="d-export">Sicherung herunterladen</button>
          <label class="btn" for="d-import">Sicherung einspielen …</label>
          <input type="file" id="d-import" accept="application/json,.json" class="offscreen">
        </div>
      </section>
      <section class="karte gefahrenzone">
        <h2>Demo zurücksetzen</h2>
        <p>Lädt die Beispieldaten neu.</p>
        <button type="button" class="btn btn-gefahr" id="d-reset">Alles zurücksetzen</button>
      </section>
    </div>` : `
    <section class="karte">
      <div class="kopfzeile"><h2>Sicherungen</h2><button type="button" class="btn btn-primaer" id="d-sichern">Jetzt sichern</button></div>
      <p class="tipp">Der Server sichert jeden Tag automatisch die ganze Datenbank und hebt die Sicherungen
        ${esc(String(sich.tage))} Tage auf. Zusätzlich empfehlen wir das Backup von World4You (Kundenmenü → Backups).
        Sicherungen enthalten IBANs und Adressen: vertraulich aufbewahren.</p>
      ${sich.liste.length ? `<table class="tabelle"><thead><tr><th>Datei</th><th>Erstellt</th><th class="rechts">Größe</th><th></th></tr></thead>
        <tbody>${sich.liste.map((b) => `<tr data-name="${esc(b.name)}">
          <td data-label="Datei" class="mono umbruch">${esc(b.name)}</td>
          <td data-label="Erstellt">${esc(formatZeitpunkt(b.zeit))}</td>
          <td data-label="Größe" class="rechts">${esc(groesse(b.groesse))}</td>
          <td data-label=""><button type="button" class="btn btn-klein" data-laden>Herunterladen</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="klein">Noch keine Sicherung vorhanden. Die erste entsteht beim nächsten Aufruf der App oder mit „Jetzt sichern“.</p>'}
    </section>
    <section class="karte">
      <h2>Datenexport</h2>
      <p>Alle Daten als JSON-Datei, z. B. zum Auswerten. <strong>Enthält IBANs und Adressen, vertraulich aufbewahren.</strong></p>
      <button type="button" class="btn" id="d-export">Datenexport herunterladen</button>
    </section>`;

  inhalt.querySelector('#d-sichern')?.addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    try {
      const b = await store.jetztSichern();
      meldung(`Sicherung erstellt: ${b.name}`, 'erfolg');
      neuLaden();
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    }
  }));
  inhalt.querySelector('tbody')?.addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-laden]');
    if (!k) return;
    mitSperre(k, async () => {
      try {
        const r = await store.sicherungHerunterladen(k.closest('tr').dataset.name);
        const bytes = Uint8Array.from(atob(r.inhalt), (c) => c.charCodeAt(0));
        downloadBlob(r.name, new Blob([bytes], { type: 'application/octet-stream' }));
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    });
  });

  inhalt.querySelector('#d-export').addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    try {
      const name = istDemo ? 'sicherung' : 'datenexport';
      downloadText(`anerkennungspraemien-${name}-${new Date().toISOString().slice(0, 10)}.json`, await store.exportieren(), 'application/json');
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    }
  }));
  if (!istDemo) return;
  inhalt.querySelector('#d-import').addEventListener('change', async (ev) => {
    const datei = ev.target.files[0];
    if (!datei) return;
    ev.target.value = '';
    if (!confirm('Alle aktuellen Daten in diesem Browser werden durch die Sicherung ersetzt. Fortfahren?')) return;
    try {
      store.importieren(await datei.text());
      meldung('Sicherung eingespielt.', 'erfolg');
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    }
    neuLaden();
  });
  inhalt.querySelector('#d-reset').addEventListener('click', async () => {
    if (!confirm('Wirklich ALLE Daten in diesem Browser löschen und die Demo neu laden?')) return;
    await store.zuruecksetzen({ demoDaten });
    location.hash = '';
    neuLaden();
  });
}

export async function render(el, ctx) {
  const s = await ctx.store.statistik();
  if (!ctx.istAktuell()) return;
  const tab = REITER[ctx.params.tab] || ctx.params.tab === 'server' ? ctx.params.tab : 'uebersicht';
  el.innerHTML = `
    <div class="kopfzeile"><h1>Admin${tab === 'server' ? ' <span class="h1-zusatz">Server</span>' : ''}</h1>
      ${tab === 'server' ? '<a href="#/admin/uebersicht" class="btn btn-klein">← Zurück zum Admin</a>'
        : '<a href="#/admin/server" class="btn btn-klein" title="Zustand und Leistung des Servers">🖥 Kommandozentrale</a>'}</div>
    ${tab === 'server' ? '' : `<nav class="reiter" aria-label="Bereiche">
      ${Object.entries(REITER).map(([k, l]) => `<a href="#/admin/${k}"${k === tab ? ' aria-current="page"' : ''}>${esc(l)}${
        k === 'anfragen' && s.anfragen ? ` <span class="zaehler zaehler-wichtig">${s.anfragen}</span>` : ''}</a>`).join('')}
    </nav>`}
    <div id="a-zugang">${zugangsdaten ? zugangsdatenHtml(zugangsdaten) : ''}</div>
    <div id="a-inhalt"></div>`;
  zugangsdatenBinden(el.querySelector('#a-zugang'), ctx.neuLaden);
  const inhalt = el.querySelector('#a-inhalt');
  await ({ uebersicht, anfragen, einladen, benutzer, noten, protokoll, einstellungen, mail, daten, server: kommandozentrale.render })[tab](inhalt, ctx);
}
