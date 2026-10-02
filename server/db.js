// SQLite-Datenbank (eingebaut in Node.js ab Version 22 – kein Datenbankserver nötig).
// Die ganze Datenbank ist eine Datei: daten/honorarnoten.sqlite
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONEN = [
  // Version 1
  `
  create table nutzer (
    id                    text primary key,
    email                 text not null unique collate nocase,
    vorname               text not null,
    nachname              text not null,
    rollen                text not null default '[]',   -- JSON-Array
    aktiv                 integer not null default 1,
    muss_passwort_aendern integer not null default 1,
    passwort              text not null,               -- scrypt$salt$hash
    strasse               text not null default '',
    plz_ort               text not null default '',
    kontoinhaber          text not null default '',
    iban                  text not null default '',
    bic                   text not null default '',
    erstellt_am           text not null,
    letzter_login         text
  );

  create table sitzungen (
    token_hash  text primary key,          -- SHA-256 des Cookie-Werts
    nutzer_id   text not null references nutzer(id) on delete cascade,
    erstellt_am text not null,
    laeuft_ab   text not null
  );
  create index sitzungen_nutzer on sitzungen(nutzer_id);

  create table anfragen (
    id             text primary key,
    vorname        text not null,
    nachname       text not null,
    email          text not null collate nocase,
    nachricht      text not null default '',
    status         text not null default 'offen' check (status in ('offen', 'freigeschaltet', 'abgelehnt')),
    am             text not null,
    bearbeitet_am  text,
    bearbeitet_von text
  );

  -- gespeicherte, noch nicht abgerechnete Leistungen
  create table positionen (
    id                text primary key,
    autor_id          text not null references nutzer(id) on delete cascade,
    kategorie         text not null check (kategorie in ('kolumne', 'ausserordentlich')),
    art               text not null,
    titel             text not null,
    veroeffentlichung text not null,
    ausgabe           text not null default '',
    vereinbart_mit    text not null default '',
    betrag_cent       integer not null check (betrag_cent > 0),
    notiz             text not null default '',
    erstellt_am       text not null,
    geaendert_am      text
  );
  create index positionen_autor on positionen(autor_id);

  -- abgeschickte Honorarnoten (Monatsabrechnungen)
  create table noten (
    id               text primary key,
    nummer           text not null unique,
    jahr             integer not null,
    laufende_nummer  integer not null,
    monat            text not null,
    autor_id         text references nutzer(id) on delete set null,
    status           text not null check (status in ('eingereicht', 'angenommen', 'abgelehnt', 'bezahlt')),
    eingereicht_am   text not null,
    entschieden_am   text,
    bezahlt_am       text,
    ablehnungsgrund  text not null default '',
    zurueckgeholt_am text,
    autor_json       text not null,   -- Momentaufnahme Name/Adresse beim Abschicken
    zahlung_json     text not null,   -- Momentaufnahme Kontoinhaber/IBAN/BIC
    empfaenger_json  text not null,
    check (status <> 'abgelehnt' or ablehnungsgrund <> ''),
    check (status <> 'bezahlt' or bezahlt_am is not null)
  );
  create index noten_autor on noten(autor_id);
  create index noten_status on noten(status);

  create table note_positionen (
    id                      text not null,
    note_id                 text not null references noten(id) on delete cascade,
    reihenfolge             integer not null,
    kategorie               text not null,
    art                     text not null,
    titel                   text not null,
    veroeffentlichung       text not null,
    ausgabe                 text not null default '',
    vereinbart_mit          text not null default '',
    notiz                   text not null default '',
    betrag_cent             integer not null check (betrag_cent > 0),
    betrag_eingereicht_cent integer not null,
    betrag_vermerk          text not null default '',
    primary key (note_id, id)
  );

  create table kommentare (
    id             text primary key,
    note_id        text not null references noten(id) on delete cascade,
    verfasser_id   text,
    verfasser_name text not null,
    text           text not null,
    am             text not null
  );

  create table verlauf (
    id          text primary key,
    note_id     text not null references noten(id) on delete cascade,
    akteur_id   text,
    akteur_name text not null,
    aktion      text not null,
    details     text not null default '{}',
    am          text not null
  );
  create index verlauf_note on verlauf(note_id);

  create table loeschprotokoll (
    id            text primary key,
    nummer        text not null,
    geloescht_von text not null,
    am            text not null
  );

  create table einstellungen (
    schluessel text primary key,
    wert       text not null
  );
  `,
  // Version 2: Art der Kolumne (statt Art der Leistung bei Kolumnen)
  `
  alter table positionen add column kolumnenart text not null default '';
  alter table note_positionen add column kolumnenart text not null default '';
  `,
  // Version 3: Verknüpfung mit den Artikeln auf campus-a-college.at
  `
  alter table nutzer add column campus_profil text not null default '';     -- Profil-ID auf campus-a-college.at
  alter table positionen add column artikel_url text not null default '';
  alter table note_positionen add column artikel_url text not null default '';
  create index positionen_artikel on positionen(artikel_url);

  -- zwischengespeicherte Artikeldaten von campus-a-college.at
  create table artikel (
    url       text primary key,
    titel     text not null,
    datum     text not null,
    ressort   text not null default '',
    region    text not null default '',
    kategorie text not null default '',
    geholt_am text not null
  );
  `,
  // Version 4: zwei Medien – campus a college und campus a – mit getrennten Honorarnoten
  `
  alter table nutzer add column campus_a_profil text not null default '';   -- Profil-ID auf campus-a.at
  alter table positionen add column medium text not null default 'college';
  alter table note_positionen add column medium text not null default 'college';
  alter table noten add column medium text not null default 'college';
  create index noten_medium on noten(medium);
  `,
  // Version 5: Redigieren (Anzahl Texte) und Rückgabe abgelehnter Leistungen an die Autor:in.
  // positionen wird neu angelegt, weil SQLite die Prüfung der Kategorie nicht ändern kann.
  `
  create table positionen_neu (
    id                text primary key,
    autor_id          text not null references nutzer(id) on delete cascade,
    kategorie         text not null check (kategorie in ('kolumne', 'ausserordentlich', 'redigieren')),
    art               text not null,
    titel             text not null,
    veroeffentlichung text not null,
    ausgabe           text not null default '',
    vereinbart_mit    text not null default '',
    betrag_cent       integer not null check (betrag_cent > 0),
    notiz             text not null default '',
    erstellt_am       text not null,
    geaendert_am      text,
    kolumnenart       text not null default '',
    artikel_url       text not null default '',
    medium            text not null default 'college',
    anzahl            integer not null default 0,     -- Redigieren: Anzahl der Texte
    zurueck_nummer    text not null default '',       -- aus welcher abgelehnten Honorarnote zurückgekommen
    zurueck_grund     text not null default ''        -- Begründung der Ablehnung (Hinweis für die Autor:in)
  );
  insert into positionen_neu (id, autor_id, kategorie, art, titel, veroeffentlichung, ausgabe, vereinbart_mit, betrag_cent,
      notiz, erstellt_am, geaendert_am, kolumnenart, artikel_url, medium)
    select id, autor_id, kategorie, art, titel, veroeffentlichung, ausgabe, vereinbart_mit, betrag_cent,
      notiz, erstellt_am, geaendert_am, kolumnenart, artikel_url, medium from positionen;
  drop table positionen;
  alter table positionen_neu rename to positionen;
  create index positionen_autor on positionen(autor_id);
  create index positionen_artikel on positionen(artikel_url);
  alter table note_positionen add column anzahl integer not null default 0;
  `,
];

export function oeffneDatenbank(pfad) {
  if (pfad !== ':memory:') mkdirSync(dirname(pfad), { recursive: true });
  const db = new DatabaseSync(pfad);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  const { user_version: version } = db.prepare('pragma user_version').get();
  for (let v = version; v < MIGRATIONEN.length; v++) {
    transaktion(db, () => {
      db.exec(MIGRATIONEN[v]);
      db.exec(`pragma user_version = ${v + 1}`);
    });
  }
  return db;
}

/** Führt fn in einer Transaktion aus (alles oder nichts). */
export function transaktion(db, fn) {
  db.exec('begin immediate');
  try {
    const r = fn();
    db.exec('commit');
    return r;
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

/** Konsistente Sicherungskopie der laufenden Datenbank */
export function sichern(db, zielPfad) {
  mkdirSync(dirname(zielPfad), { recursive: true });
  db.prepare('vacuum into ?').run(zielPfad);
}
