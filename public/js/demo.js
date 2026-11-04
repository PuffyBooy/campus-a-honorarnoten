// Beispieldaten für die Vorführung. Alle Demo-Konten haben das Passwort "demo1234".
import { BETREIBER_STANDARD } from './lib/rechtliches.js';
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

// Profile der Demo-Konten (Autor:innen brauchen Adresse, Bankverbindung und einen Profil-Link)
const DEMO_PROFILE = {
  'maria@demo.at': { strasse: 'Musterstraße 1/2', plz_ort: '1010 Wien', iban: 'AT611904300234573201', bic: 'BKAUATWW',
    campus_profil: 'de00000000000000a001' }, // Beispiel-Verknüpfung mit campus-a-college.at
  'jonas@demo.at': { strasse: 'Lindengasse 12', plz_ort: '8010 Graz', iban: 'DE89370400440532013000', bic: '',
    campus_profil: 'de00000000000000a002', campus_a_profil: 'de00000000000000b002' }, // schreibt für beide Medien
  'redaktion@demo.at': { strasse: 'Stiftgasse 6/1/2', plz_ort: '1070 Wien', iban: 'AT483200000012345864', bic: '',
    campus_a_profil: 'de00000000000000b003' },
};

/**
 * Ältere Demo-Daten im Browser: fehlende Profilangaben der Demo-Konten ergänzen, damit z. B. Rita
 * nicht auf „Konto einrichten“ landet. Vorhandene Eingaben bleiben. Liefert true, wenn sich etwas geändert hat.
 */
export function demoKontenAktualisieren(db) {
  let geaendert = false;
  for (const n of db.nutzer ?? []) {
    const profil = DEMO_PROFILE[n.email];
    if (!profil) continue;
    for (const [feld, wert] of Object.entries(profil)) {
      if (!String(n.profil?.[feld] ?? '').trim() && wert) {
        n.profil = { ...n.profil, [feld]: wert };
        geaendert = true;
      }
    }
    if (!n.profil.kontoinhaber) n.profil.kontoinhaber = `${n.vorname} ${n.nachname}`.trim();
  }
  // ältere Demo-Daten: Beispiel-Betreiber für Impressum, Datenschutz und Hinweis
  if (db.einstellungen && !db.einstellungen.betreiber) {
    db.einstellungen.betreiber = BEISPIEL_BETREIBER();
    geaendert = true;
  }
  // ältere Demo-Daten: Maria bekommt einmalig die Rolle „Redigieren“ (danach entscheidet der Admin)
  if (!db.demoRedigierenRolle) {
    const maria = (db.nutzer ?? []).find((n) => n.email === 'maria@demo.at');
    if (maria && !maria.rollen.includes('redigieren')) maria.rollen = [...maria.rollen, 'redigieren'];
    db.demoRedigierenRolle = true;
    geaendert = true;
  }
  return geaendert;
}

