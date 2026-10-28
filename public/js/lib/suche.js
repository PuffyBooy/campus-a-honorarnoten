// Suche über alles (Strg + K oder 🔍 oben): Seiten, eigene Abrechnungen und Leistungen,
// für die Redaktion alle Abrechnungen, für Admins auch Konten. Pfeiltasten wählen, Enter öffnet.
import { esc, formatEuro, formatMonat } from './format.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const passt = (q, ...felder) => norm(felder.join(' ')).includes(q);

/** Seiten, die man direkt ansteuern kann (je nach Rollen) */
function seiten(nutzer) {
  const r = nutzer.rollen;
  const hat = (x) => r.includes(x) || (x !== 'autor' && r.includes('admin'));
  return [
    ...(r.includes('autor') ? [['Mein Monat', 'leistungen', 'Leistungen speichern und einreichen'], ['Meine Abrechnungen', 'noten'], ['Externe Honorarnote', 'extern']] : []),
    ...(hat('redaktion') ? [['Redaktion', 'redaktion', 'Abrechnungen prüfen']] : []),
    ...(hat('buchhaltung') ? [['Buchhaltung', 'zahlung', 'Auszahlungen']] : []),
    ...(r.includes('admin') ? [
      ['Admin · Übersicht', 'admin'], ['Admin · Zugangsanfragen', 'admin/anfragen'], ['Admin · Einladen', 'admin/einladen'],
      ['Admin · Benutzer', 'admin/benutzer'], ['Admin · Abrechnungen', 'admin/noten'], ['Admin · Protokoll', 'admin/protokoll'],
      ['Admin · Einstellungen', 'admin/einstellungen', 'Prämiensätze, Vorlagen, Wartungsmodus, Erinnerung'], ['Admin · E-Mail', 'admin/mail'],
      ['Admin · Daten', 'admin/daten', 'Sicherungen, Export'], ['Kommandozentrale', 'admin/server', 'Server, Funktionstest, Leistungstest'],
    ] : []),
    ['Mein Profil', 'profil', 'Adresse, Bankverbindung, Passwort, Zwei-Faktor, E-Mails'],
    ['Was ist neu?', 'neu'],
  ].map(([titel, pfad, text = '']) => ({ art: 'Seite', titel, text, ziel: `#/${pfad}` }));
}

let offen = null;

/**
 * Suche öffnen. holeNutzer: liefert das angemeldete Konto (oder null).
 */
export async function sucheOeffnen({ store, nutzer }) {
  if (!nutzer || offen) return;
  const d = document.createElement('dialog');
  d.className = 'dialog suche-dialog';
  d.innerHTML = `
    <label for="suche-feld" class="sr-only">Suchen</label>
    <input id="suche-feld" type="search" autocomplete="off" spellcheck="false"
      placeholder="Suchen: Seite, Nummer, Name, Titel …" role="combobox" aria-expanded="true" aria-controls="suche-treffer">
    <ul id="suche-treffer" role="listbox" class="suche-treffer"></ul>
    <p class="klein suche-tipp"><kbd>↑</kbd> <kbd>↓</kbd> auswählen · <kbd>Enter</kbd> öffnen · <kbd>Esc</kbd> schließen</p>`;
  document.body.append(d);
  offen = d;
  d.addEventListener('close', () => { d.remove(); offen = null; });
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); // Klick neben das Fenster
  d.showModal();
  const feld = d.querySelector('#suche-feld');
  const liste = d.querySelector('#suche-treffer');

  // Daten einmal holen (eigene Abrechnungen und Leistungen, Konten für Admins)
  const r = nutzer.rollen;
  const [noten, leistungen, konten] = await Promise.all([
    r.includes('autor') ? Promise.resolve(store.meineNoten()).catch(() => []) : [],
    r.includes('autor') ? Promise.resolve(store.meineLeistungen()).catch(() => []) : [],
    r.includes('admin') && !nutzer.ansicht_von ? Promise.resolve(store.nutzerListe()).catch(() => []) : [],
  ]);
  const redaktion = r.includes('redaktion') || r.includes('admin');

  let treffer = [];
  let aktiv = 0;
  let lauf = 0;
  const zeichnen = () => {
    liste.innerHTML = treffer.length ? treffer.map((t, i) => `
      <li role="option" id="suche-${i}" aria-selected="${i === aktiv}" data-i="${i}">
        <span class="suche-art">${esc(t.art)}</span>
        <span><strong>${esc(t.titel)}</strong>${t.text ? `<br><span class="klein">${esc(t.text)}</span>` : ''}</span></li>`).join('')
      : `<li class="suche-leer klein">${feld.value.trim() ? 'Nichts gefunden.' : 'Tippe, um zu suchen.'}</li>`;
    feld.setAttribute('aria-activedescendant', treffer.length ? `suche-${aktiv}` : '');
    liste.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  };
  const suchen = async () => {
    const q = norm(feld.value.trim());
    const nr = ++lauf;
    const t = seiten(nutzer).filter((s) => !q || passt(q, s.titel, s.text));
    if (q) {
      for (const n of noten) {
        if (passt(q, n.nummer, formatMonat(n.monat), ...n.positionen.map((p) => p.titel))) {
          t.push({ art: 'Abrechnung', titel: n.nummer, text: `${formatMonat(n.monat)} · ${formatEuro(n.betrag)}`, ziel: '#/noten' });
        }
      }
      for (const p of leistungen) {
        if (passt(q, p.titel)) t.push({ art: 'Gespeichert', titel: p.titel, text: formatEuro(p.betrag), ziel: '#/leistungen' });
      }
      for (const k of konten) {
        if (passt(q, k.vorname, k.nachname, k.email)) t.push({ art: 'Konto', titel: `${k.vorname} ${k.nachname}`.trim(), text: k.email, ziel: '#/admin/benutzer' });
      }
    }
    treffer = t.slice(0, 30);
    aktiv = 0;
    zeichnen();
    if (q.length >= 2 && redaktion) {
      const l = await Promise.resolve(store.redaktionListe({ suche: feld.value.trim(), limit: 8, sortierung: 'eingereicht_desc' })).catch(() => null);
      if (nr !== lauf || !l) return;
      treffer = [...treffer, ...l.noten.map((n) => ({
        art: 'Redaktion', titel: `${n.autor.vorname} ${n.autor.nachname} · ${n.nummer}`,
        text: `${formatMonat(n.monat)} · ${formatEuro(n.betrag)}`, ziel: `#/redaktion/${n.id}`,
      }))].slice(0, 30);
      zeichnen();
    }
  };
  const oeffnen = (t) => { if (!t) return; d.close(); location.hash = t.ziel; };
  let warten;
  feld.addEventListener('input', () => { clearTimeout(warten); warten = setTimeout(suchen, 150); });
  feld.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!treffer.length) return;
      aktiv = (aktiv + (ev.key === 'ArrowDown' ? 1 : -1) + treffer.length) % treffer.length;
      zeichnen();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      oeffnen(treffer[aktiv]);
    }
  });
  liste.addEventListener('click', (ev) => oeffnen(treffer[ev.target.closest('[data-i]')?.dataset.i]));
  suchen();
  feld.focus();
}
