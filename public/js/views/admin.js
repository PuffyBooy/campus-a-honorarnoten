// Admin-Terminal: Benutzer & Rollen, Honorarnoten löschen, Einstellungen, Datensicherung
import {
  ROLLEN_LABEL, STATUS_LABEL, esc, formatBetragPlain, formatEuro, formatMonat, formatZeitpunkt, parseBetrag, vollerName,
} from '../lib/format.js';
import { downloadText } from '../lib/csv.js';
import { fehlerText, kopierenMitFeedback, meldung, mitSperre, statusBadge } from '../lib/ui.js';

const REITER = {
  anfragen: 'Anfragen', benutzer: 'Benutzer', noten: 'Honorarnoten', einstellungen: 'Einstellungen', daten: 'Daten',
};

// Zuletzt erzeugte Zugangsdaten – bleiben sichtbar, bis der Admin sie wegklickt
let zugangsdaten = null;

function zugangsText(z) {
  const adresse = location.origin + location.pathname;
  return `Hallo ${z.vorname},\n\ndein Zugang zu den Honorarnoten von campus a college ist bereit.\n\n`
    + `Adresse: ${adresse}\nE-Mail: ${z.email}\nStartpasswort: ${z.passwort}\n\n`
    + 'Beim ersten Anmelden legst du dein eigenes Passwort fest.\n\nLiebe Grüße\ndeine Redaktion';
}

function zugangsdatenHtml(z) {
  const mailto = `mailto:${encodeURIComponent(z.email)}?subject=${encodeURIComponent('Dein Zugang zu den Honorarnoten')}`
    + `&body=${encodeURIComponent(zugangsText(z))}`;
  return `
    <section class="karte zugangsdaten" role="status">
      <h2>Zugangsdaten für ${esc(z.vorname)}</h2>
      <p>Das Startpasswort wird nur jetzt angezeigt.</p>
      <div class="kopierblock">
        <div class="kopierzeile"><span class="kopier-label">E-Mail</span><span class="kopier-wert">${esc(z.email)}</span><span></span></div>
        <div class="kopierzeile"><span class="kopier-label">Startpasswort</span>
          <span class="kopier-wert mono">${esc(z.passwort)}</span>
          <button type="button" class="btn btn-klein" data-z="pw">Kopieren</button></div>
      </div>
      <div class="aktionen">
        <a class="btn btn-primaer" href="${esc(mailto)}">E-Mail vorbereiten</a>
        <button type="button" class="btn" data-z="text">Text kopieren</button>
        <button type="button" class="btn" data-z="fertig">Erledigt</button>
      </div>
    </section>`;
}

function zugangsdatenBinden(box, neuLaden) {
  box.querySelector('.zugangsdaten')?.addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-z]');
    if (!k || !zugangsdaten) return;
    if (k.dataset.z === 'pw') kopierenMitFeedback(k, zugangsdaten.passwort);
    if (k.dataset.z === 'text') kopierenMitFeedback(k, zugangsText(zugangsdaten));
    if (k.dataset.z === 'fertig') { zugangsdaten = null; neuLaden(); }
  });
}

