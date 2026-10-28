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
    // Version 9: wann bei der Zugangsanfrage Datenschutzerklärung und Hinweis zur Kenntnis genommen wurden
    <<<'SQL'
    alter table anfragen add column zustimmung_am text;
    SQL,
    // Version 10: Haken „geprüft“ der Redaktion pro Leistung
    <<<'SQL'
    alter table note_positionen add column geprueft_von text;
    alter table note_positionen add column geprueft_am text;
    SQL,
    // Version 11: Links zum direkten Anmelden (in der Zugangs-Mail) und Registrierungslinks (nur als Hash)
    <<<'SQL'
    create table links (
      id             text primary key,
      token_hash     text not null unique,
      art            text not null check (art in ('anmelden', 'registrieren')),
      nutzer_id      text references nutzer(id) on delete cascade,
      rollen         text not null default '[]',
      max_nutzungen  integer,
      nutzungen      integer not null default 0,
      gueltig_bis    text not null,
      notiz          text not null default '',
      erstellt_von   text not null default '',
      erstellt_am    text not null,
      widerrufen_am  text
    );
    SQL,
    // Version 12: Protokoll für den Admin (Info, Warnung, Fehler)
    <<<'SQL'
    create table protokoll (
      id       integer primary key autoincrement,
      zeit     text not null,
      stufe    text not null check (stufe in ('info', 'warnung', 'fehler')),
      bereich  text not null,
      text     text not null,
      wer      text not null default '',
      ip       text not null default ''
    );
    create index protokoll_zeit on protokoll(zeit);
    SQL,
    // Version 13: schneller bei vielen Abrechnungen (Sortierung, Suche nach schon abgerechneten Artikeln)
    <<<'SQL'
    create index noten_eingereicht on noten(eingereicht_am);
    create index note_positionen_artikel on note_positionen(artikel_url);
    SQL,
    // Version 14: Anhänge an E-Mails (z. B. Zahlungsavis als PDF), als JSON mit base64
    <<<'SQL'
    alter table mails add column anhaenge text;
    SQL,
];

