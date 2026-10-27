<?php
// Schnittstelle für die App: POST api/<Funktion> mit {"args": [...]}, Antwort {"daten": ...} oder {"fehler": "..."}.
// Auf World4You leitet die .htaccess im Hauptordner api/<Funktion> hierher weiter.
declare(strict_types=1);

require_once __DIR__ . '/lib/app.php';

const COOKIE = 'hn_sitzung';
const MAX_BODY = 100 * 1024;
const MAX_BODY_PDF = 9 * 1024 * 1024; // pdfMailen: PDF als base64 (bis 6 MB)

const SICHERHEITS_HEADER = [
    'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options' => 'nosniff',
    'X-Frame-Options' => 'DENY',
    'Referrer-Policy' => 'no-referrer',
    'Cache-Control' => 'no-store',
];

function https(): bool
{
    return (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
}

function cookie_setzen(?string $wert): void
{
    setcookie(COOKIE, $wert ?? '', [
        'expires' => $wert ? time() + SITZUNG_TAGE * 86400 : 1,
        'path' => '/',
        'secure' => https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Antwort schicken und die Verbindung schließen, damit Mails danach verschickt werden können */
function antworten(int $status, array $daten): void
{
    $text = json_text($daten);
    http_response_code($status);
    foreach (SICHERHEITS_HEADER as $k => $v) header("$k: $v");
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen($text));
    header('Connection: close');
    echo $text;
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        while (ob_get_level() > 0) ob_end_flush();
        flush();
    }
}

/**
 * Schutz gegen gefälschte Anfragen von fremden Webseiten (CSRF): eigener Header (erzwingt bei fremden
 * Seiten eine CORS-Vorabprüfung, die wir nie erlauben) und – falls vorhanden – Origin muss passen.
 */
function herkunft_ok(): bool
{
    if (($_SERVER['HTTP_X_HONORARE'] ?? '') !== '1') return false;
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') return true;
    $host = parse_url($origin, PHP_URL_HOST);
    $port = parse_url($origin, PHP_URL_PORT);
    return $host && strcasecmp($host . ($port ? ":$port" : ''), $_SERVER['HTTP_HOST'] ?? '') === 0;
}

function api(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') return [405, ['fehler' => 'Nur POST erlaubt.']];
    if (!herkunft_ok()) return [403, ['fehler' => 'Anfrage abgelehnt.']];
    $name = (string) ($_GET['f'] ?? '');
    if (!in_array($name, Honorare::FUNKTIONEN, true)) return [404, ['fehler' => 'Unbekannte Funktion.']];

    $max = $name === 'pdfMailen' ? MAX_BODY_PDF : MAX_BODY;
    $roh = file_get_contents('php://input', false, null, 0, $max + 1);
    if (strlen((string) $roh) > $max) return [413, ['fehler' => $name === 'pdfMailen' ? 'Das PDF ist zu groß zum Verschicken. Bitte herunterladen.' : 'Anfrage zu groß.']];
    $body = $roh === '' || $roh === false ? [] : json_decode($roh, true);
    if (!is_array($body)) return [400, ['fehler' => 'Ungültige Anfrage.']];
    $args = is_array($body['args'] ?? null) ? array_values($body['args']) : [];

    try {
        $db = datenbank();
    } catch (Throwable $e) {
        error_log('Anerkennungsprämien: Datenbank: ' . $e->getMessage());
        // noch nicht eingerichtet (z. B. World4You: kein SQLite und noch keine MySQL-Zugangsdaten)
        if (!is_array(konfiguration()['datenbank']) && !extension_loaded('pdo_sqlite')) {
            return [503, ['fehler' => 'Die App ist noch nicht eingerichtet. Bitte zuerst ' . aktuelle_adresse() . 'einrichten.php öffnen.']];
        }
        return [503, ['fehler' => 'Keine Verbindung zur Datenbank. Bitte die Zugangsdaten prüfen (' . aktuelle_adresse() . 'einrichten.php).']];
    }
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unbekannt');
    $token = isset($_COOKIE[COOKIE]) && is_string($_COOKIE[COOKIE]) ? $_COOKIE[COOKIE] : null;
    $nutzerId = sitzung_pruefen($db, $token);
    $nutzer = $nutzerId ? nutzer_laden($db, $nutzerId) : null;
    if ($nutzer && !$nutzer['aktiv']) $nutzer = null;
    if (!$nutzer && !in_array($name, Honorare::OEFFENTLICH, true)) return [401, ['fehler' => 'Bitte melde dich an.', 'abgemeldet' => true]];

    // Begrenzung von Versuchen (gegen Erraten von Passwörtern und Massenanfragen)
    if ($name === 'anmelden') {
        $email = strtolower(tr($args[0] ?? ''));
        if (!versuch_erlaubt($db, "login-ip:$ip", 30, 900) || !versuch_erlaubt($db, "login:$email", 10, 900)) {
            return [429, ['fehler' => 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.']];
        }
    }
    // Links: gegen Durchprobieren von Tokens
    if (in_array($name, ['linkAnmelden', 'einladungPruefen', 'mitLinkRegistrieren'], true) && !versuch_erlaubt($db, "link:$ip", 30, 900)) {
        return [429, ['fehler' => 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.']];
    }
    if ($name === 'zugangAnfragen' && !versuch_erlaubt($db, "anfrage:$ip", 5, 3600)) {
        return [429, ['fehler' => 'Zu viele Anfragen. Bitte später erneut versuchen.']];
    }
    if (in_array($name, ['passwortAendern', 'erstesPasswortSetzen'], true) && !versuch_erlaubt($db, 'passwort:' . ($nutzer['id'] ?? $ip), 10, 900)) {
        return [429, ['fehler' => 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.']];
    }
    if ($name === 'pdfMailen' && !versuch_erlaubt($db, 'pdfmail:' . ($nutzer['id'] ?? $ip), 20, 900)) {
        return [429, ['fehler' => 'Zu viele E-Mails. Bitte in 15 Minuten erneut versuchen.']];
    }
    if ($name === 'testMail' && !versuch_erlaubt($db, 'testmail:' . ($nutzer['id'] ?? $ip), 10, 900)) {
        return [429, ['fehler' => 'Zu viele Test-E-Mails. Bitte in 15 Minuten erneut versuchen.']];
    }

    $ctx = new Ctx($db, $nutzer, $nutzerId ? $token : null);
    // Beim Aufruf genau so viele Argumente übergeben, wie die Funktion annimmt
    $methode = new ReflectionMethod(Honorare::class, $name);
    $daten = $methode->invokeArgs(new Honorare($ctx), array_slice($args, 0, $methode->getNumberOfParameters()));
    if ($ctx->neueSitzung) cookie_setzen($ctx->neueSitzung);
    if ($ctx->sitzungLoeschen) cookie_setzen(null);
    return [200, ['daten' => $daten]];
}

ignore_user_abort(true);
set_time_limit(120);
try {
    [$status, $daten] = api();
} catch (Fehler $e) {
    [$status, $daten] = [$e->status, ['fehler' => $e->getMessage()]];
} catch (Throwable $e) {
    error_log('Prämienabrechnungen: ' . $e);
    [$status, $daten] = [500, ['fehler' => 'Interner Fehler. Bitte später erneut versuchen.']];
}
antworten($status, $daten);
try {
    hintergrundarbeit(datenbank());
} catch (Throwable $e) {
    error_log('Prämienabrechnungen: ' . $e->getMessage());
}
