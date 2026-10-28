// Lokale Datenhaltung im Browser (localStorage).
//
// Alle Daten liegen NUR in diesem Browser auf diesem Gerät. Das ist für eine
// Vorführung (z. B. über GitHub Pages) gedacht. Für den echten Betrieb mit
// mehreren Personen auf verschiedenen Geräten braucht es einen Server – die
// Funktionen hier sind so geschnitten, dass sie 1:1 durch API-Aufrufe
// ersetzt werden können. Jede Funktion prüft Rolle und erlaubte Statuswechsel.
import { artNormalisieren, heuteIso, summe, textAnzahl } from './lib/format.js';
import { ibanFehler, normalizeIban, normalizeBic, bicIstGueltig } from './lib/iban.js';
import { honorarnoteNummer } from './lib/nummer.js';
import { STANDARD_SAETZE, saetzeNormalisieren } from './lib/honorarsaetze.js';
import {
  MEDIEN, MEDIUM_KEYS, PROFIL_FELD, istMedium, mediumName, mediumOder, mediumVonArtikel, nichtVerbunden, profilIdAusLink,
  verbundeneMedien,
} from './lib/campus.js';
import { KONTO_FEHLT, darfRedigieren, kontoFertig, rollenNormalisieren } from './lib/konto.js';
import { DEMO_PASSWORT } from './demo-konten.js';
import { ersatzcodes, totpGeheimnis, totpPruefen, totpUri } from './lib/totp.js';
import { BETREIBER_STANDARD, betreiberOder } from './lib/rechtliches.js';
import { benachrichtigungenNormalisieren } from './lib/benachrichtigungen.js';
import { vorlagenNormalisieren } from './lib/vorlagen.js';

const SPEICHER_KEY = 'campus-a-honorare:v1';
const SITZUNG_KEY = 'campus-a-honorare:sitzung';
const VERSION = 1;

export const STANDARD_EMPFAENGER = {
  name: 'campus a Medien GmbH',
  strasse: 'Stiftgasse 6/1/2',
  plz_ort: '1070 Wien',
  uid: 'ATU81242718',
};

let db = null;

// ------------------------------------------------------------------ Grundlagen

export class Fehler extends Error {}
const pruefe = (bedingung, meldung) => { if (!bedingung) throw new Fehler(meldung); };
const id = () => crypto.randomUUID();
const jetzt = () => new Date().toISOString();
const kopie = (x) => (x == null ? x : structuredClone(x));
const leer = (s) => !String(s ?? '').trim();
const trim = (s) => String(s ?? '').trim();

function leereDb() {
  return {
    version: VERSION,
    nutzer: [],
    positionen: [],   // gespeicherte, noch nicht abgerechnete Leistungen
    noten: [],        // abgeschickte Prämienabrechnungen (Monatsabrechnungen)
    kommentare: [],
    verlauf: [],
    loeschprotokoll: [],
    anfragen: [],     // Zugangsanfragen, die ein Admin freischaltet oder ablehnt
    einstellungen: {
      empfaenger: { ...STANDARD_EMPFAENGER },
      datenschutzKontakt: '',
      honorarsaetze: saetzeNormalisieren(STANDARD_SAETZE),
      betreiber: { ...BETREIBER_STANDARD },
    },
  };
}

function laden() {
  try {
    const roh = localStorage.getItem(SPEICHER_KEY);
    if (roh) {
      const d = JSON.parse(roh);
      // fehlende Bereiche (ältere Speicherstände) mit Standardwerten ergänzen
      if (d?.version === VERSION) return { ...leereDb(), ...d };
    }
  } catch { /* beschädigt oder gesperrt -> neu anlegen */ }
  return null;
}

function speichern() {
  try {
    localStorage.setItem(SPEICHER_KEY, JSON.stringify(db));
  } catch (e) {
    throw new Fehler('Speichern im Browser fehlgeschlagen (Speicher voll oder gesperrt).');
  }
}

// Änderungen aus einem anderen Tab übernehmen und melden
window.addEventListener('storage', (ev) => {
  if (ev.key === SPEICHER_KEY) {
    db = laden() ?? db;
    window.dispatchEvent(new CustomEvent('honorare:extern'));
  }
});

export async function initialisieren({ demoDaten, demoAktualisieren } = {}) {
  db = laden();
  if (!db) {
    db = leereDb();
    if (demoDaten) await demoDaten(db, { passwortHash });
    speichern();
  } else if (demoAktualisieren?.(db)) {
    speichern(); // ältere Demo-Daten an die aktuelle Version angepasst
  }
}

// ------------------------------------------------------------------ Passwörter

async function pbkdf2(passwort, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function passwortHash(passwort) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { salt, hash: await pbkdf2(passwort, salt) };
}

async function passwortPasst(nutzer, passwort) {
  return (await pbkdf2(passwort, nutzer.passwort.salt)) === nutzer.passwort.hash;
}

