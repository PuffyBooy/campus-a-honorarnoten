<?php
// Passwörter (bcrypt über password_hash) und Sitzungen (Cookie, in der Datenbank nur als Hash gespeichert)
declare(strict_types=1);

const SITZUNG_TAGE = 14;
// Hash eines Zufallspassworts: auch bei unbekannter E-Mail wird gleich lange gerechnet
const BLIND_HASH = '$2y$11$JETGkf.YVVpnTJTBCmUEdO/Hbt55VXYnpvHijO7HnRFldax6oNVli';

function passwort_hash(string $passwort): string
{
    return password_hash($passwort, PASSWORD_BCRYPT, ['cost' => 11]);
}

function passwort_passt(?string $gespeichert, string $passwort): bool
{
    return password_verify($passwort, $gespeichert ?: BLIND_HASH) && (bool) $gespeichert;
}

/** Gut lesbares Startpasswort ohne verwechselbare Zeichen (0/O, 1/l/I) */
function startpasswort(int $laenge = 10): string
{
    $zeichen = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $p = '';
    for ($i = 0; $i < $laenge; $i++) $p .= $zeichen[random_int(0, strlen($zeichen) - 1)];
    return $p;
}

function token_hash(string $token): string
{
    return hash('sha256', $token);
}

function zeit_iso(int $sekunden): string
{
    return (new DateTimeImmutable('@' . $sekunden))->format('Y-m-d\TH:i:s.000\Z');
}

function sitzung_erstellen(PDO $db, string $nutzerId): string
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q($db, 'insert into sitzungen (token_hash, nutzer_id, erstellt_am, laeuft_ab) values (?, ?, ?, ?)',
        [token_hash($token), $nutzerId, jetzt(), zeit_iso(time() + SITZUNG_TAGE * 86400)]);
    return $token;
}

/** Nutzer-ID zur Sitzung (oder null); verlängert die Sitzung höchstens einmal pro Stunde */
function sitzung_pruefen(PDO $db, ?string $token): ?string
{
    if (!$token || strlen($token) > 100) return null;
    $h = token_hash($token);
    $s = zeile($db, 'select nutzer_id, laeuft_ab from sitzungen where token_hash = ?', [$h]);
    if (!$s) return null;
    $ablauf = strtotime($s['laeuft_ab']);
    if ($ablauf < time()) {
        q($db, 'delete from sitzungen where token_hash = ?', [$h]);
        return null;
    }
    $neu = time() + SITZUNG_TAGE * 86400;
    if ($neu - $ablauf > 3600) q($db, 'update sitzungen set laeuft_ab = ? where token_hash = ?', [zeit_iso($neu), $h]);
    return $s['nutzer_id'];
}

function sitzung_beenden(PDO $db, ?string $token): void
{
    if ($token) q($db, 'delete from sitzungen where token_hash = ?', [token_hash($token)]);
}

function alle_sitzungen_beenden(PDO $db, string $nutzerId, ?string $ausserToken = null): void
{
    if ($ausserToken) {
        q($db, 'delete from sitzungen where nutzer_id = ? and token_hash <> ?', [$nutzerId, token_hash($ausserToken)]);
    } else {
        q($db, 'delete from sitzungen where nutzer_id = ?', [$nutzerId]);
    }
}

/** Aufräumen: abgelaufene Sitzungen und alte Zählungen von Versuchen */
function aufraeumen(PDO $db): void
{
    q($db, 'delete from sitzungen where laeuft_ab < ?', [jetzt()]);
    q($db, 'delete from versuche where zeit < ?', [time() - 3 * 3600]);
    protokoll_aufraeumen($db);
}

/** Begrenzung von Versuchen: true, wenn noch erlaubt (und zählt den Versuch) */
function versuch_erlaubt(PDO $db, string $schluessel, int $max, int $fensterSekunden): bool
{
    $seit = time() - $fensterSekunden;
    $anzahl = (int) wert($db, 'select count(*) from versuche where schluessel = ? and zeit >= ?', [$schluessel, $seit]);
    if ($anzahl >= $max) return false;
    q($db, 'insert into versuche (schluessel, zeit) values (?, ?)', [$schluessel, time()]);
    return true;
}
