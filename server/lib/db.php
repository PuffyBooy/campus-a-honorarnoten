<?php
// SQLite-Datenbank (eine Datei, kein Datenbankserver nötig). Gleiches Schema wie die frühere Node-Version.
declare(strict_types=1);

const MIGRATIONEN = [
    // Version 1
    <<<'SQL'
    create table nutzer (
      id                    text primary key,
      email                 text not null unique collate nocase,
      vorname               text not null,
      nachname              text not null,
      rollen                text not null default '[]',
      aktiv                 integer not null default 1,
      muss_passwort_aendern integer not null default 1,
      passwort              text not null,
      strasse               text not null default '',
      plz_ort               text not null default '',
      kontoinhaber          text not null default '',
      iban                  text not null default '',
      bic                   text not null default '',
      erstellt_am           text not null,
      letzter_login         text
    );
    create table sitzungen (
      token_hash  text primary key,
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
      autor_json       text not null,
      zahlung_json     text not null,
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
    SQL,
    // Version 2: Art der Kolumne
    <<<'SQL'
    alter table positionen add column kolumnenart text not null default '';
    alter table note_positionen add column kolumnenart text not null default '';
    SQL,
    // Version 3: Verknüpfung mit den Artikeln auf campus-a-college.at
    <<<'SQL'
    alter table nutzer add column campus_profil text not null default '';
    alter table positionen add column artikel_url text not null default '';
    alter table note_positionen add column artikel_url text not null default '';
    create index positionen_artikel on positionen(artikel_url);
    create table artikel (
      url       text primary key,
      titel     text not null,
      datum     text not null,
      ressort   text not null default '',
      region    text not null default '',
      kategorie text not null default '',
      geholt_am text not null
    );
    SQL,
    // Version 4: zwei Medien – campus a college und campus a
    <<<'SQL'
    alter table nutzer add column campus_a_profil text not null default '';
    alter table positionen add column medium text not null default 'college';
    alter table note_positionen add column medium text not null default 'college';
    alter table noten add column medium text not null default 'college';
    create index noten_medium on noten(medium);
    SQL,
    // Version 5: Redigieren und Rückgabe abgelehnter Leistungen
    <<<'SQL'
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
      anzahl            integer not null default 0,
      zurueck_nummer    text not null default '',
      zurueck_grund     text not null default ''
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
    SQL,
    // Version 6 (PHP): Begrenzung von Versuchen, Artikellisten-Zwischenspeicher, E-Mail-Warteschlange
    <<<'SQL'
    create table versuche (
      schluessel text not null,
      zeit       integer not null
    );
    create index versuche_schluessel on versuche(schluessel, zeit);
    create table artikel_listen (
      schluessel text primary key,
      zeit       integer not null,
      artikel    text not null
    );
    create table mails (
      id           text primary key,
      an           text not null,
      betreff      text not null,
      html         text not null,
      text         text not null,
      erstellt_am  text not null,
      gesendet_am  text,
      versuche     integer not null default 0,
      fehler       text not null default '',
      gesperrt_bis integer not null default 0
    );
    create index mails_offen on mails(gesendet_am);
    SQL,
    // Version 7: wann der Hinweis zum Betreiber (nicht bei campus a angestellt) zur Kenntnis genommen wurde
    <<<'SQL'
    alter table nutzer add column hinweis_bestaetigt_am text;
    SQL,
    // Version 8: welche E-Mail-Benachrichtigungen ein Konto bekommen will (JSON, ohne Eintrag = Standard)
    <<<'SQL'
    alter table nutzer add column benachrichtigungen text not null default '{}';
    SQL,
];

function oeffne_datenbank(string $pfad): PDO
{
    if ($pfad !== ':memory:') {
        $ordner = dirname($pfad);
        if (!is_dir($ordner)) mkdir($ordner, 0700, true);
    }
    $db = new PDO('sqlite:' . $pfad, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 10,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    // Rollback-Journal statt WAL: funktioniert auch auf Netzlaufwerken von Webhostern
    $db->exec('pragma foreign_keys = on; pragma busy_timeout = 10000; pragma journal_mode = delete;');
    $version = (int) $db->query('pragma user_version')->fetchColumn();
    for ($v = $version; $v < count(MIGRATIONEN); $v++) {
        transaktion($db, function () use ($db, $v) {
            $db->exec(MIGRATIONEN[$v]);
            $db->exec('pragma user_version = ' . ($v + 1));
        });
    }
    return $db;
}

/** Führt $fn in einer Transaktion aus (alles oder nichts). Verschachtelt: läuft in der äußeren mit. */
function transaktion(PDO $db, callable $fn): mixed
{
    if ($db->inTransaction()) return $fn();
    $db->exec('begin immediate');
    try {
        $r = $fn();
        $db->exec('commit');
        return $r;
    } catch (Throwable $e) {
        $db->exec('rollback');
        throw $e;
    }
}

/** Abfrage mit Parametern; liefert das Statement */
function q(PDO $db, string $sql, array $params = []): PDOStatement
{
    $st = $db->prepare($sql);
    $st->execute(array_values($params));
    return $st;
}

function zeile(PDO $db, string $sql, array $params = []): ?array
{
    $z = q($db, $sql, $params)->fetch();
    return $z === false ? null : $z;
}

function zeilen(PDO $db, string $sql, array $params = []): array
{
    return q($db, $sql, $params)->fetchAll();
}

function wert(PDO $db, string $sql, array $params = []): mixed
{
    return q($db, $sql, $params)->fetchColumn();
}

/** Konsistente Sicherungskopie der Datenbank */
function sichern(PDO $db, string $ziel): void
{
    $ordner = dirname($ziel);
    if (!is_dir($ordner)) mkdir($ordner, 0700, true);
    if (file_exists($ziel)) unlink($ziel);
    try {
        q($db, 'vacuum into ?', [$ziel]);
    } catch (PDOException $e) {
        // sehr altes SQLite ohne „vacuum into“: Datei kopieren, während niemand schreibt
        transaktion($db, function () use ($db, $ziel) {
            $quelle = q($db, 'pragma database_list')->fetch()['file'] ?? '';
            if ($quelle === '' || !copy($quelle, $ziel)) throw new RuntimeException('Sicherung nicht möglich.');
        });
    }
}
