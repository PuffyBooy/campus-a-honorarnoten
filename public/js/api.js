// Datenhaltung im Server-Modus: dieselben Funktionen wie store.js (Demo),
// aber jede Anfrage geht an den eigenen Server. Rechte prüft der Server.
import { kontoFertig } from './lib/konto.js';
import { anfrageGemessen, serverTiming } from './lib/messung.js';

class Fehler extends Error {}

async function aufruf(name, ...args) {
  let res;
  const t0 = performance.now();
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
  // für die Kommandozentrale: wie lange im Browser, wie lange davon am Server
  anfrageGemessen(name, performance.now() - t0, serverTiming(res.headers.get('Server-Timing')));
  if (!res.ok) {
    // Sitzung abgelaufen -> App zeigt wieder die Anmeldung
    if (body.abgemeldet) { vorratLeeren(); window.dispatchEvent(new CustomEvent('honorare:abgemeldet')); }
    // Wartungsmodus: App zeigt den Hinweis statt der Seite
    if (body.wartung && name !== 'aktuellerNutzer') window.dispatchEvent(new CustomEvent('honorare:wartung'));
    throw Object.assign(new Fehler(body.fehler || `Fehler ${res.status}. Bitte später erneut versuchen.`), { wartung: body.wartung });
  }
  return body.daten;
}

// ------------------------------------------------------------------ Daten-Vorrat
// Lesende Abfragen kommen in einen Vorrat: Beim nächsten Mal ist die Seite sofort da, im Hintergrund wird
// nachgefragt; hat sich etwas geändert, zeichnet die App die Seite neu (Ereignis „honorare:daten-neu“).
// Jede Änderung (speichern, annehmen …) leert den Vorrat – Eigenes ist also nie veraltet.
const LESEN = new Set(['einstellungen', 'ablaufZeiten', 'meineLeistungen', 'meineArtikel', 'naechsteNummer', 'notenDiesenMonat',
  'meineNoten', 'note', 'nachrichten', 'alleNoten', 'redaktionListe', 'pruefInfo', 'ausgezahltImJahr', 'kommentare', 'verlaufVon',
  'offeneZahlungen', 'bezahlteNoten', 'bezahlteNotenSeit', 'zahlungskonto', 'nutzerListe', 'anfragen', 'offeneAnfragenAnzahl',
  'registrierungslinks', 'dashboard', 'protokoll', 'sicherungen', 'mailEinstellungen', 'wartung', 'statistik', 'loeschprotokoll']);
// immer frisch, ändern aber nichts (Vorrat bleibt)
const NEUTRAL = new Set(['redigierStand', 'redigierUebersicht', 'redigierSchluessel', 'aktuellerNutzer', 'navZaehler', 'rechtliches', 'nachweisLaden', 'zahlungsavis', 'serverStatus', 'anfrageAnalyse',
  'ping', 'mailStatus', 'pushSchluessel', 'leistungstest', 'funktionstest', 'exportieren', 'sicherungHerunterladen', 'einladungPruefen',
  'pdfMailen', 'testMail']);
const VORRAT_MAX_MS = 10 * 60000; // älter: nicht mehr zeigen, neu holen
const NACHFRAGEN_AB_MS = 3000;    // jünger: gilt als frisch, keine zweite Anfrage
const vorrat = new Map();         // "name|args" -> { zeit, daten (JSON-Text) }
let vorratStand = 0;              // zählt hoch, wenn der Vorrat geleert wird (späte Antworten verwerfen)

export function vorratLeeren() {
  vorrat.clear();
  vorratStand++;
}

async function gelesen(name, args) {
  const schluessel = `${name}|${JSON.stringify(args)}`;
  const v = vorrat.get(schluessel);
  const alter = v ? Date.now() - v.zeit : Infinity;
  const holen = async () => {
    const stand = vorratStand;
    const daten = await aufruf(name, ...args);
    const text = JSON.stringify(daten);
    if (stand !== vorratStand) return daten; // inzwischen wurde etwas geändert – diese Antwort nicht merken
    const vorher = vorrat.get(schluessel);
    vorrat.set(schluessel, { zeit: Date.now(), daten: text });
    if (vorher && vorher.daten !== text) window.dispatchEvent(new CustomEvent('honorare:daten-neu', { detail: { name } }));
    return daten;
  };
  if (alter < VORRAT_MAX_MS) {
    if (alter > NACHFRAGEN_AB_MS) holen().catch(() => {}); // im Hintergrund nachfragen
    return JSON.parse(v.daten); // eigene Kopie – die Seite darf sie verändern
  }
  return holen();
}

async function anfrage(name, ...args) {
  if (LESEN.has(name)) return gelesen(name, args);
  if (!NEUTRAL.has(name)) vorratLeeren(); // ändert etwas: vorher und nachher nichts Altes zeigen
  try {
    return await aufruf(name, ...args);
  } finally {
    if (!NEUTRAL.has(name)) vorratLeeren();
  }
}

const f = (name) => (...args) => anfrage(name, ...args);

export const initialisieren = async () => {};

