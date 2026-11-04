// Chrome-Erweiterung „Redigier-Zähler“ (Hintergrund): zählt die offene Seite (z. B. einen Artikel im CMS)
// als redigiert und schickt das an die App. Jeder Artikel zählt pro Monat nur einmal.
// Adresse der App und persönlicher Schlüssel stehen in einstellungen.js (wird beim Herunterladen erzeugt).
importScripts('einstellungen.js');

const { app, schluessel } = self.HONORARE;

async function anfrage(name, args = []) {
  let r;
  try {
    r = await fetch(`${app}api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Honorare': '1', 'X-Honorare-Schluessel': schluessel },
      body: JSON.stringify({ args }),
    });
  } catch {
    throw new Error('Keine Verbindung zur App.');
  }
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Der Schlüssel gilt nicht mehr – bitte die Erweiterung in der App (Mein Profil) neu herunterladen.');
  if (!r.ok) throw new Error(body.fehler || `Fehler ${r.status}`);
  return body.daten;
}

/** Artikel-Nummer aus der Adresse: die letzte Zahl im Pfad (…/artikel/4311/edit), sonst ein Kürzel der Adresse */
function artikelId(url) {
  const u = new URL(url);
  const zahlen = u.pathname.match(/\d{2,}/g) ?? u.search.match(/\d{2,}/g);
  if (zahlen) return zahlen.at(-1).slice(0, 40);
  let h = 2166136261;
  for (const c of u.host + u.pathname) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `u${(h >>> 0).toString(36)}`;
}

/** Titel ohne Zusätze wie „ – Bearbeiten | CMS“ */
const titelVon = (tab) => String(tab.title ?? '').split(/\s[|–—-]\s/)[0].trim().slice(0, 300);

function abzeichen(anzahl) {
  chrome.action.setBadgeBackgroundColor({ color: '#0f6b66' });
  chrome.action.setBadgeText({ text: anzahl ? String(anzahl) : '' });
}

async function seiteZaehlen(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error('Diese Seite lässt sich nicht zählen.');
  const stand = await anfrage('redigiertMelden', [artikelId(tab.url), titelVon(tab)]);
  abzeichen(stand.anzahl);
  return stand;
}

// Popup fragt nach Stand oder zählt die offene Seite
chrome.runtime.onMessage.addListener((nachricht, _von, antwort) => {
  const aufgabe = nachricht.art === 'zaehlen'
    ? seiteZaehlen(nachricht.tab) // Adresse und Titel schickt das Popup (es darf die offene Seite sehen)
    : anfrage('redigierStand').then((s) => { abzeichen(s.anzahl); return s; });
  aufgabe.then((daten) => antwort({ daten }), (e) => antwort({ fehler: e.message }));
  return true; // Antwort kommt später
});

// Tastenkürzel (Standard: Alt + Umschalt + R): offene Seite zählen, Ergebnis als Abzeichen am Symbol
chrome.commands.onCommand.addListener(async (befehl, tab) => {
  if (befehl !== 'zaehlen') return;
  try {
    const s = await seiteZaehlen(tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
    if (!s.neu) chrome.action.setBadgeText({ text: '✓' });
    setTimeout(() => abzeichen(s.anzahl), 1500);
  } catch {
    chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
    chrome.action.setBadgeText({ text: '!' });
  }
});