// MySQL/MariaDB (z. B. bei World4You, wo SQLite fehlt): dasselbe Schema in einem Schritt. Spätere Änderungen
// kommen als weitere Einträge dazu – in MIGRATIONEN (SQLite) und hier.
const MYSQL_MIGRATIONEN = [
    // Version 1 = Stand von SQLite-Version 8
    <<<'SQL'
    create table if not exists nutzer (
      id                    varchar(36) not null primary key,
      email                 varchar(200) not null unique,
      vorname               varchar(100) not null,
      nachname              varchar(100) not null,
      rollen                varchar(200) not null default '[]',
      aktiv                 tinyint not null default 1,
      muss_passwort_aendern tinyint not null default 1,
      passwort              varchar(255) not null,
      strasse               varchar(150) not null default '',
      plz_ort               varchar(100) not null default '',
      kontoinhaber          varchar(100) not null default '',
      iban                  varchar(64) not null default '',
      bic                   varchar(16) not null default '',
      erstellt_am           varchar(30) not null,
      letzter_login         varchar(30) null,
      campus_profil         varchar(64) not null default '',
      campus_a_profil       varchar(64) not null default '',
      hinweis_bestaetigt_am varchar(30) null,
      benachrichtigungen    varchar(1000) not null default '{}'
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists sitzungen (
      token_hash  char(64) not null primary key,
      nutzer_id   varchar(36) not null,
      erstellt_am varchar(30) not null,
      laeuft_ab   varchar(30) not null,
      index sitzungen_nutzer (nutzer_id),
      foreign key (nutzer_id) references nutzer(id) on delete cascade
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists anfragen (
      id             varchar(36) not null primary key,
      vorname        varchar(100) not null,
      nachname       varchar(100) not null,
      email          varchar(200) not null,
      nachricht      varchar(1000) not null default '',
      status         varchar(20) not null default 'offen',
      am             varchar(30) not null,
      bearbeitet_am  varchar(30) null,
      bearbeitet_von varchar(250) null,
      check (status in ('offen', 'freigeschaltet', 'abgelehnt'))
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists positionen (
      id                varchar(36) not null primary key,
      autor_id          varchar(36) not null,
      kategorie         varchar(20) not null,
      art               varchar(100) not null,
      titel             varchar(200) not null,
      veroeffentlichung varchar(10) not null,
      ausgabe           varchar(100) not null default '',
      vereinbart_mit    varchar(100) not null default '',
      betrag_cent       int not null,
      notiz             varchar(1000) not null default '',
      erstellt_am       varchar(30) not null,
      geaendert_am      varchar(30) null,
      kolumnenart       varchar(100) not null default '',
      artikel_url       varchar(320) not null default '',
      medium            varchar(20) not null default 'college',
      anzahl            int not null default 0,
      zurueck_nummer    varchar(255) not null default '',
      zurueck_grund     varchar(1000) not null default '',
      index positionen_autor (autor_id),
      index positionen_artikel (artikel_url),
      foreign key (autor_id) references nutzer(id) on delete cascade,
      check (kategorie in ('kolumne', 'ausserordentlich', 'redigieren')),
      check (betrag_cent > 0)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists noten (
      id               varchar(36) not null primary key,
      nummer           varchar(255) not null unique,
      jahr             int not null,
      laufende_nummer  int not null,
      monat            varchar(7) not null,
      autor_id         varchar(36) null,
      status           varchar(20) not null,
      eingereicht_am   varchar(30) not null,
      entschieden_am   varchar(30) null,
      bezahlt_am       varchar(30) null,
      ablehnungsgrund  varchar(1000) not null default '',
      zurueckgeholt_am varchar(30) null,
      autor_json       text not null,
      zahlung_json     text not null,
      empfaenger_json  text not null,
      medium           varchar(20) not null default 'college',
      index noten_autor (autor_id),
      index noten_status (status),
      index noten_medium (medium),
      foreign key (autor_id) references nutzer(id) on delete set null,
      check (status in ('eingereicht', 'angenommen', 'abgelehnt', 'bezahlt')),
      check (status <> 'abgelehnt' or ablehnungsgrund <> ''),
      check (status <> 'bezahlt' or bezahlt_am is not null)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists note_positionen (
      id                      varchar(36) not null,
      note_id                 varchar(36) not null,
      reihenfolge             int not null,
      kategorie               varchar(20) not null,
      art                     varchar(100) not null,
      titel                   varchar(200) not null,
      veroeffentlichung       varchar(10) not null,
      ausgabe                 varchar(100) not null default '',
      vereinbart_mit          varchar(100) not null default '',
      notiz                   varchar(1000) not null default '',
      betrag_cent             int not null,
      betrag_eingereicht_cent int not null,
      betrag_vermerk          varchar(500) not null default '',
      kolumnenart             varchar(100) not null default '',
      artikel_url             varchar(320) not null default '',
      medium                  varchar(20) not null default 'college',
      anzahl                  int not null default 0,
      primary key (note_id, id),
      foreign key (note_id) references noten(id) on delete cascade,
      check (betrag_cent > 0)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists kommentare (
      id             varchar(36) not null primary key,
      note_id        varchar(36) not null,
      verfasser_id   varchar(36) null,
      verfasser_name varchar(250) not null,
      text           text not null,
      am             varchar(30) not null,
      foreign key (note_id) references noten(id) on delete cascade
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists verlauf (
      id          varchar(36) not null primary key,
      note_id     varchar(36) not null,
      akteur_id   varchar(36) null,
      akteur_name varchar(250) not null,
      aktion      varchar(50) not null,
      details     text not null,
      am          varchar(30) not null,
      index verlauf_note (note_id),
      foreign key (note_id) references noten(id) on delete cascade
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists loeschprotokoll (
      id            varchar(36) not null primary key,
      nummer        varchar(255) not null,
      geloescht_von varchar(250) not null,
      am            varchar(30) not null
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists einstellungen (
      schluessel varchar(100) not null primary key,
      wert       mediumtext not null
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists artikel (
      url       varchar(320) not null primary key,
      titel     varchar(200) not null,
      datum     varchar(10) not null,
      ressort   varchar(100) not null default '',
      region    varchar(100) not null default '',
      kategorie varchar(100) not null default '',
      geholt_am varchar(30) not null
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists versuche (
      schluessel varchar(255) not null,
      zeit       bigint not null,
      index versuche_schluessel (schluessel, zeit)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists artikel_listen (
      schluessel varchar(100) not null primary key,
      zeit       bigint not null,
      artikel    mediumtext not null
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    create table if not exists mails (
      id           varchar(36) not null primary key,
      an           varchar(255) not null,
      betreff      varchar(500) not null,
      html         mediumtext not null,
      text         mediumtext not null,
      erstellt_am  varchar(30) not null,
      gesendet_am  varchar(30) null,
      versuche     int not null default 0,
      fehler       varchar(1000) not null default '',
      gesperrt_bis bigint not null default 0,
      index mails_offen (gesendet_am)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    SQL,    // Version 2 = SQLite-Version 9
    <<<'SQL'
    alter table anfragen add column zustimmung_am varchar(30) null;
    SQL,
    // Version 3 = SQLite-Version 10
    <<<'SQL'
    alter table note_positionen add column geprueft_von varchar(250) null;
    alter table note_positionen add column geprueft_am varchar(30) null;
    SQL,
    // Version 4 = SQLite-Version 11
    <<<'SQL'
    create table if not exists links (
      id             varchar(36) not null primary key,
      token_hash     char(64) not null unique,
      art            varchar(20) not null,
      nutzer_id      varchar(36) null,
      rollen         varchar(200) not null default '[]',
      max_nutzungen  int null,
      nutzungen      int not null default 0,
      gueltig_bis    varchar(30) not null,
      notiz          varchar(200) not null default '',
      erstellt_von   varchar(250) not null default '',
      erstellt_am    varchar(30) not null,
      widerrufen_am  varchar(30) null,
      foreign key (nutzer_id) references nutzer(id) on delete cascade,
      check (art in ('anmelden', 'registrieren'))
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    SQL,
    // Version 5 = SQLite-Version 12
    <<<'SQL'
    create table if not exists protokoll (
      id       bigint not null auto_increment primary key,
      zeit     varchar(30) not null,
      stufe    varchar(10) not null,
      bereich  varchar(30) not null,
      text     varchar(1000) not null,
      wer      varchar(250) not null default '',
      ip       varchar(50) not null default '',
      index protokoll_zeit (zeit),
      check (stufe in ('info', 'warnung', 'fehler'))
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
    SQL,
    // Version 6 = SQLite-Version 13
    <<<'SQL'
    create index noten_eingereicht on noten(eingereicht_am);
    create index note_positionen_artikel on note_positionen(artikel_url);
    SQL,    // Version 7 = SQLite-Version 14
    <<<'SQL'
    alter table mails add column anhaenge mediumtext null;
    SQL,
];

/** Tabellen in der Reihenfolge, in der sie eingespielt werden können (für die Sicherung) */
const TABELLEN = ['nutzer', 'sitzungen', 'anfragen', 'positionen', 'noten', 'note_positionen', 'kommentare', 'verlauf',
    'loeschprotokoll', 'einstellungen', 'artikel', 'versuche', 'artikel_listen', 'mails', 'links', 'protokoll'];

/**
 * Datenbank öffnen und auf den neuesten Stand bringen.
 * $ziel: Pfad einer SQLite-Datei – oder ['typ' => 'mysql', 'host', 'port', 'name', 'benutzer', 'passwort'].
 */
function oeffne_datenbank(string|array $ziel): PDO
{
    return is_array($ziel) ? oeffne_mysql($ziel) : oeffne_sqlite($ziel);
}

function oeffne_sqlite(string $pfad): PDO
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

function oeffne_mysql(array $k): PDO
{
    $dsn = 'mysql:host=' . ($k['host'] ?? 'localhost') . ';port=' . (int) ($k['port'] ?? 3306) . ';dbname=' . ($k['name'] ?? '') . ';charset=utf8mb4';
    $db = new PDO($dsn, $k['benutzer'] ?? '', $k['passwort'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 10,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $db->exec("set names utf8mb4 collate utf8mb4_unicode_ci, time_zone = '+00:00', "
        . "sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    $db->exec('create table if not exists schema_version (version int not null) engine=InnoDB');
    $version = (int) $db->query('select coalesce(max(version), 0) from schema_version')->fetchColumn();
    if ($version < count(MYSQL_MIGRATIONEN)) {
        // nur eine Anfrage gleichzeitig darf das Schema ändern (Tabellen anlegen beendet Transaktionen in MySQL)
        $db->query("select get_lock('anerkennungspraemien_schema', 30)");
        try {
            $version = (int) $db->query('select coalesce(max(version), 0) from schema_version')->fetchColumn();
            for ($v = $version; $v < count(MYSQL_MIGRATIONEN); $v++) {
                foreach (array_filter(array_map('trim', explode(';', MYSQL_MIGRATIONEN[$v]))) as $befehl) $db->exec($befehl);
                $db->exec('insert into schema_version (version) values (' . ($v + 1) . ')');
            }
        } finally {
            $db->query("select release_lock('anerkennungspraemien_schema')");
        }
    }
    return $db;
}

function ist_mysql(PDO $db): bool
{
    return $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
}

/** Führt $fn in einer Transaktion aus (alles oder nichts). Verschachtelt: läuft in der äußeren mit. */
function transaktion(PDO $db, callable $fn): mixed
{
    if ($db->inTransaction()) return $fn();
    // SQLite: gleich die Schreibsperre holen, damit zwei Anfragen sich nicht gegenseitig blockieren
    ist_mysql($db) ? $db->beginTransaction() : $db->exec('begin immediate');
    try {
        $r = $fn();
        ist_mysql($db) ? $db->commit() : $db->exec('commit');
        return $r;
    } catch (Throwable $e) {
        ist_mysql($db) ? $db->rollBack() : $db->exec('rollback');
        throw $e;
    }
}

/** Einfügen oder – wenn es den Schlüssel schon gibt – ändern (SQLite und MySQL) */
function upsert(PDO $db, string $tabelle, array $werte, array $schluessel): void
{
    $spalten = array_keys($werte);
    $aendern = array_diff($spalten, $schluessel);
    $sql = "insert into $tabelle (" . implode(', ', $spalten) . ') values (' . implode(', ', array_fill(0, count($spalten), '?')) . ')';
    $sql .= ist_mysql($db)
        ? ' on duplicate key update ' . implode(', ', array_map(fn ($s) => "$s = values($s)", $aendern))
        : ' on conflict(' . implode(', ', $schluessel) . ') do update set ' . implode(', ', array_map(fn ($s) => "$s = excluded.$s", $aendern));
    q($db, $sql, array_values($werte));
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

/**
 * Sicherungskopie: SQLite als Kopie der Datei (.sqlite), MySQL als SQL-Datei (.sql) zum Einspielen
 * über phpMyAdmin. Liefert den Pfad der Sicherung.
 */
function sichern(PDO $db, string $ziel): string
{
    $ordner = dirname($ziel);
    if (!is_dir($ordner)) mkdir($ordner, 0700, true);
    if (ist_mysql($db)) {
        $ziel = preg_replace('/\.sqlite$/', '', $ziel) . (str_ends_with($ziel, '.sql') ? '' : '.sql');
        $f = fopen($ziel, 'w');
        fwrite($f, "-- Sicherung der Anerkennungsprämien vom " . jetzt() . "\n-- Einspielen: phpMyAdmin -> Importieren (in eine leere Datenbank)\n");
        fwrite($f, "set names utf8mb4;\nset foreign_key_checks = 0;\n");
        foreach (['schema_version', ...TABELLEN] as $t) {
            $create = $db->query("show create table $t")->fetch(PDO::FETCH_NUM)[1];
            fwrite($f, "\ndrop table if exists $t;\n$create;\n");
            foreach ($db->query("select * from $t", PDO::FETCH_ASSOC) as $z) {
                $w = array_map(fn ($x) => $x === null ? 'null' : (is_int($x) ? (string) $x : $db->quote((string) $x)), array_values($z));
                fwrite($f, "insert into $t (" . implode(', ', array_keys($z)) . ') values (' . implode(', ', $w) . ");\n");
            }
        }
        fwrite($f, "set foreign_key_checks = 1;\n");
        fclose($f);
        return $ziel;
    }
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
    return $ziel;
}
