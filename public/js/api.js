// Datenhaltung im Server-Modus: dieselben Funktionen wie store.js (Demo),
// aber jede Anfrage geht an den eigenen Server. Rechte prüft der Server.
import { kontoFertig } from './lib/konto.js';

class Fehler extends Error {}

async function aufruf(name, ...args) {
  let res;
  try {
    res = await fetch(`api/${name}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Honorare': '1' },
      body: JSON.stringify({ args }),
    });
  } catch {
    throw new Fehler('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
  }
  let body = {};
  try { body = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    // Sitzung abgelaufen -> App zeigt wieder die Anmeldung
    if (body.abgemeldet) window.dispatchEvent(new CustomEvent('honorare:abgemeldet'));
    throw new Fehler(body.fehler || `Fehler ${res.status}. Bitte später erneut versuchen.`);
  }
  return body.daten;
}

const f = (name) => (...args) => aufruf(name, ...args);

export const initialisieren = async () => {};

// Sitzung & Zugang
export const aktuellerNutzer = f('aktuellerNutzer');
export const anmelden = f('anmelden');
export const abmelden = f('abmelden');
export const zugangAnfragen = f('zugangAnfragen');
export const erstesPasswortSetzen = f('erstesPasswortSetzen');
export const passwortAendern = f('passwortAendern');

// Profil
export const profilSpeichern = f('profilSpeichern');
export const einstellungen = f('einstellungen');
export const rechtliches = f('rechtliches');
export const hinweisBestaetigen = f('hinweisBestaetigen');
export const benachrichtigungenSpeichern = f('benachrichtigungenSpeichern');
/** Konto fertig eingerichtet? (Autor:innen: Adresse, Bankverbindung, mindestens ein Profil-Link) */
export const profilVollstaendig = kontoFertig;

// Autor:in
export const meineLeistungen = f('meineLeistungen');
export const leistungSpeichern = f('leistungSpeichern');
export const leistungLoeschen = f('leistungLoeschen');
export const meineArtikel = f('meineArtikel');
export const naechsteNummer = f('naechsteNummer');
export const notenDiesenMonat = f('notenDiesenMonat');
export const abrechnungAbschicken = f('abrechnungAbschicken');
export const meineNoten = f('meineNoten');
export const leistungenZurueckholen = f('leistungenZurueckholen');
export const abrechnungZurueckziehen = f('abrechnungZurueckziehen');

// Redaktion
export const alleNoten = f('alleNoten');
export const note = f('note');
export const annehmen = f('annehmen');
export const ablehnen = f('ablehnen');
export const betragKorrigieren = f('betragKorrigieren');
export const kommentieren = f('kommentieren');
export const kommentare = f('kommentare');
export const verlaufVon = f('verlaufVon');

// Buchhaltung
export const offeneZahlungen = f('offeneZahlungen');
export const bezahlteNoten = f('bezahlteNoten');
export const alsBezahltMarkieren = f('alsBezahltMarkieren');
export const alleAlsBezahltMarkieren = f('alleAlsBezahltMarkieren');
export const bezahlteNotenSeit = f('bezahlteNotenSeit');

// Admin
export const anfragen = f('anfragen');
export const offeneAnfragenAnzahl = f('offeneAnfragenAnzahl');
export const anfrageFreischalten = f('anfrageFreischalten');
export const anfrageAblehnen = f('anfrageAblehnen');
export const nutzerAnlegen = f('nutzerAnlegen');
export const nutzerListe = f('nutzerListe');
export const rollenSetzen = f('rollenSetzen');
export const nutzerAktivSetzen = f('nutzerAktivSetzen');
export const passwortZuruecksetzen = f('passwortZuruecksetzen');
export const emailAendern = f('emailAendern');
export const nutzerLoeschen = f('nutzerLoeschen');
export const alleNotenAdmin = f('alleNotenAdmin');
export const noteLoeschen = f('noteLoeschen');
export const loeschprotokoll = f('loeschprotokoll');
export const einstellungenSpeichern = f('einstellungenSpeichern');
export const statistik = f('statistik');
export const exportieren = f('exportieren');
export const mailEinstellungen = f('mailEinstellungen');
export const mailEinstellungenSpeichern = f('mailEinstellungenSpeichern');
export const testMail = f('testMail');
// Einspielen und Zurücksetzen gibt es nur in der Demo; auf dem Server über die Kommandozeile