function rollenAuswahl(vorauswahl = ['autor']) {
  return `<span class="rollen-wahl">${Object.entries(ROLLEN_LABEL).map(([r, l]) => `
    <label class="check"><input type="checkbox" data-rolle="${r}" ${vorauswahl.includes(r) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</span>`;
}

const gewaehlteRollen = (el) => Array.from(el.querySelectorAll('[data-rolle]:checked'), (x) => x.dataset.rolle);

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
            ${n.muss_passwort_aendern ? '<br><span class="klein">noch nicht angemeldet</span>' : ''}</span></td>
          <td data-label="E-Mail">${esc(n.email)}</td>
          <td data-label="Rollen"><span class="rollen-wahl">${Object.entries(ROLLEN_LABEL).map(([r, l]) => `
            <label class="check"><input type="checkbox" data-rolle="${r}" ${n.rollen.includes(r) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
          </span></td>
          <td data-label="Profil">${n.rollen.includes('autor')
            ? (store.profilVollstaendig(n) ? '✓ vollständig' : '<span class="klein">unvollständig</span>') : '–'}</td>
          <td data-label="Aktionen"><span class="aktionen eng">
            <button type="button" class="btn btn-klein" data-aktion="pw">Passwort zurücksetzen</button>
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
        + 'Abgeschickte Honorarnoten bleiben für die Buchhaltung erhalten.')) return;
      versuche(() => store.nutzerLoeschen(n.id), 'Konto gelöscht.', neuLaden);
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

async function noten(inhalt, { store, neuLaden }) {
  const [liste, protokoll] = await Promise.all([store.alleNotenAdmin(), store.loeschprotokoll()]);
  inhalt.innerHTML = `
    ${liste.length ? `<table class="tabelle">
      <thead><tr><th>Nummer</th><th>Name</th><th>Abrechnung</th><th class="rechts">Betrag</th><th>Status</th><th></th></tr></thead>
      <tbody>${liste.map((n) => `
        <tr data-id="${esc(n.id)}">
          <td data-label="Nummer"><a href="#/redaktion/${esc(n.id)}" class="nummer">${esc(n.nummer)}</a></td>
          <td data-label="Name">${esc(vollerName(n.autor))}</td>
          <td data-label="Abrechnung">${esc(formatMonat(n.monat))}</td>
          <td data-label="Betrag" class="rechts">${esc(formatEuro(n.betrag))}</td>
          <td data-label="Status">${statusBadge(n.status)}</td>
          <td data-label=""><button type="button" class="btn btn-klein btn-gefahr" data-loeschen>Löschen</button></td>
        </tr>`).join('')}</tbody></table>` : '<section class="karte"><p>Keine Honorarnoten vorhanden.</p></section>'}
    <p class="tipp">Löschen ist endgültig – bezahlte Honorarnoten vorher sichern.</p>
    <section class="karte">
      <h2>Löschprotokoll</h2>
      ${protokoll.length ? `<ul class="verlauf">${protokoll.map((p) => `<li><strong class="nummer">${esc(p.nummer)}</strong>
        – gelöscht von ${esc(p.geloescht_von)} am ${esc(formatZeitpunkt(p.am))}</li>`).join('')}</ul>`
        : '<p class="klein">Noch nichts gelöscht.</p>'}
    </section>`;

  inhalt.querySelector('tbody')?.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-loeschen]')) return;
    const n = liste.find((x) => x.id === ev.target.closest('tr').dataset.id);
    const eingabe = prompt(`Zum endgültigen Löschen bitte die Nummer ${n.nummer} eingeben:`);
    if (eingabe?.trim() !== n.nummer) return;
    versuche(() => store.noteLoeschen(n.id), `${n.nummer} wurde gelöscht.`, neuLaden);
  });
}

