// Admin-Terminal: Benutzer & Rollen, Honorarnoten löschen, Einstellungen, Datensicherung
import {
  ROLLEN_LABEL, STATUS_LABEL, esc, formatEuro, formatMonat, formatZeitpunkt, vollerName,
} from '../lib/format.js';
import { downloadText } from '../lib/csv.js';
import { fehlerText, meldung, statusBadge } from '../lib/ui.js';

const REITER = { benutzer: 'Benutzer', noten: 'Honorarnoten', einstellungen: 'Einstellungen', daten: 'Daten' };

function versuche(fn, erfolg, neuLaden) {
  try {
    const r = fn();
    if (erfolg) meldung(erfolg, 'erfolg');
    neuLaden();
    return r;
  } catch (e) {
    meldung(fehlerText(e), 'fehler');
    return undefined;
  }
}

function benutzer(inhalt, { store, nutzer: ich, neuLaden }) {
  const liste = store.nutzerListe();
  inhalt.innerHTML = `
    <p class="treffer">${liste.length} Konten</p>
    <table class="tabelle">
      <thead><tr><th>Name</th><th>E-Mail</th><th>Rollen</th><th>Profil</th><th>Aktionen</th></tr></thead>
      <tbody>${liste.map((n) => `
        <tr data-id="${esc(n.id)}" class="${n.aktiv ? '' : 'inaktiv'}">
          <td data-label="Name"><span><strong>${esc(vollerName(n))}</strong>${n.id === ich.id ? ' <span class="klein">(du)</span>' : ''}
            ${n.aktiv ? '' : '<br><span class="badge badge-abgelehnt">deaktiviert</span>'}</span></td>
          <td data-label="E-Mail">${esc(n.email)}</td>
          <td data-label="Rollen"><span class="rollen-wahl">${Object.entries(ROLLEN_LABEL).map(([r, l]) => `
            <label class="check"><input type="checkbox" data-rolle="${r}" ${n.rollen.includes(r) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
          </span></td>
          <td data-label="Profil">${n.rollen.includes('autor')
            ? (store.profilVollstaendig(n) ? '✓ vollständig' : '<span class="klein">unvollständig</span>') : '–'}</td>
          <td data-label="Aktionen"><span class="aktionen eng">
            <button type="button" class="btn btn-klein" data-aktion="pw">Passwort setzen</button>
            <button type="button" class="btn btn-klein" data-aktion="aktiv">${n.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
            <button type="button" class="btn btn-klein btn-gefahr" data-aktion="loeschen">Löschen</button>
          </span></td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="hinweis">Neue Personen legen sich selbst ein Konto an und bekommen automatisch die Rolle Autor:in.
      Redaktion, Buchhaltung und Admin vergibst du hier.</p>`;

  const tabelle = inhalt.querySelector('tbody');
  tabelle.addEventListener('change', (ev) => {
    const cb = ev.target.closest('[data-rolle]');
    if (!cb) return;
    const tr = cb.closest('tr');
    const rollen = Array.from(tr.querySelectorAll('[data-rolle]:checked'), (x) => x.dataset.rolle);
    versuche(() => store.rollenSetzen(tr.dataset.id, rollen), 'Rollen gespeichert.', neuLaden);
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
      const pw = prompt(`Neues Passwort für ${vollerName(n)} (mind. 8 Zeichen):`);
      if (!pw) return;
      try {
        await store.passwortZuruecksetzen(n.id, pw);
        meldung('Passwort gesetzt. Bitte der Person sicher mitteilen.', 'erfolg');
      } catch (e) {
        meldung(fehlerText(e), 'fehler');
      }
    }
  });
}

function noten(inhalt, { store, neuLaden }) {
  const liste = store.alleNotenAdmin();
  const protokoll = store.loeschprotokoll();
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
    <p class="hinweis">Löschen entfernt die Honorarnote samt Bankdaten, Kommentaren und Verlauf endgültig (Datenschutz).
      Bezahlte Honorarnoten sind Buchhaltungsbelege – vorher sichern!</p>
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

function einstellungen(inhalt, { store, neuLaden }) {
  const e = store.einstellungen();
  inhalt.innerHTML = `
    <form class="karte" id="e-form" novalidate>
      <h2>Rechnungsempfänger</h2>
      <p class="hinweis">Steht auf jeder neuen Honorarnote. Bereits abgeschickte Honorarnoten behalten ihre Angaben.</p>
      <label for="e-name">Name</label><input id="e-name" name="name" value="${esc(e.empfaenger.name)}" required>
      <label for="e-strasse">Straße und Hausnummer</label><input id="e-strasse" name="strasse" value="${esc(e.empfaenger.strasse)}">
      <label for="e-plz">PLZ und Ort</label><input id="e-plz" name="plz_ort" value="${esc(e.empfaenger.plz_ort)}">
      <label for="e-uid">UID-Nummer</label><input id="e-uid" name="uid" value="${esc(e.empfaenger.uid)}">
      <h2 class="abstand-oben">Datenschutz</h2>
      <label for="e-kontakt">Kontakt für Datenschutzanfragen (E-Mail)</label>
      <input id="e-kontakt" name="kontakt" type="email" value="${esc(e.datenschutzKontakt)}">
      <p class="feldfehler" role="alert"></p>
      <button type="submit" class="btn btn-primaer">Speichern</button>
    </form>`;
  const form = inhalt.querySelector('#e-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    versuche(() => store.einstellungenSpeichern({
      empfaenger: { name: form.name.value, strasse: form.strasse.value, plz_ort: form.plz_ort.value, uid: form.uid.value },
      datenschutzKontakt: form.kontakt.value,
    }), 'Einstellungen gespeichert.', neuLaden);
  });
}