export async function demoDaten(db, { passwortHash }) {
  const pw = await passwortHash(DEMO_PASSWORT);
  const nutzer = (id, email, vorname, nachname, rollen, profil = {}) => ({
    id, email, vorname, nachname, rollen, aktiv: true, passwort: pw, erstellt_am: iso(tageZurueck(120)),
    profil: { strasse: '', plz_ort: '', kontoinhaber: `${vorname} ${nachname}`, iban: '', bic: '', ...profil },
  });

  // Maria hat vom Admin auch die Rolle „Redigieren“
  const maria = nutzer('demo-maria', 'maria@demo.at', 'Maria', 'Musterfrau', ['autor', 'redigieren'], DEMO_PROFILE['maria@demo.at']);
  const jonas = nutzer('demo-jonas', 'jonas@demo.at', 'Jonas', 'Weiß', ['autor'], DEMO_PROFILE['jonas@demo.at']);
  const rita = nutzer('demo-rita', 'redaktion@demo.at', 'Rita', 'Redaktion', ['redaktion', 'autor'], DEMO_PROFILE['redaktion@demo.at']);
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
    medium: 'college',
    artikel_url: `demo:${extra.medium ?? 'college'}-beitrag-${nr}`, // Beispiel-Verknüpfung mit einem Artikel auf campus-a-college.at
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
      jahr, laufende_nummer: zaehler[key], monat: datum(eingereicht).slice(0, 7), medium: positionen[0].medium,
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
  // eingereicht, zum Ausprobieren der Prüfansicht: ein Betrag über dem Satz, eine Leistung ohne Artikel-Link
  note(maria, 4, [
    pos('kolumne', 'Mensa-Check: Was taugt das Essen?', 9, 18),
    pos('ausserordentlich', 'Umfrage: Wie gestresst sind wir?', 7, 40, { vereinbart_mit: 'Rita Redaktion', artikel_url: '' }),
  ], 'eingereicht');
  db.positionen.push(
    { ...pos('kolumne', 'Erste Schulwoche: ein Rückblick', 12, 15), autor_id: maria.id, erstellt_am: iso(tageZurueck(12)) },
    { ...pos('kolumne', 'Was Social Media mit uns macht', 5, 15), autor_id: maria.id, erstellt_am: iso(tageZurueck(5)) },
    // Redigieren: Anzahl der Texte × 2 € (nur campus a college)
    { ...pos('redigieren', 'Redigieren September', 3, 14, { anzahl: 7, artikel_url: '' }), art: '', kolumnenart: '', autor_id: maria.id, erstellt_am: iso(tageZurueck(3)) },
  );

  // Jonas: abgelehnt, danach neu eingereicht
  {
    const { n, v } = note(jonas, 20, [
      pos('ausserordentlich', 'Fotostrecke Schulball', 24, 120, { art: 'foto', vereinbart_mit: 'Rita Redaktion', artikel_url: '' }),
    ], 'abgelehnt', { entschieden_am: iso(tageZurueck(18)), ablehnungsgrund: 'Die Fotostrecke wurde nicht veröffentlicht. Bitte nur erschienene Beiträge abrechnen.' });
    v(18, rita, 'abgelehnt', { vorher: 'eingereicht', grund: n.ablehnungsgrund });
    // beim Ablehnen gehen die Leistungen automatisch zurück an die Autor:in
    n.zurueckgeholt_am = iso(tageZurueck(18));
    v(18, rita, 'zurueckgeholt');
    db.positionen.push(...n.positionen.map((p) => ({
      ...p, id: `${p.id}-zurueck`, autor_id: jonas.id, betrag: p.betrag_eingereicht,
      zurueck_nummer: n.nummer, zurueck_grund: n.ablehnungsgrund, erstellt_am: iso(tageZurueck(18)),
    })));
  }
  {
    const { n } = note(jonas, 2, [
      pos('kolumne', 'Graz von unten', 9, 15, { medium: 'campus-a' }),
      pos('ausserordentlich', 'Porträt: Die jüngste Bürgermeisterin', 6, 50,
        { medium: 'campus-a', vereinbart_mit: 'Rita Redaktion', notiz: 'Inkl. 3 eigene Fotos.' }),
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

  // Beispiel-Protokoll für Admin → Protokoll und die Übersicht
  db.protokoll = [
    [9, 8, 'info', 'sicherung', 'Tägliche Sicherung erstellt: honorarnoten-Beispiel.sql (184,2 KB)', ''],
    [6, 9, 'info', 'anmeldung', 'Angemeldet', 'Rita Redaktion'],
    [5, 22, 'warnung', 'anmeldung', 'Anmeldung fehlgeschlagen für jonas@demo.at', 'Jonas Weiß'],
    [5, 22, 'info', 'anmeldung', 'Angemeldet', 'Jonas Weiß'],
    [4, 13, 'warnung', 'mail', 'E-Mail „Deine Prämienabrechnung ist bezahlt“ an maria@demo.at nicht verschickt (Versuch 1 von 5): Mailserver: 421 Too many connections', ''],
    [3, 10, 'fehler', 'mail', 'E-Mail „Neue Zugangsanfrage“ an admin@demo.at nicht verschickt (aufgegeben nach 5 Versuchen): Anmeldung beim Mailserver fehlgeschlagen', ''],
    [2, 12, 'info', 'abrechnungen', 'Eingereicht: WEISS-JO-2026-02', 'Jonas Weiß'],
    [1, 11, 'info', 'konten', 'Zugang angefragt: Sophie Neumann (sophie@demo.at)', 'Sophie Neumann'],
    [0, 8, 'info', 'sicherung', 'Tägliche Sicherung erstellt: honorarnoten-Beispiel.sql (186,0 KB)', ''],
  ].map(([tage, stunde, stufe, bereich, text, wer], i) => ({ id: i + 1, zeit: iso(tageZurueck(tage, stunde)), stufe, bereich, text, wer, ip: '' }));

  db.einstellungen.datenschutzKontakt = 'office@campus-a-college.at';
  // Beispielkonto für die SEPA-Datei der Buchhaltung
  db.einstellungen.zahlungskonto = { name: 'campus a Medien GmbH', iban: 'AT022050302101023600', bic: 'SPIHAT22XXX' };
  db.einstellungen.betreiber = BEISPIEL_BETREIBER();

  // Redigieren mitzählen: Beispielverlauf der letzten Monate (Maria und Jonas), diesen Monat ein paar per Erweiterung
  jonas.rollen = [...jonas.rollen, 'redigieren'];
  db.redigieren = [];
  const jetzt = new Date();
  const ARTIKEL = [['4311', 'Bettwäsche, Geschirr, Müll: Diese Aufgaben darf Airbnb Gästen künftig nicht mehr aufbrummen'],
    ['4302', 'Schulautonomie: Was Direktionen jetzt selbst entscheiden'], ['4298', 'Mensa-Streik: Wie es weitergeht']];
  [[14, 6], [9, 4], [17, 8], [12, 3], [20, 7], [6, 2]].forEach(([m, j], i) => {
    const vor = 5 - i; // 5 Monate zurück … dieser Monat
    const d = new Date(jetzt.getFullYear(), jetzt.getMonth() - vor, 1);
    const monat = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const tage = vor === 0 ? Math.max(1, jetzt.getDate()) : 28;
    [[maria, m], [jonas, j]].forEach(([u, anzahl]) => {
      for (let k = 0; k < anzahl; k++) {
        const am = new Date(d.getFullYear(), d.getMonth(), 1 + Math.floor((k * tage) / anzahl), 9 + (k % 8), (k * 13) % 60);
        const a = vor === 0 && u === maria && k < ARTIKEL.length ? ARTIKEL[k] : null;
        db.redigieren.push({ id: `demo-red-${u.id}-${monat}-${k}`, nutzer_id: u.id, monat, artikel_id: a?.[0] ?? null, titel: a?.[1] ?? '',
          quelle: a ? 'erweiterung' : 'knopf', erstellt_am: am.toISOString() });
      }
    });
  });
}

// Beispiel-Betreiber der Demo: zeigt den Hinweis „nicht bei campus a angestellt“, Impressum und Datenschutz
const BEISPIEL_BETREIBER = () => ({
  ...BETREIBER_STANDARD, name: 'Max Muster (Beispiel)', anschrift: 'Musterweg 1\n1010 Wien', email: 'max@example.org',
  extern: true, stand: new Date().toISOString(),
});