// Sitzung & Zugang
export const aktuellerNutzer = f('aktuellerNutzer');
export const anmelden = f('anmelden');
export const abmelden = f('abmelden');
export const zugangAnfragen = f('zugangAnfragen');
export const erstesPasswortSetzen = f('erstesPasswortSetzen');
export const passwortAendern = f('passwortAendern');
export const linkAnmelden = f('linkAnmelden');
export const passwortVergessen = f('passwortVergessen');
export const passwortNeuSetzen = f('passwortNeuSetzen');
export const zweiFaktorStarten = f('zweiFaktorStarten');
export const zweiFaktorEinschalten = f('zweiFaktorEinschalten');
export const zweiFaktorAusschalten = f('zweiFaktorAusschalten');
export const zweiFaktorZuruecksetzen = f('zweiFaktorZuruecksetzen');
export const einladungPruefen = f('einladungPruefen');
export const mitLinkRegistrieren = f('mitLinkRegistrieren');
export const registrierungslinkErstellen = f('registrierungslinkErstellen');
export const registrierungslinks = f('registrierungslinks');
export const registrierungslinkWiderrufen = f('registrierungslinkWiderrufen');
export const dashboard = f('dashboard');
export const protokollLesen = f('protokoll');
export const sicherungen = f('sicherungen');
export const jetztSichern = f('jetztSichern');
export const sicherungHerunterladen = f('sicherungHerunterladen');

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
export const nachweisHochladen = f('nachweisHochladen');
export const nachweisLoeschen = f('nachweisLoeschen');
export const nachweisLaden = f('nachweisLaden');
export const meineArtikel = f('meineArtikel');
export const naechsteNummer = f('naechsteNummer');
export const nummerFestlegen = f('nummerFestlegen');
export const mailStatus = f('mailStatus');
export const redigiertZaehlen = f('redigiertZaehlen');
export const redigiertRueckgaengig = f('redigiertRueckgaengig');
export const redigierStand = f('redigierStand');
export const redigierUebersicht = f('redigierUebersicht');
export const redigierSchluessel = f('redigierSchluessel');
export const redigierSchluesselErstellen = f('redigierSchluesselErstellen');
export const redigierSchluesselWiderrufen = f('redigierSchluesselWiderrufen');
export const ping = f('ping');
export const anfrageAnalyse = f('anfrageAnalyse');
export const pushSchluessel = f('pushSchluessel');
export const pushAbonnieren = f('pushAbonnieren');
export const pushAbmelden = f('pushAbmelden');
export const pushTest = f('pushTest');
export const notenDiesenMonat = f('notenDiesenMonat');
export const abrechnungAbschicken = f('abrechnungAbschicken');
export const meineNoten = f('meineNoten');
export const leistungenZurueckholen = f('leistungenZurueckholen');
export const abrechnungZurueckziehen = f('abrechnungZurueckziehen');

// Redaktion
export const alleNoten = f('alleNoten');
export const redaktionListe = f('redaktionListe');
export const pruefInfo = f('pruefInfo');
export const ausgezahltImJahr = f('ausgezahltImJahr');
export const note = f('note');
export const annehmen = f('annehmen');
export const ablehnen = f('ablehnen');
export const betragKorrigieren = f('betragKorrigieren');
export const positionPruefen = f('positionPruefen');
export const kommentieren = f('kommentieren');
export const kommentare = f('kommentare');
export const nachrichten = f('nachrichten');
export const nachfragen = f('nachfragen');
export const rueckfrageBeantworten = f('rueckfrageBeantworten');
export const rueckfrageErledigt = f('rueckfrageErledigt');
export const navZaehler = f('navZaehler');
export const ablaufZeiten = f('ablaufZeiten');
export const neuigkeitenGesehen = f('neuigkeitenGesehen');
export const serverStatus = f('serverStatus');
export const leistungstest = f('leistungstest');
export const serverAktion = f('serverAktion');
export const funktionstest = f('funktionstest');
export const sicherungZurueckspielen = f('sicherungZurueckspielen');
export const ansichtStarten = f('ansichtStarten');
export const ansichtBeenden = f('ansichtBeenden');
export const verlaufVon = f('verlaufVon');

// Buchhaltung
export const offeneZahlungen = f('offeneZahlungen');
export const zahlungsavis = f('zahlungsavis');
export const zahlungskonto = f('zahlungskonto');
export const zahlungskontoSpeichern = f('zahlungskontoSpeichern');
export const pdfMailen = f('pdfMailen');
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
export const noteLoeschen = f('noteLoeschen');
export const loeschprotokoll = f('loeschprotokoll');
export const einstellungenSpeichern = f('einstellungenSpeichern');
export const statistik = f('statistik');
export const exportieren = f('exportieren');
export const mailEinstellungen = f('mailEinstellungen');
export const mailEinstellungenSpeichern = f('mailEinstellungenSpeichern');
export const testMail = f('testMail');
export const wartung = f('wartung');
export const wartungSetzen = f('wartungSetzen');
// Einspielen und Zurücksetzen gibt es nur in der Demo; auf dem Server über die Kommandozeile