function daten(inhalt, { store, demoDaten, neuLaden }) {
  inhalt.innerHTML = `
    <div class="spalten">
      <section class="karte">
        <h2>Sicherung</h2>
        <p>Alle Daten liegen nur in diesem Browser. Lade regelmäßig eine Sicherung herunter.
          <strong>Die Datei enthält IBANs und Adressen – vertraulich aufbewahren!</strong></p>
        <div class="aktionen">
          <button type="button" class="btn btn-primaer" id="d-export">Sicherung herunterladen</button>
          <label class="btn" for="d-import">Sicherung einspielen …</label>
          <input type="file" id="d-import" accept="application/json,.json" class="offscreen">
        </div>
      </section>
      <section class="karte gefahrenzone">
        <h2>Demo zurücksetzen</h2>
        <p>Löscht alle Daten in diesem Browser und lädt die Beispieldaten neu. Danach bist du abgemeldet.</p>
        <button type="button" class="btn btn-gefahr" id="d-reset">Alles zurücksetzen</button>
      </section>
    </div>`;

  inhalt.querySelector('#d-export').addEventListener('click', () => {
    try {
      downloadText(`honorarnoten-sicherung-${new Date().toISOString().slice(0, 10)}.json`, store.exportieren(), 'application/json');
    } catch (e) {
      meldung(fehlerText(e), 'fehler');
    }
  });
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

export function render(el, ctx) {
  const tab = REITER[ctx.params.tab] ? ctx.params.tab : 'benutzer';
  const s = ctx.store.statistik();
  el.innerHTML = `
    <h1>Admin-Terminal</h1>
    <section class="kennzahlen" aria-label="Überblick">
      <div class="kennzahl"><span class="zahl">${s.nutzer}</span><span>Konten</span></div>
      <div class="kennzahl"><span class="zahl">${s.entwuerfe}</span><span>gespeicherte Leistungen</span></div>
      ${['eingereicht', 'angenommen', 'bezahlt'].map((st) => `
        <div class="kennzahl"><span class="zahl">${s[st]}</span><span>${esc(STATUS_LABEL[st])}</span></div>`).join('')}
    </section>
    <nav class="reiter" aria-label="Bereiche">
      ${Object.entries(REITER).map(([k, l]) => `<a href="#/admin/${k}"${k === tab ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}
    </nav>
    <div id="a-inhalt"></div>`;
  const inhalt = el.querySelector('#a-inhalt');
  ({ benutzer, noten, einstellungen, daten })[tab](inhalt, ctx);
}