async function einstellungen(inhalt, { store, neuLaden }) {
  const e = await store.einstellungen();
  inhalt.innerHTML = `
    <form class="karte" id="e-form" novalidate>
      <h2>Rechnungsempfänger</h2>
      <label for="e-name">Name</label><input id="e-name" name="name" value="${esc(e.empfaenger.name)}" required>
      <label for="e-strasse">Straße und Hausnummer</label><input id="e-strasse" name="strasse" value="${esc(e.empfaenger.strasse)}">
      <label for="e-plz">PLZ und Ort</label><input id="e-plz" name="plz_ort" value="${esc(e.empfaenger.plz_ort)}">
      <label for="e-uid">UID-Nummer</label><input id="e-uid" name="uid" value="${esc(e.empfaenger.uid)}">
      <h2 class="abstand-oben">Honorarsätze</h2>
      <p class="tipp">Wird als Betrag vorausgefüllt. Leer = kein Standardsatz.</p>
      <div class="zeile">
        <div class="feld"><label for="e-satz-kolumne">Kolumne (EUR)</label>
          <input id="e-satz-kolumne" name="satz_kolumne" inputmode="decimal" autocomplete="off"
                 value="${e.honorarsaetze?.kolumne != null ? esc(formatBetragPlain(e.honorarsaetze.kolumne)) : ''}"></div>
        <div class="feld"><label for="e-satz-ausser">Außerordentliches Honorar (EUR)</label>
          <input id="e-satz-ausser" name="satz_ausserordentlich" inputmode="decimal" autocomplete="off" placeholder="individuell"
                 value="${e.honorarsaetze?.ausserordentlich != null ? esc(formatBetragPlain(e.honorarsaetze.ausserordentlich)) : ''}"></div>
      </div>
      <h2 class="abstand-oben">Datenschutz</h2>
      <label for="e-kontakt">Kontakt für Datenschutzanfragen (E-Mail)</label>
      <input id="e-kontakt" name="kontakt" type="email" value="${esc(e.datenschutzKontakt)}">
      <p class="feldfehler" role="alert"></p>
      <button type="submit" class="btn btn-primaer">Speichern</button>
    </form>`;
  const form = inhalt.querySelector('#e-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector('.feldfehler');
    // leeres Feld = kein Standardsatz; sonst Betrag wie 15 oder 15,50
    const satz = (feld) => {
      const roh = feld.value.trim();
      if (!roh) return null;
      const b = parseBetrag(roh);
      if (!b) throw new Error(`Ungültiger Honorarsatz: „${roh}“ (z. B. 15 oder 15,50)`);
      return b;
    };
    let honorarsaetze;
    try {
      honorarsaetze = { kolumne: satz(form.satz_kolumne), ausserordentlich: satz(form.satz_ausserordentlich) };
      fehler.textContent = '';
    } catch (e) {
      fehler.textContent = e.message;
      return;
    }
    versuche(() => store.einstellungenSpeichern({
      empfaenger: { name: form.name.value, strasse: form.strasse.value, plz_ort: form.plz_ort.value, uid: form.uid.value },
      datenschutzKontakt: form.kontakt.value,
      honorarsaetze,
    }), 'Einstellungen gespeichert.', neuLaden);
  });
}

function daten(inhalt, { store, demoDaten, neuLaden, istDemo }) {
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
      <h2>Datenexport</h2>
      <p><strong>Enthält IBANs und Adressen – vertraulich aufbewahren.</strong></p>
      <button type="button" class="btn btn-primaer" id="d-export">Datenexport herunterladen</button>
    </section>`;

  inhalt.querySelector('#d-export').addEventListener('click', (ev) => mitSperre(ev.currentTarget, async () => {
    try {
      const name = istDemo ? 'sicherung' : 'datenexport';
      downloadText(`honorarnoten-${name}-${new Date().toISOString().slice(0, 10)}.json`, await store.exportieren(), 'application/json');
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
  const tab = REITER[ctx.params.tab] ? ctx.params.tab : (s.anfragen ? 'anfragen' : 'benutzer');
  el.innerHTML = `
    <h1>Admin-Terminal</h1>
    <section class="kennzahlen" aria-label="Überblick">
      <div class="kennzahl${s.anfragen ? ' hervorgehoben' : ''}"><span class="zahl">${s.anfragen}</span><span>offene Anfragen</span></div>
      <div class="kennzahl"><span class="zahl">${s.nutzer}</span><span>Konten</span></div>
      <div class="kennzahl"><span class="zahl">${s.entwuerfe}</span><span>gespeicherte Leistungen</span></div>
      ${['eingereicht', 'angenommen', 'bezahlt'].map((st) => `
        <div class="kennzahl"><span class="zahl">${s[st]}</span><span>${esc(STATUS_LABEL[st])}</span></div>`).join('')}
    </section>
    <nav class="reiter" aria-label="Bereiche">
      ${Object.entries(REITER).map(([k, l]) => `<a href="#/admin/${k}"${k === tab ? ' aria-current="page"' : ''}>${esc(l)}${
        k === 'anfragen' && s.anfragen ? ` <span class="zaehler">${s.anfragen}</span>` : ''}</a>`).join('')}
    </nav>
    <div id="a-zugang">${zugangsdaten ? zugangsdatenHtml(zugangsdaten) : ''}</div>
    <div id="a-inhalt"></div>`;
  zugangsdatenBinden(el.querySelector('#a-zugang'), ctx.neuLaden);
  const inhalt = el.querySelector('#a-inhalt');
  await ({ anfragen, benutzer, noten, einstellungen, daten })[tab](inhalt, ctx);
}
