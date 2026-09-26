// Lokale Datenhaltung im Browser (localStorage).
//
// Alle Daten liegen NUR in diesem Browser auf diesem Gerät. Das ist für eine
// Vorführung (z. B. über GitHub Pages) gedacht. Für den echten Betrieb mit
// mehreren Personen auf verschiedenen Geräten braucht es einen Server – die
// Funktionen hier sind so geschnitten, dass sie 1:1 durch API-Aufrufe
// ersetzt werden können. Jede Funktion prüft Rolle und erlaubte Statuswechsel.
import { artNormalisieren, heuteIso, summe } from './lib/format.js';
import { ibanFehler, normalizeIban, normalizeBic, bicIstGueltig } from './lib/iban.js';
import { honorarnoteNummer } from './lib/nummer.js';
import { STANDARD_SAETZE, saetzeNormalisieren } from './lib/honorarsaetze.js';

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
    noten: [],        // abgeschickte Honorarnoten (Monatsabrechnungen)
    kommentare: [],
    verlauf: [],
    loeschprotokoll: [],
    anfragen: [],     // Zugangsanfragen, die ein Admin freischaltet oder ablehnt
    einstellungen: {
      empfaenger: { ...STANDARD_EMPFAENGER },
      datenschutzKontakt: '',
      honorarsaetze: { ...STANDARD_SAETZE },
      auftraggeber: { name: '', iban: '', bic: '' }, // Konto für SEPA-Sammelüberweisungen
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

export async function initialisieren({ demoDaten } = {}) {
  db = laden();
  if (!db) {
    db = leereDb();
    if (demoDaten) await demoDaten(db, { passwortHash });
    speichern();
  }
}

// ------------------------------------------------------------------ Passwörter

async function pbkdf2(passwort, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function passwortHash(passwort) {
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
  return n?.aktiv ? n : null;
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
  return n;
}
const anzeigename = (n) => `${n.vorname} ${n.nachname}`.trim() || n.email;

/** öffentliche Sicht auf eine:n Nutzer:in (ohne Passwort) */
function nutzerSicht(n) {
  if (!n) return null;
  const { passwort, ...rest } = n;
  return kopie(rest);
}

export function aktuellerNutzer() {
  return nutzerSicht(sitzungsNutzer());
}

export async function anmelden(email, passwort) {
  const n = db.nutzer.find((x) => x.email === trim(email).toLowerCase());
  const ok = n && (await passwortPasst(n, passwort));
  pruefe(ok, 'E-Mail oder Passwort ist falsch.');
  pruefe(n.aktiv, 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.');
  sessionStorage.setItem(SITZUNG_KEY, n.id);
  n.letzter_login = jetzt();
  speichern();
  return nutzerSicht(n);
}

export function abmelden() {
  sessionStorage.removeItem(SITZUNG_KEY);
}

// ------------------------------------------------------------------ Zugang anfragen & freischalten
//
// Man kann sich nicht selbst registrieren: Neue Personen schicken eine Anfrage,
// ein Admin schaltet sie frei. Dabei entsteht ein Startpasswort, das der Admin
// weitergibt und das beim ersten Login geändert werden muss.

const EMAIL_MUSTER = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Gut lesbares Startpasswort ohne verwechselbare Zeichen (0/O, 1/l/I) */
export function startpasswort(laenge = 10) {
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
export function zugangAnfragen({ vorname, nachname, email, nachricht }) {
  email = trim(email).toLowerCase();
  neuePersonPruefen({ vorname, nachname, email });
  pruefe(!db.anfragen.some((a) => a.email === email && a.status === 'offen'),
    'Für diese E-Mail-Adresse gibt es schon eine offene Anfrage. Bitte etwas Geduld.');
  db.anfragen.push({
    id: id(), vorname: trim(vorname), nachname: trim(nachname), email,
    nachricht: trim(nachricht).slice(0, 1000), status: 'offen', am: jetzt(),
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

const erlaubteRollen = (rollen) => ['autor', 'redaktion', 'buchhaltung', 'admin'].filter((r) => rollen.includes(r));

/** Anfrage freischalten -> Konto mit Startpasswort. Gibt E-Mail und Startpasswort zurück. */
export async function anfrageFreischalten(anfrageId, rollen = ['autor']) {
  const admin = brauche('admin');
  const a = anfrageHolen(anfrageId);
  rollen = erlaubteRollen(rollen);
  pruefe(rollen.length, 'Bitte mindestens eine Rolle wählen.');
  neuePersonPruefen(a);
  const passwort = startpasswort();
  const hash = await passwortHash(passwort);
  kontoErstellen({ ...a, rollen }, hash);
  Object.assign(a, { status: 'freigeschaltet', bearbeitet_am: jetzt(), bearbeitet_von: anzeigename(admin) });
  speichern();
  return { email: a.email, vorname: a.vorname, passwort };
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
  kontoErstellen({ vorname, nachname, email, rollen }, await passwortHash(passwort));
  // eine evtl. offene Anfrage derselben Person ist damit erledigt
  db.anfragen.filter((a) => a.email === email && a.status === 'offen')
    .forEach((a) => Object.assign(a, { status: 'freigeschaltet', bearbeitet_am: jetzt() }));
  speichern();
  return { email, vorname: trim(vorname), passwort };
}

/** Nach Login mit Startpasswort: eigenes Passwort festlegen */
export async function erstesPasswortSetzen(neu) {
  const n = ich();
  pruefe(n.muss_passwort_aendern, 'Bitte das Passwort im Profil ändern.');
  passwortPruefen(neu);
  pruefe(!(await passwortPasst(n, neu)), 'Bitte ein neues Passwort wählen, nicht das Startpasswort.');
  n.passwort = await passwortHash(neu);
  n.muss_passwort_aendern = false;
  speichern();
}

// ------------------------------------------------------------------ Profil

export function profilVollstaendig(n = aktuellerNutzer()) {
  const p = n?.profil ?? {};
  return !leer(p.strasse) && !leer(p.plz_ort) && !leer(p.kontoinhaber) && !ibanFehler(p.iban);
}

export function profilSpeichern({ vorname, nachname, email, strasse, plz_ort, kontoinhaber, iban, bic }) {
  const n = ich();
  email = trim(email).toLowerCase();
  pruefe(!leer(vorname) && !leer(nachname), 'Bitte Vor- und Nachnamen angeben.');
  pruefe(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Bitte eine gültige E-Mail-Adresse angeben.');
  pruefe(!db.nutzer.some((x) => x.email === email && x.id !== n.id), 'Diese E-Mail-Adresse wird schon verwendet.');
  if (!leer(iban)) pruefe(!ibanFehler(iban), ibanFehler(iban));
  pruefe(bicIstGueltig(bic), 'Der BIC ist ungültig.');
  Object.assign(n, { vorname: trim(vorname), nachname: trim(nachname), email });
  n.profil = {
    strasse: trim(strasse),
    plz_ort: trim(plz_ort),
    kontoinhaber: trim(kontoinhaber),
    iban: normalizeIban(iban),
    bic: normalizeBic(bic),
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

function positionPruefen(p) {
  pruefe(['kolumne', 'ausserordentlich'].includes(p.kategorie), 'Bitte wählen, ob Kolumne oder außerordentliches Honorar.');
  pruefe(!leer(p.titel), 'Bitte den Titel des Beitrags angeben.');
  pruefe(/^\d{4}-\d{2}-\d{2}$/.test(p.veroeffentlichung ?? ''), 'Bitte das Datum der Veröffentlichung angeben.');
  if (p.kategorie === 'ausserordentlich') {
    pruefe(!leer(p.vereinbart_mit), 'Bitte angeben, mit wem aus der Redaktion das Honorar vereinbart wurde.');
  }
  const b = Number(p.betrag);
  pruefe(Number.isFinite(b) && b > 0 && b <= 100000 && Math.round(b * 100) === b * 100, 'Bitte einen gültigen Betrag angeben.');
}

export function meineLeistungen() {
  const n = brauche('autor');
  return kopie(db.positionen.filter((p) => p.autor_id === n.id)
    .sort((a, b) => a.veroeffentlichung.localeCompare(b.veroeffentlichung)));
}

export function leistungSpeichern(daten) {
  const n = brauche('autor');
  const istKolumne = daten.kategorie === 'kolumne';
  const p = {
    kategorie: daten.kategorie,
    // Kolumnen haben eine Art der Kolumne (freier Text), außerordentliche Honorare eine Art des Honorars
    art: istKolumne ? '' : artNormalisieren(daten.art),
    kolumnenart: istKolumne ? artNormalisieren(daten.kolumnenart) : '',
    titel: trim(daten.titel),
    veroeffentlichung: daten.veroeffentlichung,
    ausgabe: trim(daten.ausgabe),
    vereinbart_mit: daten.kategorie === 'ausserordentlich' ? trim(daten.vereinbart_mit) : '',
    betrag: Number(daten.betrag),
    notiz: trim(daten.notiz),
  };
  positionPruefen(p);
  if (istKolumne) pruefe(p.kolumnenart, 'Bitte die Art der Kolumne angeben.');
  else pruefe(p.art, 'Bitte die Art des Honorars angeben.');
  if (daten.id) {
    const alt = db.positionen.find((x) => x.id === daten.id && x.autor_id === n.id);
    pruefe(alt, 'Diese Leistung gibt es nicht (mehr).');
    Object.assign(alt, p, { geaendert_am: jetzt() });
  } else {
    db.positionen.push({ id: id(), autor_id: n.id, ...p, erstellt_am: jetzt() });
  }
  speichern();
}

export function leistungLoeschen(pid) {
  const n = brauche('autor');
  const i = db.positionen.findIndex((x) => x.id === pid && x.autor_id === n.id);
  pruefe(i >= 0, 'Diese Leistung gibt es nicht (mehr).');
  db.positionen.splice(i, 1);
  speichern();
}

// ------------------------------------------------------------------ Honorarnoten: Sichtbarkeit

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
  k.betrag = summe(k.positionen);
  if (!darfZahlungsdaten(n, note)) {
    delete k.zahlung;
    k.autor = { vorname: k.autor.vorname, nachname: k.autor.nachname, email: k.autor.email };
  }
  return k;
}

function noteHolen(noteId) {
  const note = db.noten.find((x) => x.id === noteId);
  pruefe(note, 'Diese Honorarnote gibt es nicht (mehr).');
  return note;
}

function verlauf(noteId, n, aktion, details = {}) {
  db.verlauf.push({ id: id(), note_id: noteId, akteur_id: n.id, akteur_name: anzeigename(n), aktion, details, am: jetzt() });
}

// ------------------------------------------------------------------ Honorarnoten: Autor:in

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

/** Monatsabrechnung abschicken: gewählte gespeicherte Leistungen -> eine Honorarnote */
export function abrechnungAbschicken(positionIds) {
  const n = brauche('autor');
  pruefe(profilVollstaendig(n), 'Bitte zuerst Adresse und Bankverbindung im Profil ergänzen.');
  const positionen = db.positionen.filter((p) => p.autor_id === n.id && positionIds.includes(p.id));
  pruefe(positionen.length, 'Bitte mindestens eine Leistung auswählen.');
  positionen.forEach(positionPruefen);

  const { jahr, laufendeNummer, nummer } = naechsteNummer(n);
  const note = {
    id: id(),
    nummer,
    jahr,
    laufende_nummer: laufendeNummer,
    monat: heuteIso().slice(0, 7),
    autor_id: n.id,
    status: 'eingereicht',
    eingereicht_am: jetzt(),
    // Momentaufnahme: spätere Profiländerungen verändern abgeschickte Noten nicht
    autor: { vorname: n.vorname, nachname: n.nachname, email: n.email, strasse: n.profil.strasse, plz_ort: n.profil.plz_ort },
    zahlung: { kontoinhaber: n.profil.kontoinhaber, iban: n.profil.iban, bic: n.profil.bic },
    empfaenger: { ...db.einstellungen.empfaenger },
    positionen: positionen.map((p) => ({
      id: p.id, kategorie: p.kategorie, art: p.art, kolumnenart: p.kolumnenart ?? '', titel: p.titel, veroeffentlichung: p.veroeffentlichung,
      ausgabe: p.ausgabe, vereinbart_mit: p.vereinbart_mit, notiz: p.notiz,
      betrag: p.betrag, betrag_eingereicht: p.betrag, betrag_vermerk: '',
    })),
    ablehnungsgrund: '',
  };
  db.noten.push(note);
  db.positionen = db.positionen.filter((p) => !positionIds.includes(p.id) || p.autor_id !== n.id);
  verlauf(note.id, n, 'eingereicht', { betrag: summe(note.positionen), positionen: note.positionen.length });
  speichern();
  return sicht(n, note);
}

export function meineNoten() {
  const n = brauche('autor');
  return db.noten.filter((x) => x.autor_id === n.id)
    .sort((a, b) => b.eingereicht_am.localeCompare(a.eingereicht_am)).map((x) => sicht(n, x));
}

/** Abgelehnte Note: Leistungen zurück in die Entwürfe holen, um sie korrigiert neu abzuschicken */
export function leistungenZurueckholen(noteId) {
  const n = brauche('autor');
  const note = noteHolen(noteId);
  pruefe(note.autor_id === n.id, 'Dafür fehlt dir die Berechtigung.');
  pruefe(note.status === 'abgelehnt', 'Nur abgelehnte Honorarnoten können überarbeitet werden.');
  pruefe(!note.zurueckgeholt_am, 'Die Leistungen wurden bereits zurückgeholt.');
  for (const p of note.positionen) {
    db.positionen.push({
      id: id(), autor_id: n.id, kategorie: p.kategorie, art: p.art, kolumnenart: p.kolumnenart ?? '', titel: p.titel,
      veroeffentlichung: p.veroeffentlichung, ausgabe: p.ausgabe, vereinbart_mit: p.vereinbart_mit,
      betrag: p.betrag_eingereicht, notiz: p.notiz, erstellt_am: jetzt(),
    });
  }
  note.zurueckgeholt_am = jetzt();
  verlauf(note.id, n, 'zurueckgeholt');
  speichern();
}

// ------------------------------------------------------------------ Honorarnoten: Redaktion

export function alleNoten() {
  const n = brauche('redaktion');
  return db.noten.map((x) => sicht(n, x));
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
  pruefe(['eingereicht', 'abgelehnt'].includes(x.status), 'Diese Honorarnote kann nicht angenommen werden.');
  pruefe(!x.zurueckgeholt_am, 'Die Autor:in überarbeitet diese Leistungen bereits in einer neuen Honorarnote.');
  const vorher = x.status;
  Object.assign(x, { status: 'angenommen', ablehnungsgrund: '', entschieden_am: jetzt() });
  verlauf(x.id, n, 'angenommen', { vorher });
  speichern();
}

export function ablehnen(noteId, grund) {
  const n = brauche('redaktion');
  pruefe(!leer(grund), 'Bitte eine Begründung für die Ablehnung angeben.');
  const x = noteHolen(noteId);
  pruefe(['eingereicht', 'angenommen'].includes(x.status), 'Diese Honorarnote kann nicht abgelehnt werden.');
  const vorher = x.status;
  Object.assign(x, { status: 'abgelehnt', ablehnungsgrund: trim(grund), entschieden_am: jetzt() });
  verlauf(x.id, n, 'abgelehnt', { vorher, grund: trim(grund) });
  speichern();
}

export function betragKorrigieren(noteId, positionId, betrag, vermerk) {
  const n = brauche('redaktion');
  pruefe(!leer(vermerk), 'Ein Vermerk zur Betragskorrektur ist Pflicht.');
  const b = Number(betrag);
  pruefe(Number.isFinite(b) && b > 0 && b <= 100000 && Math.round(b * 100) === b * 100, 'Bitte einen gültigen Betrag angeben.');
  const x = noteHolen(noteId);
  pruefe(x.status !== 'bezahlt', 'Bezahlte Honorarnoten können nicht mehr geändert werden.');
  const p = x.positionen.find((y) => y.id === positionId);
  pruefe(p, 'Diese Position gibt es nicht.');
  pruefe(p.betrag !== b, 'Der Betrag ist unverändert.');
  const alt = p.betrag;
  Object.assign(p, { betrag: b, betrag_vermerk: trim(vermerk) });
  verlauf(x.id, n, 'betrag_korrigiert', { position: p.titel, alt, neu: b, vermerk: trim(vermerk) });
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
  const n = brauche('buchhaltung');
  pruefe(/^\d{4}-\d{2}-\d{2}$/.test(datum ?? '') && datum <= heuteIso(), 'Bitte ein gültiges Zahlungsdatum angeben (nicht in der Zukunft).');
  const x = noteHolen(noteId);
  pruefe(x.status === 'angenommen', 'Nur angenommene Honorarnoten können als bezahlt markiert werden.');
  Object.assign(x, { status: 'bezahlt', bezahlt_am: datum });
  verlauf(x.id, n, 'bezahlt', { datum });
  speichern();
  return sicht(n, x);
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
  speichern();
  return admin.id === uid;
}

export function nutzerAktivSetzen(uid, aktiv) {
  const { admin, n } = adminNutzer(uid);
  pruefe(aktiv || uid !== admin.id, 'Du kannst dein eigenes Konto nicht deaktivieren.');
  if (!aktiv && n.rollen.includes('admin')) pruefe(nochEinAdmin(uid), 'Es muss mindestens ein aktives Admin-Konto geben.');
  n.aktiv = Boolean(aktiv);
  speichern();
}

/** Admin setzt ein neues Startpasswort; die Person muss es beim nächsten Login ändern. */
export async function passwortZuruecksetzen(uid) {
  const { n } = adminNutzer(uid);
  const passwort = startpasswort();
  n.passwort = await passwortHash(passwort);
  n.muss_passwort_aendern = true;
  speichern();
  return { email: n.email, vorname: n.vorname, passwort };
}

/** Konto löschen (Datenschutz). Abgeschickte Honorarnoten bleiben für die Buchhaltung erhalten. */
export function nutzerLoeschen(uid) {
  const { admin, n } = adminNutzer(uid);
  pruefe(uid !== admin.id, 'Du kannst dein eigenes Konto nicht löschen.');
  if (n.rollen.includes('admin')) pruefe(nochEinAdmin(uid), 'Es muss mindestens ein aktives Admin-Konto geben.');
  db.nutzer = db.nutzer.filter((x) => x.id !== uid);
  db.positionen = db.positionen.filter((p) => p.autor_id !== uid);
  speichern();
}

export function alleNotenAdmin() {
  const n = brauche('admin');
  return db.noten.map((x) => sicht(n, x)).sort((a, b) => b.eingereicht_am.localeCompare(a.eingereicht_am));
}

export function noteLoeschen(noteId) {
  const admin = brauche('admin');
  const x = noteHolen(noteId);
  db.noten = db.noten.filter((y) => y.id !== noteId);
  db.kommentare = db.kommentare.filter((k) => k.note_id !== noteId);
  db.verlauf = db.verlauf.filter((v) => v.note_id !== noteId);
  db.loeschprotokoll.push({ id: id(), nummer: x.nummer, geloescht_von: anzeigename(admin), am: jetzt() });
  speichern();
}

export function loeschprotokoll() {
  brauche('admin');
  return kopie(db.loeschprotokoll).sort((a, b) => b.am.localeCompare(a.am));
}

/** Einstellungen; das Auftraggeberkonto sehen nur Buchhaltung und Admin */
export function einstellungen() {
  const e = { ...leereDb().einstellungen, ...kopie(db.einstellungen) };
  const n = sitzungsNutzer();
  if (!n || !hat(n, 'buchhaltung')) delete e.auftraggeber;
  return e;
}

export function einstellungenSpeichern({ empfaenger, datenschutzKontakt, honorarsaetze }) {
  brauche('admin');
  pruefe(!leer(empfaenger?.name), 'Bitte den Namen des Rechnungsempfängers angeben.');
  let saetze;
  try {
    saetze = saetzeNormalisieren(honorarsaetze ?? db.einstellungen.honorarsaetze ?? STANDARD_SAETZE);
  } catch (e) {
    throw new Fehler(e.message);
  }
  db.einstellungen = {
    ...db.einstellungen,
    empfaenger: {
      name: trim(empfaenger.name), strasse: trim(empfaenger.strasse),
      plz_ort: trim(empfaenger.plz_ort), uid: trim(empfaenger.uid),
    },
    datenschutzKontakt: trim(datenschutzKontakt),
    honorarsaetze: saetze,
  };
  speichern();
}

/** Konto, von dem die Buchhaltung Sammelüberweisungen macht */
export function auftraggeberSpeichern({ name, iban, bic }) {
  brauche('buchhaltung');
  pruefe(!leer(name), 'Bitte den Kontoinhaber angeben.');
  pruefe(!ibanFehler(iban), ibanFehler(iban));
  pruefe(bicIstGueltig(bic), 'Der BIC ist ungültig.');
  db.einstellungen = {
    ...db.einstellungen,
    auftraggeber: { name: trim(name).slice(0, 70), iban: normalizeIban(iban), bic: normalizeBic(bic) },
  };
  speichern();
}

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