function passwortPruefen(pw) {
  pruefe(String(pw ?? '').length >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
}

// ------------------------------------------------------------------ Sitzung & Rollen

// Sitzung pro Tab (sessionStorage): so kann man in zwei Tabs gleichzeitig
// z. B. als Autor:in und als Redaktion angemeldet sein.
function sitzungsNutzer() {
  let uid = null;
  try { uid = sessionStorage.getItem(SITZUNG_KEY); } catch { /* ignorieren */ }
  const n = db?.nutzer.find((x) => x.id === uid);
  if (!n?.aktiv) return null;
  // Admin sieht die App als jemand anderes (nur ansehen, nur in diesem Tab)
  const als = ansichtZiel(n);
  return als ?? n;
}

const ANSICHT_KEY = 'campus-a-honorare:ansicht';
function ansichtZiel(admin) {
  let uid = null;
  try { uid = sessionStorage.getItem(ANSICHT_KEY); } catch { /* ignorieren */ }
  if (!uid || !admin.rollen.includes('admin')) return null;
  const z = db.nutzer.find((x) => x.id === uid);
  return z?.aktiv && !z.rollen.includes('admin') ? z : null;
}
function echterNutzer() {
  let uid = null;
  try { uid = sessionStorage.getItem(SITZUNG_KEY); } catch { /* ignorieren */ }
  return db?.nutzer.find((x) => x.id === uid && x.aktiv) ?? null;
}

/** Läuft gerade „Als Person ansehen“? (die Demo sperrt dann alles außer Lesen, siehe lib/ansicht.js) */
export function ansichtAktiv() {
  const admin = echterNutzer();
  return Boolean(admin && ansichtZiel(admin));
}

export function ansichtStarten(uid) {
  const { n } = adminNutzer(uid);
  const admin = echterNutzer();
  pruefe(n.id !== admin.id, 'Das ist dein eigenes Konto.');
  pruefe(n.aktiv, 'Dieses Konto ist deaktiviert.');
  pruefe(!n.rollen.includes('admin'), 'Admin-Konten können nicht angesehen werden.');
  sessionStorage.setItem(ANSICHT_KEY, n.id);
  protokoll('warnung', 'konten', `Ansehen als ${anzeigename(n)} (nur lesen) begonnen`, admin);
  speichern();
  return true;
}

export function ansichtBeenden() {
  sessionStorage.removeItem(ANSICHT_KEY);
  return true;
}

function ich() {
  const n = sitzungsNutzer();
  pruefe(n, 'Bitte melde dich an.');
  return n;
}

const hat = (n, rolle) => n.rollen.includes(rolle) || (rolle !== 'autor' && n.rollen.includes('admin'));
function brauche(rolle) {
  const n = ich();
  pruefe(hat(n, rolle), 'Dafür fehlt dir die Berechtigung.');
  // Autor:innen müssen zuerst ihr Konto einrichten (Adresse, Bankverbindung, Profil-Link)
  if (rolle === 'autor') pruefe(kontoFertig(n), KONTO_FEHLT);
  return n;
}
const anzeigename = (n) => `${n.vorname} ${n.nachname}`.trim() || n.email;

/** öffentliche Sicht auf eine:n Nutzer:in (ohne Passwort) */
function nutzerSicht(n) {
  if (!n) return null;
  const { passwort, zwei_faktor: zf, zwei_faktor_neu: zn, zwei_faktor_codes: zc, zwei_faktor_schritt: zs, ...rest } = n;
  return { ...kopie(rest), zwei_faktor: Boolean(zf) };
}

// ------------------------------------------------------------------ Wartungsmodus (nur Admins kommen hinein)

const WARTUNG_TEXT = 'Wir arbeiten gerade an der App. Bitte versuch es etwas später noch einmal.';
function wartungLaden() {
  const w = db.einstellungen?.wartung ?? {};
  return { an: Boolean(w.an), text: trim(w.text ?? '') || WARTUNG_TEXT, seit: w.seit ?? null, von: w.von ?? '' };
}
function wartungPruefen(n) {
  const w = wartungLaden();
  if (w.an && !n?.rollen.includes('admin')) throw Object.assign(new Fehler(w.text), { wartung: w.text });
}

export function aktuellerNutzer() {
  const n = sitzungsNutzer();
  wartungPruefen(n);
  const sicht = nutzerSicht(n);
  if (sicht?.rollen.includes('admin') && wartungLaden().an) sicht.wartung = true;
  if (sicht && ansichtAktiv()) sicht.ansicht_von = anzeigename(echterNutzer());
  return sicht;
}

export function wartung() {
  brauche('admin');
  return wartungLaden();
}

export function wartungSetzen(an, text = '') {
  const admin = brauche('admin');
  an = an === true;
  db.einstellungen.wartung = { an, text: trim(text).slice(0, 500), seit: an ? jetzt() : null, von: an ? anzeigename(admin) : '' };
  protokoll('warnung', 'einstellungen', an ? 'Wartungsmodus eingeschaltet' : 'Wartungsmodus ausgeschaltet');
  speichern();
  return wartungLaden();
}

/**
 * Nur Demo: Konto für „Erstes Anmelden“ frisch anlegen – mit dem Demo-Passwort als Startpasswort,
 * ohne Adresse, Bankverbindung und Profil-Links. Frühere Daten dieses Kontos werden entfernt.
 */
export async function demoKontoFrisch(email) {
  email = trim(email).toLowerCase();
  const alt = db.nutzer.find((x) => x.email === email);
  if (alt) {
    const noten = new Set(db.noten.filter((x) => x.autor_id === alt.id).map((x) => x.id));
    db.nutzer = db.nutzer.filter((x) => x.id !== alt.id);
    db.positionen = db.positionen.filter((x) => x.autor_id !== alt.id);
    db.noten = db.noten.filter((x) => !noten.has(x.id));
    db.verlauf = db.verlauf.filter((x) => !noten.has(x.note_id));
    db.kommentare = db.kommentare.filter((x) => !noten.has(x.note_id));
  }
  db.nutzer.push({
    id: `demo-neu-${id()}`, email, vorname: 'Nora', nachname: 'Neu', rollen: ['autor'], aktiv: true,
    muss_passwort_aendern: true, passwort: await passwortHash(DEMO_PASSWORT), erstellt_am: jetzt(),
    profil: { strasse: '', plz_ort: '', kontoinhaber: '', iban: '', bic: '', campus_profil: '', campus_a_profil: '' },
  });
  speichern();
}

/** Mit Zwei-Faktor: zuerst ohne Code -> { code_noetig: true }, dann noch einmal mit Code */
export async function anmelden(email, passwort, code = null) {
  const n = db.nutzer.find((x) => x.email === trim(email).toLowerCase());
  const ok = n && (await passwortPasst(n, passwort));
  if (!ok) { protokoll('warnung', 'anmeldung', `Anmeldung fehlgeschlagen für ${trim(email).toLowerCase()}`, n); speichern(); }
  pruefe(ok, 'E-Mail oder Passwort ist falsch.');
  pruefe(n.aktiv, 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.');
  if (wartungLaden().an) pruefe(n.rollen.includes('admin'), wartungLaden().text);
  if (n.zwei_faktor) {
    if (leer(code)) return { code_noetig: true };
    if (!(await zweiFaktorCodeOk(n, code))) {
      protokoll('warnung', 'anmeldung', 'Falscher Zwei-Faktor-Code', n);
      speichern();
      pruefe(false, 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.');
    }
  }
  protokoll('info', 'anmeldung', n.zwei_faktor ? 'Angemeldet (mit Zwei-Faktor)' : 'Angemeldet', n);
  sessionStorage.setItem(SITZUNG_KEY, n.id);
  n.letzter_login = jetzt();
  speichern();
  return nutzerSicht(n);
}

export function abmelden() {
  sessionStorage.removeItem(SITZUNG_KEY);
  sessionStorage.removeItem(ANSICHT_KEY);
}

// ------------------------------------------------------------------ Zugang anfragen & freischalten
//
// Man kann sich nicht selbst registrieren: Neue Personen schicken eine Anfrage,
// ein Admin schaltet sie frei. Dabei entsteht ein Startpasswort, das der Admin
// weitergibt und das beim ersten Login geändert werden muss.

const EMAIL_MUSTER = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Gut lesbares Startpasswort ohne verwechselbare Zeichen (0/O, 1/l/I) */
function startpasswort(laenge = 10) {
  const zeichen = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(laenge)), (x) => zeichen[x % zeichen.length]).join('');
}

function kontoErstellen({ vorname, nachname, email, rollen }, passwortDaten) {
  const n = {
    id: id(),
    email,
    vorname: trim(vorname),
    nachname: trim(nachname),
    rollen,
    aktiv: true,
    muss_passwort_aendern: true,
    passwort: passwortDaten,
    profil: { strasse: '', plz_ort: '', kontoinhaber: `${trim(vorname)} ${trim(nachname)}`, iban: '', bic: '' },
    erstellt_am: jetzt(),
  };
  db.nutzer.push(n);
  return n;
}

function neuePersonPruefen({ vorname, nachname, email }) {
  pruefe(!leer(vorname) && !leer(nachname), 'Bitte Vor- und Nachnamen angeben.');
  pruefe(EMAIL_MUSTER.test(email), 'Bitte eine gültige E-Mail-Adresse angeben.');
  pruefe(!db.nutzer.some((x) => x.email === email), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
}

/** Öffentlich (ohne Anmeldung): Zugang anfragen */
export function zugangAnfragen({ vorname, nachname, email, nachricht, zustimmung }) {
  email = trim(email).toLowerCase();
  neuePersonPruefen({ vorname, nachname, email });
  pruefe(zustimmung === true, 'Bitte bestätige, dass du die Datenschutzerklärung und den Hinweis zum Betreiber gelesen hast.');
  pruefe(!db.anfragen.some((a) => a.email === email && a.status === 'offen'),
    'Für diese E-Mail-Adresse gibt es schon eine offene Anfrage. Bitte etwas Geduld.');
  db.anfragen.push({
    id: id(), vorname: trim(vorname), nachname: trim(nachname), email,
    nachricht: trim(nachricht).slice(0, 1000), status: 'offen', am: jetzt(), zustimmung_am: jetzt(),
  });
  speichern();
}

export function anfragen() {
  brauche('admin');
  return kopie(db.anfragen).sort((a, b) => b.am.localeCompare(a.am));
}

export function offeneAnfragenAnzahl() {
  const n = sitzungsNutzer();
  return n && hat(n, 'admin') ? db.anfragen.filter((a) => a.status === 'offen').length : 0;
}

function anfrageHolen(anfrageId) {
  const a = db.anfragen.find((x) => x.id === anfrageId);
  pruefe(a, 'Diese Anfrage gibt es nicht (mehr).');
  pruefe(a.status === 'offen', 'Diese Anfrage wurde bereits bearbeitet.');
  return a;
}

const erlaubteRollen = rollenNormalisieren;

/** Anfrage freischalten -> Konto mit Startpasswort. Gibt E-Mail und Startpasswort zurück. */
export async function anfrageFreischalten(anfrageId, rollen = ['autor']) {
  const admin = brauche('admin');
  const a = anfrageHolen(anfrageId);
  rollen = erlaubteRollen(rollen);
  pruefe(rollen.length, 'Bitte mindestens eine Rolle wählen.');
  neuePersonPruefen(a);
  const passwort = startpasswort();
  const hash = await passwortHash(passwort);
  const n = kontoErstellen({ ...a, rollen }, hash);
  Object.assign(a, { status: 'freigeschaltet', bearbeitet_am: jetzt(), bearbeitet_von: anzeigename(admin) });
  speichern();
  return zugang(n, passwort);
}

export function anfrageAblehnen(anfrageId) {
  const admin = brauche('admin');
  const a = anfrageHolen(anfrageId);
  Object.assign(a, { status: 'abgelehnt', bearbeitet_am: jetzt(), bearbeitet_von: anzeigename(admin) });
  speichern();
}

/** Admin legt eine Person direkt an (ohne Anfrage) */
export async function nutzerAnlegen({ vorname, nachname, email, rollen }) {
  brauche('admin');
  email = trim(email).toLowerCase();
  neuePersonPruefen({ vorname, nachname, email });
  rollen = erlaubteRollen(rollen ?? []);
  pruefe(rollen.length, 'Bitte mindestens eine Rolle wählen.');
  const passwort = startpasswort();
  const n = kontoErstellen({ vorname, nachname, email, rollen }, await passwortHash(passwort));
  // eine evtl. offene Anfrage derselben Person ist damit erledigt
  db.anfragen.filter((a) => a.email === email && a.status === 'offen')
    .forEach((a) => Object.assign(a, { status: 'freigeschaltet', bearbeitet_am: jetzt() }));
  protokoll('info', 'konten', `Konto angelegt: ${anzeigename(n)} (${email}), Rollen: ${rollen.join(', ')}`);
  speichern();
  return zugang(n, passwort);
}

/** Nach Login mit Startpasswort: eigenes Passwort festlegen */
export async function erstesPasswortSetzen(neu) {
  const n = ich();
  pruefe(n.muss_passwort_aendern, 'Bitte das Passwort im Profil ändern.');
  passwortPruefen(neu);
  pruefe(!(await passwortPasst(n, neu)), 'Bitte ein neues Passwort wählen, nicht das Startpasswort.');
  n.passwort = await passwortHash(neu);
  n.muss_passwort_aendern = false;
  anmeldelinksWiderrufen(n.id); // ab jetzt gilt das eigene Passwort
  speichern();
}

// ------------------------------------------------------------------ Links (Anmelden, Registrieren)
// Wie auf dem Server; in der Demo bleibt der Token im Browser-Speicher (der Server speichert nur einen Hash).

const LINK_TAGE = [1, 3, 7, 14, 30];
const LINK_ROLLEN = ['autor', 'redigieren', 'redaktion', 'buchhaltung'];
const appLink = (pfad) => `${location.origin}${location.pathname}#/${pfad}`;

function linkErstellen(art, { nutzer_id = null, rollen = [], max = null, tage, sekunden = tage * 86400, notiz = '', von = '' }) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  db.links ??= [];
  db.links.push({
    id: id(), token, art, nutzer_id, rollen, max_nutzungen: max, nutzungen: 0,
    gueltig_bis: new Date(Date.now() + sekunden * 1000).toISOString(), notiz, erstellt_von: von, erstellt_am: jetzt(), widerrufen_am: null,
  });
  return token;
}

function linkPruefen(token, art) {
  const l = (db.links ?? []).find((x) => x.token === String(token ?? '') && x.art === art);
  pruefe(l, 'Dieser Link ist ungültig. Bitte prüfe, ob er vollständig kopiert wurde.');
  const verbraucht = l.max_nutzungen != null && l.nutzungen >= l.max_nutzungen;
  const abgelaufen = l.gueltig_bis < new Date().toISOString();
  if (art === 'anmelden') {
    pruefe(!l.widerrufen_am && !verbraucht, 'Dieser Anmeldelink wurde schon verwendet. Bitte melde dich mit E-Mail und Passwort an.');
    pruefe(!abgelaufen, 'Dieser Anmeldelink ist abgelaufen. Bitte melde dich mit E-Mail und Startpasswort an.');
  } else {
    pruefe(!l.widerrufen_am, 'Dieser Registrierungslink wurde zurückgezogen. Bitte frag nach einem neuen.');
    pruefe(!abgelaufen, 'Dieser Registrierungslink ist abgelaufen. Bitte frag nach einem neuen.');
    pruefe(!verbraucht, 'Dieser Registrierungslink wurde schon so oft verwendet wie erlaubt. Bitte frag nach einem neuen.');
  }
  return l;
}

function anmeldelinksWiderrufen(nutzerId) {
  (db.links ?? []).filter((l) => l.nutzer_id === nutzerId && l.art === 'anmelden' && !l.widerrufen_am)
    .forEach((l) => { l.widerrufen_am = jetzt(); });
}

/** Zugangsdaten mit Link zum direkten Anmelden (einmal, 7 Tage) */
function zugang(n, passwort) {
  anmeldelinksWiderrufen(n.id);
  const link = appLink(`link/${linkErstellen('anmelden', { nutzer_id: n.id, max: 1, tage: 7 })}`);
  speichern();
  return { email: n.email, vorname: n.vorname, passwort, link };
}

export function linkAnmelden(token) {
  const l = linkPruefen(token, 'anmelden');
  pruefe(l.notiz !== PASSWORT_LINK, 'Dieser Link ist ungültig. Bitte prüfe, ob er vollständig kopiert wurde.');
  const n = db.nutzer.find((x) => x.id === l.nutzer_id);
  pruefe(n?.aktiv, 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.');
  pruefe(!n.zwei_faktor, 'Für dieses Konto ist die Zwei-Faktor-Anmeldung eingeschaltet. Bitte mit E-Mail, Passwort und Code anmelden.');
  l.nutzungen++;
  sessionStorage.setItem(SITZUNG_KEY, n.id);
  n.letzter_login = jetzt();
  protokoll('info', 'anmeldung', 'Mit Anmeldelink aus der Zugangs-Mail angemeldet', n);
  speichern();
  return nutzerSicht(n);
}

// ------------------------------------------------------------------ Passwort vergessen

const PASSWORT_LINK = 'passwort-vergessen'; // Merkmal der Links aus „Passwort vergessen“

/**
 * Link zum Festlegen eines neuen Passworts (1 Stunde, einmal). Auf dem Server kommt er per E-Mail;
 * die Demo verschickt keine Mails und gibt ihn deshalb zurück (demo_link), sonst ist die Antwort immer gleich.
 */
export function passwortVergessen(email) {
  email = trim(email).toLowerCase();
  pruefe(EMAIL_MUSTER.test(email), 'Bitte eine gültige E-Mail-Adresse angeben.');
  const n = db.nutzer.find((x) => x.email === email && x.aktiv);
  if (!n) {
    protokoll('warnung', 'anmeldung', `Passwort vergessen für unbekannte oder deaktivierte Adresse: ${email}`);
    speichern();
    return { demo_link: null };
  }
  (db.links ?? []).filter((l) => l.nutzer_id === n.id && l.notiz === PASSWORT_LINK && !l.widerrufen_am)
    .forEach((l) => { l.widerrufen_am = jetzt(); });
  const link = appLink(`passwort/${linkErstellen('anmelden', { nutzer_id: n.id, max: 1, sekunden: 3600, notiz: PASSWORT_LINK })}`);
  protokoll('info', 'anmeldung', 'Passwort vergessen: Link angefordert', n);
  speichern();
  return { demo_link: link };
}

export async function passwortNeuSetzen(token, neu) {
  passwortPruefen(neu);
  const l = linkPruefen(token, 'anmelden');
  pruefe(l.notiz === PASSWORT_LINK, 'Dieser Link ist ungültig. Bitte fordere unter „Passwort vergessen“ einen neuen an.');
  const n = db.nutzer.find((x) => x.id === l.nutzer_id);
  pruefe(n?.aktiv, 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.');
  l.nutzungen++;
  n.passwort = await passwortHash(neu);
  n.muss_passwort_aendern = false;
  anmeldelinksWiderrufen(n.id);
  protokoll('info', 'anmeldung', 'Neues Passwort über „Passwort vergessen“ festgelegt', n);
  if (!n.zwei_faktor) {
    sessionStorage.setItem(SITZUNG_KEY, n.id);
    n.letzter_login = jetzt();
  }
  speichern();
  return { angemeldet: !n.zwei_faktor };
}

// ------------------------------------------------------------------ Zwei-Faktor-Anmeldung (freiwillig, im Profil)

async function zweiFaktorCodeOk(n, code) {
  const schritt = await totpPruefen(n.zwei_faktor, code);
  if (schritt !== null && schritt > (n.zwei_faktor_schritt ?? 0)) {
    n.zwei_faktor_schritt = schritt;
    return true;
  }
  const c = trim(code).toLowerCase();
  if (!(n.zwei_faktor_codes ?? []).includes(c)) return false;
  n.zwei_faktor_codes = n.zwei_faktor_codes.filter((x) => x !== c);
  protokoll('warnung', 'anmeldung', `Mit Ersatz-Code angemeldet (${n.zwei_faktor_codes.length} übrig)`, n);
  return true;
}

export function zweiFaktorStarten() {
  const n = ich();
  pruefe(!n.zwei_faktor, 'Die Zwei-Faktor-Anmeldung ist schon eingeschaltet.');
  n.zwei_faktor_neu = totpGeheimnis();
  speichern();
  return { geheimnis: n.zwei_faktor_neu, uri: totpUri(n.zwei_faktor_neu, n.email) };
}

export async function zweiFaktorEinschalten(code) {
  const n = ich();
  pruefe(n.zwei_faktor_neu, 'Bitte zuerst „Zwei-Faktor einrichten“ starten.');
  const schritt = await totpPruefen(n.zwei_faktor_neu, code);
  pruefe(schritt !== null, 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben (die Uhr am Handy muss stimmen).');
  const codes = ersatzcodes();
  Object.assign(n, { zwei_faktor: n.zwei_faktor_neu, zwei_faktor_neu: null, zwei_faktor_schritt: schritt, zwei_faktor_codes: codes });
  protokoll('info', 'konten', 'Zwei-Faktor-Anmeldung eingeschaltet', n);
  speichern();
  return { ersatzcodes: [...codes] };
}

export async function zweiFaktorAusschalten(passwort) {
  const n = ich();
  pruefe(await passwortPasst(n, passwort), 'Das Passwort stimmt nicht.');
  Object.assign(n, { zwei_faktor: null, zwei_faktor_neu: null, zwei_faktor_codes: null });
  protokoll('warnung', 'konten', 'Zwei-Faktor-Anmeldung ausgeschaltet', n);
  speichern();
  return true;
}

export function zweiFaktorZuruecksetzen(uid) {
  const { n } = adminNutzer(uid);
  Object.assign(n, { zwei_faktor: null, zwei_faktor_neu: null, zwei_faktor_codes: null });
  protokoll('warnung', 'konten', `Zwei-Faktor-Anmeldung zurückgesetzt: ${anzeigename(n)}`);
  speichern();
  return true;
}

export function einladungPruefen(token) {
  const l = linkPruefen(token, 'registrieren');
  return { rollen: kopie(l.rollen), gueltig_bis: l.gueltig_bis };
}

export async function mitLinkRegistrieren(token, { vorname, nachname, email, passwort, zustimmung } = {}) {
  email = trim(email).toLowerCase();
  neuePersonPruefen({ vorname, nachname, email });
  passwortPruefen(passwort);
  pruefe(zustimmung === true, 'Bitte bestätige, dass du die Datenschutzerklärung und den Hinweis zum Betreiber gelesen hast.');
  const l = linkPruefen(token, 'registrieren');
  const n = kontoErstellen({ vorname, nachname, email, rollen: erlaubteRollen(l.rollen) }, await passwortHash(passwort));
  Object.assign(n, { muss_passwort_aendern: false, hinweis_bestaetigt_am: jetzt() });
  l.nutzungen++;
  protokoll('info', 'konten', `Über Registrierungslink registriert: ${anzeigename(n)} (${email})`, n);
  db.anfragen.filter((a) => a.email === email && a.status === 'offen')
    .forEach((a) => Object.assign(a, { status: 'freigeschaltet', bearbeitet_am: jetzt(), bearbeitet_von: 'Registrierungslink' }));
  sessionStorage.setItem(SITZUNG_KEY, n.id);
  speichern();
  return nutzerSicht(n);
}

export function registrierungslinkErstellen({ tage = 7, max = null, rollen = ['autor'], notiz = '', email = '' } = {}) {
  const admin = brauche('admin');
  tage = Number(tage);
  pruefe(LINK_TAGE.includes(tage), 'Bitte eine Gültigkeit wählen.');
  max = max === null || max === '' ? null : Number(max);
  pruefe(max === null || (Number.isInteger(max) && max >= 1 && max <= 500), 'Bitte angeben, wie oft der Link verwendet werden darf (1 bis 500 oder unbegrenzt).');
  rollen = erlaubteRollen(rollen).filter((r) => LINK_ROLLEN.includes(r));
  pruefe(rollen.length, 'Bitte mindestens eine Rolle wählen.');
  const an = trim(email).toLowerCase();
  pruefe(!an || EMAIL_MUSTER.test(an), 'Bitte eine gültige E-Mail-Adresse angeben oder das Feld leer lassen.');
  const link = appLink(`registrieren/${linkErstellen('registrieren', { rollen, max, tage, notiz: trim(notiz).slice(0, 200) || an, von: anzeigename(admin) })}`);
  protokoll('info', 'konten', `Registrierungslink erstellt: ${tage} Tage, ${max == null ? 'beliebig oft' : `${max}×`}`);
  speichern();
  return { link, mail: false, tage, max };
}

export function registrierungslinks() {
  brauche('admin');
  const jetztIso = new Date().toISOString();
  return (db.links ?? []).filter((l) => l.art === 'registrieren').sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am)).slice(0, 50)
    .map(({ token, max_nutzungen, ...l }) => ({
      ...kopie(l), max: max_nutzungen,
      aktiv: !l.widerrufen_am && l.gueltig_bis >= jetztIso && (max_nutzungen == null || l.nutzungen < max_nutzungen),
    }));
}

export function registrierungslinkWiderrufen(linkId) {
  brauche('admin');
  const l = (db.links ?? []).find((x) => x.id === linkId && x.art === 'registrieren' && !x.widerrufen_am);
  pruefe(l, 'Diesen Link gibt es nicht (mehr) oder er ist schon zurückgezogen.');
  l.widerrufen_am = jetzt();
  speichern();
}

// ------------------------------------------------------------------ Profil

/** Konto fertig eingerichtet? (Autor:innen: Adresse, Bankverbindung, mindestens ein Profil-Link) */
export function profilVollstaendig(n = aktuellerNutzer()) {
  return kontoFertig(n);
}

export function profilSpeichern({ vorname, nachname, email, strasse, plz_ort, kontoinhaber, iban, bic, ...daten }) {
  const n = ich();
  email = trim(email).toLowerCase();
  pruefe(!leer(vorname) && !leer(nachname), 'Bitte Vor- und Nachnamen angeben.');
  pruefe(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Bitte eine gültige E-Mail-Adresse angeben.');
  pruefe(!db.nutzer.some((x) => x.email === email && x.id !== n.id), 'Diese E-Mail-Adresse wird schon verwendet.');
  if (!leer(iban)) pruefe(!ibanFehler(iban), ibanFehler(iban));
  pruefe(bicIstGueltig(bic), 'Der BIC ist ungültig.');
  // Profil-Links auf campus-a-college.at und campus-a.at; ohne Angabe bleibt eine bestehende Verknüpfung erhalten
  const links = {};
  for (const m of MEDIUM_KEYS) {
    const feld = PROFIL_FELD[m];
    links[feld] = daten[feld] === undefined ? (n.profil?.[feld] ?? '') : profilIdAusLink(daten[feld], m);
    pruefe(links[feld] !== null, `Bitte den Link zu deinem Profil auf ${MEDIEN[m].seite} einfügen, z. B. ${MEDIEN[m].basis}/profil/…`);
  }
  Object.assign(n, { vorname: trim(vorname), nachname: trim(nachname), email });
  n.profil = {
    strasse: trim(strasse),
    plz_ort: trim(plz_ort),
    kontoinhaber: trim(kontoinhaber),
    iban: normalizeIban(iban),
    bic: normalizeBic(bic),
    ...links,
  };
  speichern();
  return nutzerSicht(n);
}

export async function passwortAendern(alt, neu) {
  const n = ich();
  pruefe(await passwortPasst(n, alt), 'Das bisherige Passwort stimmt nicht.');
  passwortPruefen(neu);
  n.passwort = await passwortHash(neu);
  n.muss_passwort_aendern = false;
  speichern();
}

// ------------------------------------------------------------------ Leistungen (Entwürfe)

function leistungPruefen(p) {
  pruefe(['kolumne', 'ausserordentlich', 'redigieren'].includes(p.kategorie), 'Bitte wählen, ob Kolumne oder außerordentliche Anerkennungsprämie.');
  pruefe(!leer(p.titel), 'Bitte den Titel des Beitrags angeben.');
  pruefe(/^\d{4}-\d{2}-\d{2}$/.test(p.veroeffentlichung ?? ''), 'Bitte das Datum der Veröffentlichung angeben.');
  if (p.kategorie === 'ausserordentlich') {
    pruefe(!leer(p.vereinbart_mit), 'Bitte angeben, mit wem aus der Redaktion die Anerkennungsprämie vereinbart wurde.');
  }
  const b = Number(p.betrag);
  pruefe(Number.isFinite(b) && b > 0 && b <= 100000 && Math.round(b * 100) === b * 100, 'Bitte einen gültigen Betrag angeben.');
}

export function meineLeistungen() {
  const n = brauche('autor');
  return mitNachweisen(kopie(db.positionen.filter((p) => p.autor_id === n.id)
    .sort((a, b) => a.veroeffentlichung.localeCompare(b.veroeffentlichung))));
}

// ------------------------------------------------------------------ Nachweise zum Redigieren (wie auf dem Server;
// in der Demo im Browser-Speicher, daher kleiner)

const NACHWEIS_TYPEN = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const NACHWEIS_MAX_DEMO = 1024 * 1024;

function mitNachweisen(positionen) {
  return positionen.map((p) => (p.kategorie === 'redigieren' ? {
    ...p,
    nachweise: (db.nachweise ?? []).filter((d) => d.position_id === p.id).map(({ id: nid, name, groesse }) => ({ id: nid, name, groesse })),
  } : p));
}

export function nachweisHochladen(positionId, name, inhalt) {
  const n = brauche('autor');
  const p = db.positionen.find((x) => x.id === positionId && x.autor_id === n.id);
  pruefe(p, 'Diese Leistung gibt es nicht (mehr) oder sie ist schon abgeschickt.');
  pruefe(p.kategorie === 'redigieren', 'Nachweise gibt es nur beim Redigieren.');
  name = trim(String(name ?? '').split(/[/\\]/).pop().replace(/[\x00-\x1f\x7f]+/g, ' '));
  const typ = NACHWEIS_TYPEN[name.split('.').pop().toLowerCase()];
  pruefe(name && typ, 'Diese Datei geht nicht. Erlaubt sind PDF, Word (doc, docx), odt, rtf, txt, Excel (xls, xlsx), ods, png und jpg.');
  const groesse = Math.floor((String(inhalt ?? '').length * 3) / 4);
  pruefe(groesse > 0, 'Die Datei ist leer oder beschädigt.');
  pruefe(groesse <= NACHWEIS_MAX_DEMO, 'In der Demo gehen nur Dateien bis 1 MB (auf dem Server bis 5 MB).');
  db.nachweise ??= [];
  pruefe(db.nachweise.filter((d) => d.position_id === p.id).length < 5, 'Höchstens 5 Nachweise pro Leistung.');
  const d = { id: id(), position_id: p.id, autor_id: n.id, name, typ, groesse, inhalt, erstellt_am: jetzt() };
  db.nachweise.push(d);
  try {
    speichern();
  } catch {
    db.nachweise.pop();
    pruefe(false, 'Der Speicher der Demo ist voll. Bitte eine kleinere Datei nehmen.');
  }
  return { id: d.id, name, groesse };
}

export function nachweisLoeschen(nid) {
  const n = brauche('autor');
  const i = (db.nachweise ?? []).findIndex((d) => d.id === nid && d.autor_id === n.id && db.positionen.some((p) => p.id === d.position_id));
  pruefe(i >= 0, 'Diesen Nachweis gibt es nicht (mehr) oder die Leistung ist schon abgeschickt.');
  db.nachweise.splice(i, 1);
  speichern();
  return true;
}

export function nachweisLaden(nid) {
  const n = ich();
  const d = (db.nachweise ?? []).find((x) => x.id === nid);
  pruefe(d, 'Diesen Nachweis gibt es nicht (mehr).');
  if (d.autor_id !== n.id) {
    const note = db.noten.find((x) => x.positionen.some((p) => p.id === d.position_id));
    pruefe(note && darfSehen(n, note), 'Dafür fehlt dir die Berechtigung.');
  }
  return { name: d.name, typ: d.typ, inhalt: d.inhalt };
}

function nachweiseAufraeumen() {
  const ids = new Set([...db.positionen.map((p) => p.id), ...db.noten.flatMap((x) => x.positionen.map((p) => p.id))]);
  db.nachweise = (db.nachweise ?? []).filter((d) => ids.has(d.position_id));
}

export function leistungSpeichern(daten) {
  const n = brauche('autor');
  const istKolumne = daten.kategorie === 'kolumne';
  // Redigieren (nur campus a college): Anzahl der Texte × Satz pro Text
  const istRedigieren = daten.kategorie === 'redigieren';
  const anzahl = istRedigieren ? Number(daten.anzahl) : 0;
  if (istRedigieren) {
    pruefe(darfRedigieren(n), 'Redigieren ist für dein Konto nicht freigeschaltet. Bitte wende dich an den Admin.');
    pruefe(Number.isInteger(anzahl) && anzahl >= 1 && anzahl <= 1000, 'Bitte die Anzahl der redigierten Texte angeben (1 bis 1000).');
  }
  const p = {
    kategorie: daten.kategorie,
    // Kolumnen haben eine Art der Kolumne (freier Text, optional), außerordentliche Anerkennungsprämien eine Art der Anerkennungsprämie
    art: daten.kategorie === 'ausserordentlich' ? artNormalisieren(daten.art) : '',
    kolumnenart: istKolumne ? artNormalisieren(daten.kolumnenart) : '',
    titel: trim(daten.titel) || (istRedigieren ? `Redigieren (${textAnzahl(anzahl)})` : ''),
    artikel_url: istRedigieren ? '' : trim(daten.artikel_url),
    // ohne Angabe: das (erste) Medium mit Profil-Link
    medium: istRedigieren ? 'college' : (daten.medium ?? verbundeneMedien(n.profil)[0] ?? 'college'),
    anzahl,
    veroeffentlichung: daten.veroeffentlichung,
    ausgabe: trim(daten.ausgabe),
    vereinbart_mit: daten.kategorie === 'ausserordentlich' ? trim(daten.vereinbart_mit) : '',
    // Redigieren: Betrag = Anzahl × eingestellter Satz pro Text
    betrag: istRedigieren ? Math.round(anzahl * einstellungen().honorarsaetze.college.redigieren * 100) / 100 : Number(daten.betrag),
    notiz: trim(daten.notiz),
  };
  leistungPruefen(p);
  if (p.kategorie === 'ausserordentlich') pruefe(p.art, 'Bitte die Art der Anerkennungsprämie angeben.');
  pruefe(istMedium(p.medium), 'Bitte wählen, ob für campus a college oder campus a.');
  // nur Medien mit Profil-Link (Redigieren: Rolle vom Admin, immer campus a college); eine ältere Leistung darf ihr Medium behalten
  const bisher = daten.id ? db.positionen.find((x) => x.id === daten.id && x.autor_id === n.id) : null;
  pruefe(istRedigieren || verbundeneMedien(n.profil).includes(p.medium) || (bisher && mediumOder(bisher.medium) === p.medium),
    nichtVerbunden(p.medium));
  if (p.artikel_url) {
    pruefe(mediumVonArtikel(p.artikel_url) === p.medium || p.artikel_url.startsWith(`${DEMO_ARTIKEL}${p.medium}-`),
      `Der Link zum Artikel ist ungültig (erwartet: ein Artikel auf ${MEDIEN[p.medium].seite}).`);
    pruefe(!verwendeteArtikel(n.id, daten.id).has(p.artikel_url), 'Dieser Artikel ist schon als Leistung gespeichert oder abgerechnet.');
  }
  if (daten.id) {
    const alt = db.positionen.find((x) => x.id === daten.id && x.autor_id === n.id);
    pruefe(alt, 'Diese Leistung gibt es nicht (mehr).');
    Object.assign(alt, p, { geaendert_am: jetzt() });
    if (!istRedigieren) db.nachweise = (db.nachweise ?? []).filter((d) => d.position_id !== alt.id);
    speichern();
    return alt.id;
  }
  const neu = { id: id(), autor_id: n.id, ...p, erstellt_am: jetzt() };
  db.positionen.push(neu);
  speichern();
  return neu.id;
}

export function leistungLoeschen(pid) {
  const n = brauche('autor');
  const i = db.positionen.findIndex((x) => x.id === pid && x.autor_id === n.id);
  pruefe(i >= 0, 'Diese Leistung gibt es nicht (mehr).');
  db.positionen.splice(i, 1);
  nachweiseAufraeumen();
  speichern();
}

// ------------------------------------------------------------------ Prämienabrechnungen: Sichtbarkeit

function darfSehen(n, note) {
  if (hat(n, 'redaktion')) return true;
  if (note.autor_id === n.id) return true;
  return hat(n, 'buchhaltung') && ['angenommen', 'bezahlt'].includes(note.status);
}

function darfZahlungsdaten(n, note) {
  return note.autor_id === n.id || n.rollen.includes('admin')
    || (hat(n, 'buchhaltung') && ['angenommen', 'bezahlt'].includes(note.status));
}

/** Kopie der Note, bei der die Redaktion keine IBAN/Adresse bekommt */
function sicht(n, note) {
  const k = kopie(note);
  k.rueckfrage ??= null;
  k.nachrichten = (db.nachrichten ?? []).filter((m) => m.note_id === note.id).length;
  k.positionen = mitNachweisen(k.positionen);
  k.betrag = summe(k.positionen);
  if (!darfZahlungsdaten(n, note)) {
    delete k.zahlung;
    k.autor = { vorname: k.autor.vorname, nachname: k.autor.nachname, email: k.autor.email };
  }
  return k;
}

function noteHolen(noteId) {
  const note = db.noten.find((x) => x.id === noteId);
  pruefe(note, 'Diese Prämienabrechnung gibt es nicht (mehr).');
  return note;
}

function verlauf(noteId, n, aktion, details = {}) {
  db.verlauf.push({ id: id(), note_id: noteId, akteur_id: n.id, akteur_name: anzeigename(n), aktion, details, am: jetzt() });
}

// ------------------------------------------------------------------ Prämienabrechnungen: Autor:in

// ------------------------------------------------------------------ Artikel auf campus-a-college.at

// Die Demo kann campus-a-college.at nicht abrufen (der Browser blockiert fremde Seiten).
// Sie zeigt deshalb Beispielartikel; im Server-Betrieb kommen hier die echten Artikel.
const DEMO_ARTIKEL = 'demo:'; // gleiche Kennung wie in lib/campus.js

const DEMO_BEISPIELE = {
  college: [
    ['Warum die Mensa-Preise schon wieder steigen', 2, 'Wirtschaft', 'Wien', 'Meinung'],
    ['Mein erster Tag als Schulsprecherin', 6, 'Panorama', 'Wien', 'Meinung'],
    ['Wie viel Handy ist zu viel?', 11, 'Wissenschaft', 'Österreich', 'Fakten'],
    ['Maturaball ohne Schulden: So geht’s', 17, 'Wirtschaft', 'Österreich', 'Fakten'],
    ['Interview: Was eine Klimaforscherin Jugendlichen rät', 24, 'Wissenschaft', 'International', 'Interview'],
    ['Warum ich Lesen wieder lieben gelernt habe', 33, 'Kultur', 'Österreich', 'Meinung'],
  ],
  'campus-a': [
    ['Wohnungssuche im ersten Semester: Ein Erfahrungsbericht', 3, 'Panorama', 'Wien', 'Meinung'],
    ['Was Studiengebühren wirklich kosten würden', 9, 'Politik', 'Österreich', 'Fakten'],
    ['Interview: Wie eine Mensa nachhaltiger wird', 20, 'Wissenschaft', 'Graz', 'Interview'],
  ],
};

function demoArtikel(medium) {
  const tag = (vor) => {
    const d = new Date();
    d.setDate(d.getDate() - vor);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  return DEMO_BEISPIELE[medium].map(([titel, vor, ressort, region, kategorie], i) => ({
    url: `${DEMO_ARTIKEL}${medium}-artikel-${i + 1}`, medium, titel, datum: tag(vor), ressort, region, kategorie,
  }));
}

/** Artikel-Adressen, die schon als Leistung gespeichert oder abgerechnet sind */
function verwendeteArtikel(autorId, ohnePosition = null) {
  const urls = new Set();
  for (const p of db.positionen) if (p.autor_id === autorId && p.artikel_url && p.id !== ohnePosition) urls.add(p.artikel_url);
  for (const x of db.noten) {
    if (x.autor_id !== autorId || (x.status === 'abgelehnt' && x.zurueckgeholt_am)) continue;
    for (const p of x.positionen) if (p.artikel_url) urls.add(p.artikel_url);
  }
  return urls;
}

export async function meineArtikel() {
  const n = brauche('autor');
  const medien = verbundeneMedien(n.profil);
  if (!medien.length) return { verknuepft: false, artikel: [] };
  const verwendet = verwendeteArtikel(n.id);
  const artikel = medien.flatMap(demoArtikel).sort((x, y) => y.datum.localeCompare(x.datum))
    .map((a) => ({ ...a, erfasst: verwendet.has(a.url) }));
  return { verknuepft: true, medien, demo: true, warnung: '', artikel };
}

export function naechsteNummer(n = ich(), jahr = Number(heuteIso().slice(0, 4))) {
  const lfd = db.noten.filter((x) => x.autor_id === n.id && x.jahr === jahr)
    .reduce((m, x) => Math.max(m, x.laufende_nummer), 0) + 1;
  return { jahr, laufendeNummer: lfd, nummer: honorarnoteNummer({ vorname: n.vorname, nachname: n.nachname, jahr, laufendeNummer: lfd }) };
}

/** Honorarnote(n) des aktuellen Monats (für den Hinweis "einmal pro Monat") */
export function notenDiesenMonat() {
  const n = brauche('autor');
  const monat = heuteIso().slice(0, 7);
  return kopie(db.noten.filter((x) => x.autor_id === n.id && x.monat === monat));
}

/** Monatsabrechnung abschicken: gewählte gespeicherte Leistungen -> eine Prämienabrechnung */
export function abrechnungAbschicken(positionIds) {
  const n = brauche('autor');
  const positionen = db.positionen.filter((p) => p.autor_id === n.id && positionIds.includes(p.id));
  pruefe(positionen.length, 'Bitte mindestens eine Leistung auswählen.');
  positionen.forEach(leistungPruefen);
  // campus a und campus a college bekommen getrennte Prämienabrechnungen
  const medium = mediumOder(positionen[0].medium);
  pruefe(positionen.every((p) => mediumOder(p.medium) === medium), 'Leistungen für campus a und campus a college bitte getrennt abschicken.');

  const { jahr, laufendeNummer, nummer } = naechsteNummer(n);
  const note = {
    id: id(),
    nummer,
    jahr,
    laufende_nummer: laufendeNummer,
    monat: heuteIso().slice(0, 7),
    medium,
    autor_id: n.id,
    status: 'eingereicht',
    eingereicht_am: jetzt(),
    // Momentaufnahme: spätere Profiländerungen verändern abgeschickte Noten nicht
    autor: { vorname: n.vorname, nachname: n.nachname, email: n.email, strasse: n.profil.strasse, plz_ort: n.profil.plz_ort },
    zahlung: { kontoinhaber: n.profil.kontoinhaber, iban: n.profil.iban, bic: n.profil.bic },
    empfaenger: { ...db.einstellungen.empfaenger },
    positionen: positionen.map((p) => ({
      id: p.id, kategorie: p.kategorie, art: p.art, kolumnenart: p.kolumnenart ?? '', titel: p.titel, veroeffentlichung: p.veroeffentlichung,
      artikel_url: p.artikel_url ?? '', medium, anzahl: p.anzahl ?? 0, ausgabe: p.ausgabe, vereinbart_mit: p.vereinbart_mit, notiz: p.notiz,
      betrag: p.betrag, betrag_eingereicht: p.betrag, betrag_vermerk: '',
    })),
    ablehnungsgrund: '',
  };
  db.noten.push(note);
  db.positionen = db.positionen.filter((p) => !positionIds.includes(p.id) || p.autor_id !== n.id);
  verlauf(note.id, n, 'eingereicht', { betrag: summe(note.positionen), positionen: note.positionen.length, medium: mediumName(medium) });
  protokoll('info', 'abrechnungen', `Eingereicht: ${note.nummer}`);
  speichern();
  return sicht(n, note);
}

export function meineNoten() {
  const n = brauche('autor');
  return db.noten.filter((x) => x.autor_id === n.id)
    .sort((a, b) => b.eingereicht_am.localeCompare(a.eingereicht_am)).map((x) => sicht(n, x));
}

/** Abgelehnte Note: Leistungen zurück in die Entwürfe holen, um sie korrigiert neu abzuschicken */
/**
 * Leistungen einer abgelehnten Note zurück in „Mein Monat“ der Autor:in (mit eingereichtem Betrag,
 * Medium, Artikel-Link und der Begründung als Hinweis). Die Note gilt danach als zurückgeholt.
 */
function zurueckAnAutor(note, akteur) {
  if (db.nutzer.some((x) => x.id === note.autor_id)) {
    for (const p of note.positionen) {
      const neu = id();
      // Nachweise gehen mit zurück (die Abrechnung behält ihre)
      (db.nachweise ?? []).filter((d) => d.position_id === p.id).forEach((d) => db.nachweise.push({ ...d, id: id(), position_id: neu }));
      db.positionen.push({
        id: neu, autor_id: note.autor_id, kategorie: p.kategorie, art: p.art, kolumnenart: p.kolumnenart ?? '', titel: p.titel,
        veroeffentlichung: p.veroeffentlichung, artikel_url: p.artikel_url ?? '', medium: mediumOder(note.medium), anzahl: p.anzahl ?? 0,
        ausgabe: p.ausgabe, vereinbart_mit: p.vereinbart_mit, betrag: p.betrag_eingereicht, notiz: p.notiz,
        zurueck_nummer: note.nummer, zurueck_grund: note.ablehnungsgrund ?? '', erstellt_am: jetzt(),
      });
    }
  }
  note.zurueckgeholt_am = jetzt();
  verlauf(note.id, akteur, 'zurueckgeholt');
}

/** Ältere abgelehnte Noten (vor der automatischen Rückgabe): Leistungen selbst zurückholen */
export function leistungenZurueckholen(noteId) {
  const n = brauche('autor');
  const note = noteHolen(noteId);
  pruefe(note.autor_id === n.id, 'Dafür fehlt dir die Berechtigung.');
  pruefe(note.status === 'abgelehnt', 'Nur abgelehnte Prämienabrechnungen können überarbeitet werden.');
  pruefe(!note.zurueckgeholt_am, 'Die Leistungen wurden bereits zurückgeholt.');
  zurueckAnAutor(note, n);
  speichern();
}

/** Abgeschickte Prämienabrechnung zurückziehen, solange die Redaktion sie noch nicht angenommen hat */
export function abrechnungZurueckziehen(noteId) {
  const n = brauche('autor');
  const note = noteHolen(noteId);
  pruefe(note.autor_id === n.id, 'Dafür fehlt dir die Berechtigung.');
  pruefe(note.status === 'eingereicht', 'Diese Prämienabrechnung wurde schon geprüft und kann nicht mehr zurückgezogen werden. Bitte schreib der Redaktion.');
  zurueckAnAutor({ ...note, ablehnungsgrund: '' }, n);
  db.noten = db.noten.filter((y) => y.id !== noteId);
  db.kommentare = db.kommentare.filter((k) => k.note_id !== noteId);
  db.nachrichten = (db.nachrichten ?? []).filter((m) => m.note_id !== noteId);
  db.verlauf = db.verlauf.filter((v) => v.note_id !== noteId);
  nachweiseAufraeumen();
  db.loeschprotokoll.push({ id: id(), nummer: note.nummer, geloescht_von: `${anzeigename(n)} (zurückgezogen)`, am: jetzt() });
  protokoll('info', 'abrechnungen', `Zurückgezogen: ${note.nummer}`);
  speichern();
}

// ------------------------------------------------------------------ Prämienabrechnungen: Redaktion

export function alleNoten() {
  const n = brauche('redaktion');
  return db.noten.map((x) => sicht(n, x));
}

const STATUS_WERTE = ['eingereicht', 'angenommen', 'abgelehnt', 'bezahlt'];
const REDAKTION_SORTIERUNG = {
  eingereicht_asc: (a, b) => a.eingereicht_am.localeCompare(b.eingereicht_am),
  eingereicht_desc: (a, b) => b.eingereicht_am.localeCompare(a.eingereicht_am),
  betrag_desc: (a, b) => summe(b.positionen) - summe(a.positionen) || b.eingereicht_am.localeCompare(a.eingereicht_am),
  name: (a, b) => a.nummer.localeCompare(b.nummer),
};

/** Wie auf dem Server: gefiltert und seitenweise */
export function redaktionListe({
  status = '', medium = '', monat = '', suche = '', sortierung = '', rueckfrage = false, limit = 100, offset = 0,
} = {}) {
  const n = brauche('redaktion');
  const q = trim(suche).toLowerCase();
  const treffer = db.noten
    .filter((x) => !STATUS_WERTE.includes(status) || x.status === status)
    .filter((x) => !medium || mediumOder(x.medium) === medium)
    .filter((x) => !/^\d{4}-\d{2}$/.test(monat) || x.monat === monat)
    .filter((x) => !rueckfrage || x.rueckfrage)
    .filter((x) => !q || x.nummer.toLowerCase().includes(q) || JSON.stringify(x.autor).toLowerCase().includes(q))
    .sort(REDAKTION_SORTIERUNG[sortierung] ?? REDAKTION_SORTIERUNG.eingereicht_asc);
  limit = Math.max(1, Math.min(200, Number(limit) || 100));
  return {
    noten: treffer.slice(Number(offset) || 0, (Number(offset) || 0) + limit).map((x) => sicht(n, x)),
    anzahl: treffer.length,
    summe: treffer.reduce((s, x) => s + Math.round(summe(x.positionen) * 100), 0) / 100,
    zaehler: Object.fromEntries(STATUS_WERTE.map((st) => [st, db.noten.filter((x) => x.status === st && (!medium || mediumOder(x.medium) === medium)).length])),
    zu_pruefen_medium: Object.fromEntries(MEDIUM_KEYS.map((m) => [m, db.noten.filter((x) => x.status === 'eingereicht' && mediumOder(x.medium) === m).length])),
    rueckfragen: Object.fromEntries(['offen', 'beantwortet'].map((r) => [r, db.noten.filter((x) => x.rueckfrage === r && (!medium || mediumOder(x.medium) === medium)).length])),
    monate: [...new Set(db.noten.map((x) => x.monat))].sort().reverse().slice(0, 36),
  };
}

/** Zusatzinfos für die Prüfansicht: Jahressumme der Person, schon anderswo abgerechnete Artikel */
export function pruefInfo(noteId) {
  brauche('redaktion');
  const x = noteHolen(noteId);
  const jahr = x.monat.slice(0, 4);
  const imJahr = db.noten.filter((y) => y.autor_id && y.autor_id === x.autor_id && y.monat.startsWith(jahr) && y.status !== 'abgelehnt');
  const doppelt = {};
  for (const p of x.positionen) {
    if (!p.artikel_url) continue;
    const andere = db.noten.find((y) => y.id !== x.id && y.status !== 'abgelehnt' && y.positionen.some((q) => q.artikel_url === p.artikel_url));
    if (andere) doppelt[p.artikel_url] = andere.nummer;
  }
  return {
    jahr, jahr_anzahl: imJahr.length, jahr_summe: imJahr.reduce((s, y) => s + Math.round(summe(y.positionen) * 100), 0) / 100, doppelt,
  };
}

export function ausgezahltImJahr() {
  brauche('buchhaltung');
  const bezahlt = db.noten.filter((x) => x.status === 'bezahlt' && x.bezahlt_am >= `${heuteIso().slice(0, 4)}-01-01`);
  return { anzahl: bezahlt.length, summe: bezahlt.reduce((s, x) => s + Math.round(summe(x.positionen) * 100), 0) / 100 };
}

export function note(noteId) {
  const n = ich();
  const x = noteHolen(noteId);
  pruefe(darfSehen(n, x), 'Dafür fehlt dir die Berechtigung.');
  return sicht(n, x);
}

export function annehmen(noteId) {
  const n = brauche('redaktion');
  const x = noteHolen(noteId);
  pruefe(['eingereicht', 'abgelehnt'].includes(x.status), 'Diese Prämienabrechnung kann nicht angenommen werden.');
  pruefe(!x.zurueckgeholt_am, 'Die Autor:in überarbeitet diese Leistungen bereits in einer neuen Prämienabrechnung.');
  const vorher = x.status;
  Object.assign(x, { status: 'angenommen', ablehnungsgrund: '', entschieden_am: jetzt(), rueckfrage: null });
  verlauf(x.id, n, 'angenommen', { vorher });
  protokoll('info', 'abrechnungen', `Angenommen: ${x.nummer}`);
  speichern();
}

export function ablehnen(noteId, grund) {
  const n = brauche('redaktion');
  pruefe(!leer(grund), 'Bitte eine Begründung für die Ablehnung angeben.');
  const x = noteHolen(noteId);
  pruefe(['eingereicht', 'angenommen'].includes(x.status), 'Diese Prämienabrechnung kann nicht abgelehnt werden.');
  const vorher = x.status;
  Object.assign(x, { status: 'abgelehnt', ablehnungsgrund: trim(grund), entschieden_am: jetzt(), rueckfrage: null });
  verlauf(x.id, n, 'abgelehnt', { vorher, grund: trim(grund) });
  protokoll('info', 'abrechnungen', `Zurückgegeben: ${x.nummer} (${trim(grund)})`);
  // die Leistungen gehen sofort zurück an die Autor:in zum Überarbeiten
  zurueckAnAutor(x, n);
  speichern();
}

export function betragKorrigieren(noteId, positionId, betrag, vermerk) {
  const n = brauche('redaktion');
  pruefe(!leer(vermerk), 'Ein Vermerk zur Betragskorrektur ist Pflicht.');
  const b = Number(betrag);
  pruefe(Number.isFinite(b) && b > 0 && b <= 100000 && Math.round(b * 100) === b * 100, 'Bitte einen gültigen Betrag angeben.');
  const x = noteHolen(noteId);
  pruefe(x.status !== 'bezahlt', 'Bezahlte Prämienabrechnungen können nicht mehr geändert werden.');
  const p = x.positionen.find((y) => y.id === positionId);
  pruefe(p, 'Diese Position gibt es nicht.');
  pruefe(p.betrag !== b, 'Der Betrag ist unverändert.');
  const alt = p.betrag;
  Object.assign(p, { betrag: b, betrag_vermerk: trim(vermerk) });
  verlauf(x.id, n, 'betrag_korrigiert', { position: p.titel, alt, neu: b, vermerk: trim(vermerk) });
  speichern();
}

/** Haken „geprüft“ der Redaktion an einer Leistung setzen oder entfernen */
export function positionPruefen(noteId, positionId, geprueft = true) {
  const n = brauche('redaktion');
  const x = noteHolen(noteId);
  pruefe(x.status !== 'bezahlt', 'Bezahlte Prämienabrechnungen können nicht mehr geändert werden.');
  const p = x.positionen.find((y) => y.id === positionId);
  pruefe(p, 'Diese Leistung gibt es nicht (mehr).');
  Object.assign(p, geprueft === true ? { geprueft_von: anzeigename(n), geprueft_am: jetzt() } : { geprueft_von: null, geprueft_am: null });
  speichern();
}

export function kommentieren(noteId, textInhalt) {
  const n = brauche('redaktion');
  pruefe(!leer(textInhalt), 'Der Kommentar ist leer.');
  noteHolen(noteId);
  db.kommentare.push({ id: id(), note_id: noteId, verfasser_id: n.id, verfasser_name: anzeigename(n), text: trim(textInhalt), am: jetzt() });
  verlauf(noteId, n, 'kommentar');
  speichern();
}

// ------------------------------------------------------------------ Rückfragen (Chat Redaktion ↔ Autor:in)

export function nachrichten(noteId) {
  const n = ich();
  const x = noteHolen(noteId);
  pruefe(darfSehen(n, x), 'Dafür fehlt dir die Berechtigung.');
  return (db.nachrichten ?? []).filter((m) => m.note_id === x.id)
    .map((m) => ({ id: m.id, von_name: m.von_name, von_redaktion: m.von_redaktion, text: m.text, am: m.am, ich: m.von_id === n.id }));
}

function nachrichtSpeichern(x, von, redaktion, text) {
  pruefe(!leer(text), 'Die Nachricht ist leer.');
  db.nachrichten ??= [];
  db.nachrichten.push({ id: id(), note_id: x.id, von_id: von.id, von_name: anzeigename(von), von_redaktion: redaktion, text: trim(text).slice(0, 2000), am: jetzt() });
}

export function nachfragen(noteId, text) {
  const n = brauche('redaktion');
  const x = noteHolen(noteId);
  pruefe(['eingereicht', 'angenommen'].includes(x.status), 'Rückfragen gehen nur, solange die Abrechnung noch nicht bezahlt oder zurückgegeben ist.');
  nachrichtSpeichern(x, n, true, text);
  x.rueckfrage = 'offen';
  verlauf(x.id, n, 'rueckfrage');
  speichern();
  return true;
}

export function rueckfrageBeantworten(noteId, text) {
  const n = ich();
  const x = noteHolen(noteId);
  pruefe(x.autor_id === n.id, 'Dafür fehlt dir die Berechtigung.');
  pruefe(['eingereicht', 'angenommen'].includes(x.status), 'Diese Abrechnung ist schon erledigt.');
  pruefe((db.nachrichten ?? []).some((m) => m.note_id === x.id), 'Zu dieser Abrechnung gibt es keine Rückfrage.');
  nachrichtSpeichern(x, n, false, text);
  x.rueckfrage = 'beantwortet';
  verlauf(x.id, n, 'antwort');
  speichern();
  return true;
}

export function rueckfrageErledigt(noteId) {
  const n = brauche('redaktion');
  const x = noteHolen(noteId);
  x.rueckfrage = null;
  verlauf(x.id, n, 'rueckfrage_erledigt');
  speichern();
  return true;
}

// ------------------------------------------------------------------ Kommandozentrale (Demo: Beispielwerte, kein Server)

export function serverStatus() {
  brauche('admin');
  const nun = Date.now();
  const stunden = Array.from({ length: 48 }, (_, i) => {
    const t = new Date(nun - (47 - i) * 3600000);
    const h = t.getHours();
    const tag = h >= 8 && h <= 22 ? 1 : 0.15; // tagsüber mehr los
    const anfragen = Math.round((20 + 60 * Math.abs(Math.sin((h + i) / 3))) * tag);
    const p = (x) => String(x).padStart(2, '0');
    return {
      stunde: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(h)}`, anfragen,
      mittel_ms: anfragen ? 40 + ((i * 37) % 60) : 0, max_ms: anfragen ? 300 + ((i * 53) % 500) : 0, langsam: 0, fehler: 0,
    };
  });
  const letzte = stunden.slice(-24);
  const anfragen24 = letzte.reduce((s, x) => s + x.anfragen, 0);
  return {
    zeit: jetzt(),
    pruefungen: [
      { stufe: 'ok', titel: 'Verschlüsselung', text: 'Die App läuft über https.' },
      { stufe: 'ok', titel: 'PHP', text: 'PHP 8.3 (Beispiel).' },
      { stufe: 'ok', titel: 'Speicherplatz', text: '18,4 GB frei.' },
      { stufe: 'ok', titel: 'Sicherung', text: 'Letzte Sicherung heute, 03:12.' },
      { stufe: 'warnung', titel: 'E-Mail', text: 'In der Demo werden keine E-Mails verschickt.' },
      { stufe: 'ok', titel: 'Fehler', text: 'Keine Fehler in den letzten 24 Stunden.' },
      { stufe: 'ok', titel: 'Antwortzeit', text: 'Ø 64 ms je Anfrage.' },
    ],
    auslastung: {
      anfragen_24h: anfragen24, mittel_ms_24h: 64, max_ms_24h: Math.max(...letzte.map((x) => x.max_ms)), langsam_24h: 0, fehler_24h: 0,
      stunden, last: [0.42, 0.37, 0.31], kerne: 4, sitzungen: 3, anmeldungen_24h: 7, gesperrt_24h: 0,
      warnungen_24h: db.protokoll?.filter((x) => x.stufe === 'warnung').length ?? 0, fehler_protokoll_24h: 0,
    },
    php: {
      version: '8.3 (Beispiel)', sapi: 'fpm-fcgi', betriebssystem: 'Linux', server: 'Apache', memory_limit: '256M', max_execution_time: 120,
      post_max_size: '64M', upload_max_filesize: '64M', speicher_jetzt: 2097152, speicher_spitze: 4194304, zeitzone: 'Europe/Vienna',
      opcache: { an: true, trefferquote: 99.2 },
      erweiterungen: { pdo_mysql: true, pdo_sqlite: false, mbstring: true, openssl: true, curl: true, json: true, zlib: true, intl: true },
    },
    datenbank: {
      typ: 'Browser-Speicher (Demo)', version: '', schema: VERSION, groesse: new Blob([JSON.stringify(db)]).size,
      tabellen: Object.fromEntries(Object.entries(db).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
    },
    speicher: { frei: 19756849152, gesamt: 53687091200, sicherungen: 0, sicherungen_groesse: 0, letzte_sicherung: null },
    mail: { aktiv: false, server: '', offen: 0, fehlgeschlagen: 0 },
  };
}

export async function leistungstest() {
  brauche('admin');
  const zeit = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t; };
  const lesen = await zeit(() => { for (let i = 0; i < 50; i++) JSON.parse(localStorage.getItem(SPEICHER_KEY) ?? '{}'); }) / 50;
  const rechnen = await zeit(async () => { let h = new Uint8Array(32); for (let i = 0; i < 2000; i++) h = new Uint8Array(await crypto.subtle.digest('SHA-256', h)); });
  const e = (titel, ms, g, text) => ({ titel, ms: Math.round(ms * 10) / 10, stufe: ms <= g[0] ? 'ok' : ms <= g[1] ? 'warnung' : 'fehler', text });
  const ergebnisse = [
    e('Speicher lesen (Demo)', lesen, [5, 30], 'Ø je Lesen aller Daten aus dem Browser-Speicher (50 Mal).'),
    e('Rechenleistung', rechnen, [300, 1200], '2.000 Prüfsummen im Browser berechnen.'),
  ];
  return { zeit: jetzt(), ergebnisse, gesamt_ms: ergebnisse.reduce((s, x) => s + x.ms, 0), demo: true };
}

export async function funktionstest() {
  brauche('admin');
  return {
    zeit: jetzt(), ok: null,
    schritte: [{ titel: 'Demo', stufe: 'warnung', text: 'Der Funktionstest läuft nur auf dem echten Server. In der Demo kannst du den Ablauf mit den Demo-Konten selbst durchklicken.', ms: null }],
  };
}

export function serverAktion() {
  brauche('admin');
  return 'In der Demo gibt es keinen Server – die Aktion läuft nur auf dem echten Server.';
}

export function neuigkeitenGesehen(nid) {
  const n = ich();
  pruefe(/^\d{4}-\d{2}-\d{2}[a-z]?$/.test(String(nid)), 'Ungültiger Eintrag.');
  n.neuigkeiten_gesehen = nid;
  speichern();
  return true;
}

/** Median in Tagen: Einreichen bis Entscheidung, Entscheidung bis Zahlung (bezahlte Abrechnungen der letzten 12 Monate) */
export function ablaufZeiten() {
  ich();
  const seit = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const bezahlt = db.noten.filter((x) => x.status === 'bezahlt' && x.entschieden_am && x.bezahlt_am >= seit);
  const tage = (von, bis) => Math.max(0, (new Date(bis) - new Date(von)) / 86400000);
  const median = (w) => (w.length < 3 ? null : Math.ceil([...w].sort((a, b) => a - b)[Math.floor(w.length / 2)]));
  return {
    pruefung_tage: median(bezahlt.map((x) => tage(x.eingereicht_am, x.entschieden_am))),
    zahlung_tage: median(bezahlt.map((x) => tage(x.entschieden_am.slice(0, 10), x.bezahlt_am))),
    anzahl: bezahlt.length,
  };
}

export function navZaehler() {
  const n = ich();
  return {
    anfragen: hat(n, 'admin') ? db.anfragen.filter((a) => a.status === 'offen').length : 0,
    rueckfragen: db.noten.filter((x) => x.autor_id === n.id && x.rueckfrage === 'offen').length,
    antworten: hat(n, 'redaktion') ? db.noten.filter((x) => x.rueckfrage === 'beantwortet').length : 0,
  };
}

export function kommentare(noteId) {
  brauche('redaktion');
  return kopie(db.kommentare.filter((k) => k.note_id === noteId));
}

export function verlaufVon(noteId) {
  brauche('redaktion');
  return kopie(db.verlauf.filter((v) => v.note_id === noteId).sort((a, b) => b.am.localeCompare(a.am)));
}

// ------------------------------------------------------------------ Buchhaltung

export function offeneZahlungen() {
  const n = brauche('buchhaltung');
  return db.noten.filter((x) => x.status === 'angenommen')
    .sort((a, b) => (a.entschieden_am ?? '').localeCompare(b.entschieden_am ?? '')).map((x) => sicht(n, x));
}

/** monat: "JJJJ-MM" */
export function bezahlteNoten(monat) {
  const n = brauche('buchhaltung');
  return db.noten.filter((x) => x.status === 'bezahlt' && x.bezahlt_am?.startsWith(monat))
    .sort((a, b) => a.bezahlt_am.localeCompare(b.bezahlt_am) || a.nummer.localeCompare(b.nummer))
    .map((x) => sicht(n, x));
}

export function alsBezahltMarkieren(noteId, datum) {
  return alleAlsBezahltMarkieren([noteId], datum)[0];
}

/** Mehrere Noten auf einmal als bezahlt markieren (z. B. eine ganze Woche): alle oder keine */
export function alleAlsBezahltMarkieren(noteIds, datum) {
  const n = brauche('buchhaltung');
  pruefe(/^\d{4}-\d{2}-\d{2}$/.test(datum ?? '') && datum <= heuteIso(), 'Bitte ein gültiges Zahlungsdatum angeben (nicht in der Zukunft).');
  pruefe(Array.isArray(noteIds) && noteIds.length, 'Bitte mindestens eine Prämienabrechnung auswählen.');
  const noten = noteIds.map(noteHolen);
  for (const x of noten) pruefe(x.status === 'angenommen', `${x.nummer}: Nur angenommene Prämienabrechnungen können als bezahlt markiert werden.`);
  for (const x of noten) {
    Object.assign(x, { status: 'bezahlt', bezahlt_am: datum });
    verlauf(x.id, n, 'bezahlt', { datum });
    protokoll('info', 'zahlung', `Als bezahlt markiert: ${x.nummer} (${datum})`);
  }
  speichern();
  return noten.map((x) => sicht(n, x));
}

/** Bezahlte Noten ab einem Zahlungsdatum ("JJJJ-MM-TT") */
export function bezahlteNotenSeit(datum) {
  const n = brauche('buchhaltung');
  return db.noten.filter((x) => x.status === 'bezahlt' && x.bezahlt_am >= datum)
    .sort((a, b) => a.bezahlt_am.localeCompare(b.bezahlt_am) || a.nummer.localeCompare(b.nummer))
    .map((x) => sicht(n, x));
}

// ------------------------------------------------------------------ Admin

export function nutzerListe() {
  brauche('admin');
  return db.nutzer.map(nutzerSicht).sort((a, b) => a.nachname.localeCompare(b.nachname, 'de'));
}

function adminNutzer(uid) {
  const admin = brauche('admin');
  const n = db.nutzer.find((x) => x.id === uid);
  pruefe(n, 'Dieses Konto gibt es nicht (mehr).');
  return { admin, n };
}

const nochEinAdmin = (ohne) => db.nutzer.some((x) => x.id !== ohne && x.aktiv && x.rollen.includes('admin'));

export function rollenSetzen(uid, rollen) {
  const { admin, n } = adminNutzer(uid);
  rollen = erlaubteRollen(rollen);
  if (!rollen.includes('admin')) pruefe(nochEinAdmin(uid), 'Es muss mindestens ein aktives Admin-Konto geben.');
  n.rollen = rollen;
  protokoll('info', 'konten', `Rollen von ${anzeigename(n)}: ${rollen.join(', ') || 'keine'}`);
  speichern();
  return admin.id === uid;
}

export function nutzerAktivSetzen(uid, aktiv) {
  const { admin, n } = adminNutzer(uid);
  pruefe(aktiv || uid !== admin.id, 'Du kannst dein eigenes Konto nicht deaktivieren.');
  if (!aktiv && n.rollen.includes('admin')) pruefe(nochEinAdmin(uid), 'Es muss mindestens ein aktives Admin-Konto geben.');
  n.aktiv = Boolean(aktiv);
  protokoll('info', 'konten', `${aktiv ? 'Konto aktiviert' : 'Konto deaktiviert'}: ${anzeigename(n)}`);
  speichern();
}

/** Admin setzt ein neues Startpasswort; die Person muss es beim nächsten Login ändern. */
export async function passwortZuruecksetzen(uid) {
  const { n } = adminNutzer(uid);
  const passwort = startpasswort();
  n.passwort = await passwortHash(passwort);
  n.muss_passwort_aendern = true;
  protokoll('info', 'konten', `Passwort zurückgesetzt: ${anzeigename(n)}`);
  speichern();
  return zugang(n, passwort);
}

/** E-Mail-Adresse eines Kontos ändern (Admin) */
export function emailAendern(uid, email) {
  const { n } = adminNutzer(uid);
  const neu = trim(email).toLowerCase();
  pruefe(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(neu) && neu.length <= 200, 'Bitte eine gültige E-Mail-Adresse angeben.');
  pruefe(neu !== n.email, 'Das ist schon die E-Mail-Adresse dieses Kontos.');
  pruefe(!db.nutzer.some((x) => x.email === neu && x.id !== uid), 'Diese E-Mail-Adresse wird schon verwendet.');
  protokoll('info', 'konten', `E-Mail von ${anzeigename(n)} geändert: ${n.email} → ${neu}`);
  n.email = neu;
  speichern();
  return { email: neu, mail: false };
}

/** Konto löschen (Datenschutz). Abgeschickte Prämienabrechnungen bleiben für die Buchhaltung erhalten. */
export function nutzerLoeschen(uid) {
  const { admin, n } = adminNutzer(uid);
  pruefe(uid !== admin.id, 'Du kannst dein eigenes Konto nicht löschen.');
  if (n.rollen.includes('admin')) pruefe(nochEinAdmin(uid), 'Es muss mindestens ein aktives Admin-Konto geben.');
  db.nutzer = db.nutzer.filter((x) => x.id !== uid);
  db.positionen = db.positionen.filter((p) => p.autor_id !== uid);
  nachweiseAufraeumen();
  protokoll('warnung', 'konten', `Konto gelöscht: ${anzeigename(n)} (${n.email})`);
  speichern();
}

export function noteLoeschen(noteId) {
  const admin = brauche('admin');
  const x = noteHolen(noteId);
  db.noten = db.noten.filter((y) => y.id !== noteId);
  db.kommentare = db.kommentare.filter((k) => k.note_id !== noteId);
  db.nachrichten = (db.nachrichten ?? []).filter((m) => m.note_id !== noteId);
  db.verlauf = db.verlauf.filter((v) => v.note_id !== noteId);
  nachweiseAufraeumen();
  db.loeschprotokoll.push({ id: id(), nummer: x.nummer, geloescht_von: anzeigename(admin), am: jetzt() });
  protokoll('warnung', 'abrechnungen', `Prämienabrechnung gelöscht: ${x.nummer}`);
  speichern();
}

export function loeschprotokoll() {
  brauche('admin');
  return kopie(db.loeschprotokoll).sort((a, b) => b.am.localeCompare(a.am));
}

export function einstellungen() {
  const e = { ...leereDb().einstellungen, ...kopie(db.einstellungen) };
  delete e.auftraggeber; // früheres SEPA-Konto, nicht mehr verwendet
  delete e.zahlungskonto; // nur über zahlungskonto() für Buchhaltung und Admin
  delete e.wartung; // eigene Funktion wartung()
  e.honorarsaetze = saetzeNormalisieren(e.honorarsaetze); // ältere Sätze ohne Medium gelten für beide
  e.betreiber = betreiberOder(e.betreiber);
  e.rueckgabe_vorlagen = vorlagenNormalisieren(e.rueckgabe_vorlagen);
  e.erinnerung_tage ??= 3;
  return e;
}

/** Angaben für Impressum, Datenschutzerklärung und den Hinweis zum Betreiber – auch ohne Anmeldung */
export function rechtliches() {
  const e = { ...leereDb().einstellungen, ...kopie(db.einstellungen) };
  return { betreiber: betreiberOder(e.betreiber), empfaenger: e.empfaenger, datenschutzKontakt: e.datenschutzKontakt };
}

/** Welche E-Mails dieses Konto bekommen will (in der Demo nur gespeichert, nicht verschickt) */
export function benachrichtigungenSpeichern(wahl) {
  const n = ich();
  n.benachrichtigungen = benachrichtigungenNormalisieren(n, wahl);
  speichern();
  return nutzerSicht(n);
}

/** Hinweis zum Betreiber zur Kenntnis genommen */
export function hinweisBestaetigen() {
  const n = ich();
  n.hinweis_bestaetigt_am = new Date().toISOString();
  speichern();
  return nutzerSicht(n);
}

export function einstellungenSpeichern({
  empfaenger, datenschutzKontakt, honorarsaetze, betreiber, rueckgabe_vorlagen: vorlagen, erinnerung_tage: erinnerung,
}) {
  brauche('admin');
  pruefe(!leer(empfaenger?.name), 'Bitte den Namen des Rechnungsempfängers angeben.');
  let saetze;
  try {
    saetze = saetzeNormalisieren(honorarsaetze ?? db.einstellungen.honorarsaetze ?? STANDARD_SAETZE);
  } catch (e) {
    throw new Fehler(e.message);
  }
  if (erinnerung !== undefined) {
    erinnerung = Number(erinnerung);
    pruefe(Number.isInteger(erinnerung) && erinnerung >= 0 && erinnerung <= 31, 'Erinnerung: bitte 0 bis 31 Tage vor Monatsende angeben (0 = aus).');
  }
  db.einstellungen = {
    ...db.einstellungen,
    erinnerung_tage: erinnerung ?? db.einstellungen.erinnerung_tage ?? 3,
    empfaenger: {
      name: trim(empfaenger.name), strasse: trim(empfaenger.strasse),
      plz_ort: trim(empfaenger.plz_ort), uid: trim(empfaenger.uid),
    },
    datenschutzKontakt: trim(datenschutzKontakt),
    honorarsaetze: saetze,
    betreiber: betreiber ? betreiberPruefen(betreiberOder(db.einstellungen.betreiber), betreiber) : betreiberOder(db.einstellungen.betreiber),
    rueckgabe_vorlagen: vorlagen === undefined ? vorlagenNormalisieren(db.einstellungen.rueckgabe_vorlagen) : vorlagenNormalisieren(vorlagen),
  };
  speichern();
}

// ------------------------------------------------------------------ Protokoll, Übersicht, Sicherungen

const PROTOKOLL_STUFEN = ['info', 'warnung', 'fehler'];
const PROTOKOLL_BEREICHE = {
  anmeldung: 'Anmeldung', konten: 'Konten', abrechnungen: 'Abrechnungen', zahlung: 'Zahlung',
  einstellungen: 'Einstellungen', mail: 'E-Mail', sicherung: 'Sicherung', system: 'System',
};

/** Eintrag ins Protokoll (wie auf dem Server); wer = Konto, sonst die angemeldete Person */
function protokoll(stufe, bereich, text, wer = sitzungsNutzer()) {
  db.protokoll ??= [];
  db.protokoll.push({ id: (db.protokoll.at(-1)?.id ?? 0) + 1, zeit: jetzt(), stufe, bereich, text, wer: wer ? anzeigename(wer) : '', ip: '' });
  if (db.protokoll.length > 2000) db.protokoll.splice(0, db.protokoll.length - 2000);
}

export function protokollLesen({ stufe = '', bereich = '', suche = '', vor = '' } = {}) {
  brauche('admin');
  const q = trim(suche).toLowerCase();
  const passt = (e) => (!bereich || e.bereich === bereich) && (!q || e.text.toLowerCase().includes(q) || e.wer.toLowerCase().includes(q));
  const alle = (db.protokoll ?? []).filter(passt).sort((a, b) => b.zeit.localeCompare(a.zeit) || b.id - a.id);
  const zaehler = { alle: alle.length, ...Object.fromEntries(PROTOKOLL_STUFEN.map((s) => [s, alle.filter((e) => e.stufe === s).length])) };
  const liste = alle.filter((e) => (!stufe || e.stufe === stufe) && (!vor || e.zeit < vor));
  return { eintraege: kopie(liste.slice(0, 100)), mehr: liste.length > 100, zaehler, bereiche: PROTOKOLL_BEREICHE };
}

export function dashboard() {
  brauche('admin');
  const zaehle = (s) => db.noten.filter((x) => x.status === s).length;
  const euro = (noten) => noten.reduce((s, x) => s + Math.round(summe(x.positionen) * 100), 0) / 100;
  const seit = new Date(Date.now() - 7 * 86400000).toISOString();
  const stufe = (s) => (db.protokoll ?? []).filter((e) => e.stufe === s && e.zeit >= seit).length;
  return {
    zahlen: {
      zu_pruefen: zaehle('eingereicht'), zur_zahlung: zaehle('angenommen'), zur_zahlung_summe: euro(db.noten.filter((x) => x.status === 'angenommen')),
      bezahlt_jahr: euro(db.noten.filter((x) => x.status === 'bezahlt' && x.bezahlt_am >= `${heuteIso().slice(0, 4)}-01-01`)),
      anfragen: db.anfragen.filter((a) => a.status === 'offen').length, konten: db.nutzer.filter((x) => x.aktiv).length,
      entwuerfe: db.positionen.length, warnungen: stufe('warnung'), fehler: stufe('fehler'),
    },
    system: { datenbank: 'Demo (Speicher dieses Browsers)', php: '–', version: 'Demo', mail: { aktiv: false, offen: 0, fehlgeschlagen: 0 }, sicherungen: 0, letzte_sicherung: null },
    aktivitaet: kopie([...(db.protokoll ?? [])].sort((a, b) => b.zeit.localeCompare(a.zeit) || b.id - a.id).slice(0, 12)),
  };
}

export function sicherungen() {
  brauche('admin');
  return { liste: [], tage: 30 };
}

export function jetztSichern() {
  brauche('admin');
  throw new Fehler('In der Demo gibt es keine Sicherungen am Server. Unter „Daten“ kannst du die Demo-Daten als Datei sichern.');
}

export const sicherungHerunterladen = jetztSichern;

export function statistik() {
  brauche('admin');
  const zaehle = (s) => db.noten.filter((x) => x.status === s).length;
  return {
    nutzer: db.nutzer.length,
    anfragen: db.anfragen.filter((a) => a.status === 'offen').length,
    entwuerfe: db.positionen.length,
    eingereicht: zaehle('eingereicht'),
    angenommen: zaehle('angenommen'),
    abgelehnt: zaehle('abgelehnt'),
    bezahlt: zaehle('bezahlt'),
  };
}

// E-Mail-Versand gibt es nur auf dem Server; die Demo merkt sich die Einstellungen nur zum Ausprobieren
const MAIL_DEMO = {
  aktiv: false, host: 'smtp.world4you.com', port: 587, verschluesselung: 'starttls', benutzer: '', absender: '',
  absender_name: 'campus a Office', antwort_an: '', zugangsdaten: true, adresse: '',
};

export function mailEinstellungen() {
  brauche('admin');
  const { passwort, ...e } = { ...MAIL_DEMO, ...kopie(db.mail ?? {}) };
  return { ...e, passwort_gesetzt: Boolean(passwort), demo: true, warteschlange: { offen: 0, fehlgeschlagen: 0, gesendet: 0, letzter_fehler: '' } };
}

export function mailEinstellungenSpeichern(d = {}) {
  brauche('admin');
  const alt = db.mail ?? {};
  db.mail = { ...MAIL_DEMO, ...alt, ...Object.fromEntries(Object.keys(MAIL_DEMO).filter((k) => k in d).map((k) => [k, d[k]])) };
  if (d.passwort) db.mail.passwort = String(d.passwort);
  speichern();
}

/** Konto, von dem die Sammelüberweisung (SEPA) abgeht – nur Buchhaltung und Admin */
export function zahlungskonto() {
  brauche('buchhaltung');
  return { name: '', iban: '', bic: '', ...kopie(db.einstellungen.zahlungskonto ?? {}) };
}

export function zahlungskontoSpeichern({ name, iban, bic } = {}) {
  brauche('admin');
  const k = { name: trim(name).slice(0, 70), iban: normalizeIban(iban ?? ''), bic: normalizeBic(bic ?? '') };
  if (k.name || k.iban || k.bic) {
    pruefe(k.name, 'Bitte den Namen des Kontoinhabers angeben.');
    pruefe(!ibanFehler(k.iban), `IBAN des Zahlungskontos: ${ibanFehler(k.iban)}`);
    pruefe(bicIstGueltig(k.bic), 'Der BIC des Zahlungskontos ist ungültig.');
  }
  db.einstellungen.zahlungskonto = k;
  protokoll('warnung', 'einstellungen', `Zahlungskonto geändert: ${k.iban ? `${k.name}, IBAN …${k.iban.slice(-4)}` : 'entfernt'}`);
  speichern();
  return zahlungskonto();
}

export function zahlungsavis() {
  ich();
  throw new Fehler('Das Zahlungsavis als PDF erstellt der Server – in der Demo gibt es das nicht. Auf dem echten Server kommt es auch per E-Mail.');
}

export function pdfMailen() {
  brauche('buchhaltung');
  throw new Fehler('In der Demo werden keine E-Mails verschickt – das geht nur auf dem eigenen Server.');
}

export function testMail() {
  brauche('admin');
  throw new Fehler('In der Demo werden keine E-Mails verschickt – das geht nur auf dem eigenen Server.');
}

/** wie betreiber_pruefen() auf dem Server: neuer Stand, wenn sich Wichtiges ändert */
function betreiberPruefen(alt, neu) {
  const text = (x, max) => String(x ?? '').replace(/\r/g, '').trim().slice(0, max);
  const b = {
    name: trim(neu.name).slice(0, 150), anschrift: text(neu.anschrift, 300), email: trim(neu.email).toLowerCase(),
    telefon: trim(neu.telefon).slice(0, 50), extern: neu.extern !== false, hoster: trim(neu.hoster) || BETREIBER_STANDARD.hoster,
    zusatz_impressum: text(neu.zusatz_impressum, 5000), zusatz_datenschutz: text(neu.zusatz_datenschutz, 5000),
  };
  pruefe(!b.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email), 'Bitte eine gültige E-Mail-Adresse des Betreibers angeben.');
  const geaendert = ['name', 'anschrift', 'extern', 'hoster'].some((k) => b[k] !== alt[k]);
  return { ...b, stand: geaendert || !alt.stand ? new Date().toISOString() : alt.stand };
}

/** Sicherung aller Daten als JSON (enthält IBANs – vertraulich behandeln!) */
export function exportieren() {
  brauche('admin');
  return JSON.stringify(db, null, 2);
}

export function importieren(json) {
  const admin = brauche('admin');
  let d;
  try { d = JSON.parse(json); } catch { throw new Fehler('Die Datei ist keine gültige Sicherung.'); }
  pruefe(d?.version === VERSION && Array.isArray(d.nutzer) && Array.isArray(d.noten), 'Die Datei ist keine gültige Sicherung dieser App.');
  pruefe(d.nutzer.some((x) => x.rollen?.includes('admin') && x.aktiv), 'Die Sicherung enthält kein aktives Admin-Konto.');
  db = { ...leereDb(), ...d };
  speichern();
  // eigenes Konto nicht in der Sicherung -> abmelden
  if (!db.nutzer.some((x) => x.id === admin.id)) abmelden();
}

export async function zuruecksetzen({ demoDaten }) {
  brauche('admin');
  db = leereDb();
  if (demoDaten) await demoDaten(db, { passwortHash });
  speichern();
  abmelden();
}
