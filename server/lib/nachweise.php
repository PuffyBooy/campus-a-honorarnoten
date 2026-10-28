<?php
// Nachweise zum Redigieren: Dateien (PDF, Word …), in denen steht, was redigiert wurde. Nur bei Leistungen „Redigieren“.
// Gespeichert in der Datenbank (base64), damit sie in jeder Sicherung mit drin sind.
declare(strict_types=1);

const NACHWEIS_TYPEN = [
    'pdf' => 'application/pdf',
    'doc' => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'odt' => 'application/vnd.oasis.opendocument.text',
    'rtf' => 'application/rtf',
    'txt' => 'text/plain',
    'xls' => 'application/vnd.ms-excel',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ods' => 'application/vnd.oasis.opendocument.spreadsheet',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
];
const NACHWEIS_MAX_BYTES = 5 * 1024 * 1024;
const NACHWEISE_PRO_LEISTUNG = 5;

/** Dateiname säubern (keine Pfade, keine Steuerzeichen); null, wenn die Endung nicht erlaubt ist */
function nachweis_name(mixed $name): ?string
{
    // nur der Dateiname (ohne Ordner), ohne Steuerzeichen
    $name = trim(preg_replace('/[\x00-\x1f\x7f]+/u', ' ', substr((string) strrchr('/' . str_replace('\\', '/', s($name)), '/'), 1)));
    $endung = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if ($name === '' || !isset(NACHWEIS_TYPEN[$endung])) return null;
    return mb_strlen($name) > 150 ? mb_substr(pathinfo($name, PATHINFO_FILENAME), 0, 140) . '.' . $endung : $name;
}

/** Nachweise (ohne Inhalt) an die Leistungen hängen – nur Redigieren hat welche */
function nachweise_anhaengen(PDO $db, array $positionen): array
{
    $ids = array_column(array_filter($positionen, fn ($p) => $p['kategorie'] === 'redigieren'), 'id');
    if (!$ids) return $positionen;
    $liste = [];
    $platz = implode(',', array_fill(0, count($ids), '?'));
    foreach (zeilen($db, "select id, position_id, name, groesse from nachweise where position_id in ($platz) order by erstellt_am", $ids) as $z) {
        $liste[$z['position_id']][] = ['id' => $z['id'], 'name' => $z['name'], 'groesse' => (int) $z['groesse']];
    }
    return array_map(fn ($p) => $p['kategorie'] === 'redigieren' ? $p + ['nachweise' => $liste[$p['id']] ?? []] : $p, $positionen);
}

/** Leistung kommt zurück zur Autor:in (neue Id): Nachweise mitnehmen */
function nachweise_kopieren(PDO $db, string $von, string $nach): void
{
    foreach (zeilen($db, 'select * from nachweise where position_id = ?', [$von]) as $z) {
        q($db, 'insert into nachweise (id, position_id, autor_id, name, typ, groesse, inhalt, erstellt_am) values (?, ?, ?, ?, ?, ?, ?, ?)',
            [neue_id(), $nach, $z['autor_id'], $z['name'], $z['typ'], $z['groesse'], $z['inhalt'], $z['erstellt_am']]);
    }
}

/** Nachweise, deren Leistung es weder als Entwurf noch in einer Abrechnung gibt, löschen */
function nachweise_aufraeumen(PDO $db): void
{
    q($db, 'delete from nachweise where position_id not in (select id from positionen) and position_id not in (select id from note_positionen)');
}
