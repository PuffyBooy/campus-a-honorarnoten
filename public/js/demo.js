// Beispieldaten für die Vorführung. Alle Demo-Konten haben das Passwort "demo1234".
import { honorarnoteNummer } from './lib/nummer.js';
import { STANDARD_EMPFAENGER } from './store.js';

import { DEMO_PASSWORT } from './demo-konten.js';

function tageZurueck(tage, stunde = 10) {
  const d = new Date();
  d.setDate(d.getDate() - tage);
  d.setHours(stunde, 0, 0, 0);
  return d;
}
const iso = (d) => d.toISOString();
const datum = (d) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};

export async function demoDaten(db, { passwortHash }) {
  const pw = await passwortHash(DEMO_PASSWORT);
  const nutzer = (id, email, vorname, nachname, rollen, profil = {}) => ({
    id, email, vorname, nachname, rollen, aktiv: true, passwort: pw, erstellt_am: iso(tageZurueck(120)),
    profil: { strasse: '', plz_ort: '', kontoinhaber: `${vorname} ${nachname}`, iban: '', bic: '', ...profil },
  });

  const maria = nutzer('demo-maria', 'maria@demo.at', 'Maria', 'Musterfrau', ['autor'],
    { strasse: 'Musterstraße 1/2', plz_ort: '1010 Wien', iban: 'AT611904300234573201', bic: 'BKAUATWW' });
  const jonas = nutzer('demo-jonas', 'jonas@demo.at', 'Jonas', 'Weiß', ['autor'],
    { strasse: 'Lindengasse 12', plz_ort: '8010 Graz', iban: 'DE89370400440532013000', bic: '' });
  const rita = nutzer('demo-rita', 'redaktion@demo.at', 'Rita', 'Redaktion', ['redaktion', 'autor']);
  const bernd = nutzer('demo-bernd', 'buchhaltung@demo.at', 'Bernd', 'Buchhaltung', ['buchhaltung']);
  const alex = nutzer('demo-alex', 'admin@demo.at', 'Alex', 'Admin', ['admin']);
  db.nutzer.push(maria, jonas, rita, bernd, alex);

  let nr = 0;
  // Beispielwerte für „Art der Kolumne“ (freies Textfeld)
  const KOLUMNEN = ['Schulalltag', 'Gesellschaft', 'Kultur'];
  const pos = (kategorie, titel, tage, betrag, extra = {}) => ({
    id: `demo-pos-${++nr}`, kategorie, art: kategorie === 'kolumne' ? '' : 'artikel',
    kolumnenart: kategorie === 'kolumne' ? KOLUMNEN[nr % KOLUMNEN.length] : '', titel,
    veroeffentlichung: datum(tageZurueck(tage)), ausgabe: '', vereinbart_mit: '', notiz: '',
    betrag, betrag_eingereicht: betrag, betrag_vermerk: '', ...extra,
  });

  const zaehler = {};
  const note = (autor, eingereichtVor, positionen, status, extra = {}) => {
    const eingereicht = tageZurueck(eingereichtVor);
    const jahr = eingereicht.getFullYear();
    const key = `${autor.id}-${jahr}`;
    zaehler[key] = (zaehler[key] ?? 0) + 1;
    const n = {
      id: `demo-note-${key}-${zaehler[key]}`,
      nummer: honorarnoteNummer({ vorname: autor.vorname, nachname: autor.nachname, jahr, laufendeNummer: zaehler[key] }),
      jahr, laufende_nummer: zaehler[key], monat: datum(eingereicht).slice(0, 7),
      autor_id: autor.id, status, eingereicht_am: iso(eingereicht),
      autor: { vorname: autor.vorname, nachname: autor.nachname, email: autor.email, strasse: autor.profil.strasse, plz_ort: autor.profil.plz_ort },
      zahlung: { kontoinhaber: autor.profil.kontoinhaber, iban: autor.profil.iban, bic: autor.profil.bic },
      empfaenger: { ...STANDARD_EMPFAENGER },
      positionen, ablehnungsgrund: '', ...extra,
    };
    db.noten.push(n);
    const v = (tage, akteur, aktion, details = {}) => db.verlauf.push({
      id: `demo-v-${db.verlauf.length + 1}`, note_id: n.id, akteur_id: akteur.id,
      akteur_name: `${akteur.vorname} ${akteur.nachname}`, aktion, details, am: iso(tageZurueck(tage, 11)),
    });
    v(eingereichtVor, autor, 'eingereicht', { betrag: positionen.reduce((s, p) => s + p.betrag, 0), positionen: positionen.length });
    return { n, v };
  };

  // Maria: bezahlt, angenommen, dazu offene Entwürfe
  {
    const { v } = note(maria, 62, [
      pos('kolumne', 'Warum wir mehr schlafen sollten', 70, 15),
      pos('kolumne', 'Handyverbot an Schulen?', 66, 15),
      pos('ausserordentlich', 'Interview mit der Bildungsministerin', 64, 60, { vereinbart_mit: 'Rita Redaktion' }),
    ], 'bezahlt', { entschieden_am: iso(tageZurueck(58)), bezahlt_am: datum(tageZurueck(55)) });
    v(58, rita, 'angenommen', { vorher: 'eingereicht' });
    v(55, bernd, 'bezahlt', { datum: datum(tageZurueck(55)) });
  }
  {
    const { n, v } = note(maria, 30, [
      pos('kolumne', 'Die Matura und ich', 40, 15),
      pos('kolumne', 'Klimastreik – was bleibt?', 35, 15),
      pos('ausserordentlich', 'Reportage: Ein Tag im Parlament', 33, 80, { vereinbart_mit: 'Rita Redaktion' }),
    ], 'angenommen', { entschieden_am: iso(tageZurueck(27)) });
    n.positionen[2].betrag = 70;
    n.positionen[2].betrag_vermerk = 'Vereinbart waren 70 € (siehe Mail vom Juni).';
    v(28, rita, 'betrag_korrigiert', { position: n.positionen[2].titel, alt: 80, neu: 70, vermerk: n.positionen[2].betrag_vermerk });
    v(27, rita, 'angenommen', { vorher: 'eingereicht' });
  }
  db.positionen.push(
    { ...pos('kolumne', 'Erste Schulwoche: ein Rückblick', 12, 15), autor_id: maria.id, erstellt_am: iso(tageZurueck(12)) },
    { ...pos('kolumne', 'Was Social Media mit uns macht', 5, 15), autor_id: maria.id, erstellt_am: iso(tageZurueck(5)) },
  );

  // Jonas: abgelehnt, danach neu eingereicht
  {
    const { n, v } = note(jonas, 20, [
      pos('ausserordentlich', 'Fotostrecke Schulball', 24, 120, { art: 'foto', vereinbart_mit: 'Rita Redaktion' }),
    ], 'abgelehnt', { entschieden_am: iso(tageZurueck(18)), ablehnungsgrund: 'Die Fotostrecke wurde nicht veröffentlicht. Bitte nur erschienene Beiträge abrechnen.' });
    v(18, rita, 'abgelehnt', { vorher: 'eingereicht', grund: n.ablehnungsgrund });
  }
  {
    const { n } = note(jonas, 2, [
      pos('kolumne', 'Graz von unten', 9, 15),
      pos('ausserordentlich', 'Porträt: Die jüngste Bürgermeisterin', 6, 50, { vereinbart_mit: 'Rita Redaktion', notiz: 'Inkl. 3 eigene Fotos.' }),
    ], 'eingereicht');
    db.kommentare.push({ id: 'demo-k-1', note_id: n.id, verfasser_id: rita.id, verfasser_name: 'Rita Redaktion',
      text: 'Porträt ist online, Fotos passen. Kann angenommen werden.', am: iso(tageZurueck(1)) });
  }

  // offene Zugangsanfragen zum Ausprobieren des Freischaltens
  db.anfragen.push(
    { id: 'demo-anfrage-1', vorname: 'Sophie', nachname: 'Neumann', email: 'sophie@demo.at',
      nachricht: 'Ich bin in der 7B am BRG Wien und würde gerne Kolumnen über Sport schreiben.',
      status: 'offen', am: iso(tageZurueck(1, 17)) },
    { id: 'demo-anfrage-2', vorname: 'Emil', nachname: 'Huber', email: 'emil@demo.at',
      nachricht: '', status: 'offen', am: iso(tageZurueck(0, 8)) },
  );

  db.einstellungen.datenschutzKontakt = 'office@campus-a-college.at';
  // Beispielkonto für die SEPA-Sammelüberweisung (keine echte Bankverbindung)
  db.einstellungen.auftraggeber = { name: 'campus a Medien GmbH', iban: 'AT322011182345678901', bic: '' };
}
