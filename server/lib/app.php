<?php
// Lädt alle Teile des Servers und öffnet die Datenbank.
declare(strict_types=1);

require_once __DIR__ . '/basis.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/regeln.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/totp.php';
require_once __DIR__ . '/protokoll.php';
require_once __DIR__ . '/artikel.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/push.php';
require_once __DIR__ . '/pdf.php';
require_once __DIR__ . '/nachweise.php';
require_once __DIR__ . '/mail-vorlagen.php';
require_once __DIR__ . '/honorare.php';
require_once __DIR__ . '/betrieb.php';
require_once __DIR__ . '/kommandozentrale.php';

date_default_timezone_set('Europe/Vienna');
mb_internal_encoding('UTF-8');

/**
 * Einstellungen. Die Einrichtungsseite schreibt app/daten/konfig.php (z. B. die MySQL-Zugangsdaten);
 * von Hand geht auch app/konfig.php. Umgebungsvariablen (für Tests) haben Vorrang.
 *   datenbank     Pfad einer SQLite-Datei (Standard: app/daten/honorarnoten.sqlite) oder
 *                 ['typ' => 'mysql', 'host' => …, 'port' => 3306, 'name' => …, 'benutzer' => …, 'passwort' => …]
 *   backup_tage   wie lange automatische Sicherungen aufgehoben werden (Standard 30)
 */
function konfiguration(bool $neu = false): array
{
    static $k = null;
    if ($k !== null && !$neu) return $k;
    $k = ['datenbank' => null, 'backup_tage' => 30];
    foreach ([__DIR__ . '/../konfig.php', daten_ordner() . '/konfig.php'] as $datei) {
        $eigene = is_file($datei) ? (require $datei) : [];
        if (is_array($eigene)) $k = array_merge($k, $eigene);
    }
    if (getenv('HONORARE_DATENBANK')) $k['datenbank'] = getenv('HONORARE_DATENBANK');
    if (getenv('HONORARE_MYSQL')) $k['datenbank'] = ['typ' => 'mysql'] + (json_decode((string) getenv('HONORARE_MYSQL'), true) ?: []);
    $k['datenbank'] ??= daten_ordner() . '/honorarnoten.sqlite';
    return $k;
}

/** Ordner für Datenbank (SQLite), Sicherungen und die Einstellungen der Einrichtung */
function daten_ordner(): string
{
    if (getenv('HONORARE_DATEN')) return rtrim((string) getenv('HONORARE_DATEN'), '/');
    if (getenv('HONORARE_DATENBANK') && getenv('HONORARE_DATENBANK') !== ':memory:') return dirname((string) getenv('HONORARE_DATENBANK'));
    return dirname(__DIR__) . '/daten';
}

/** Einstellungen der Einrichtung speichern (app/daten/konfig.php, nur für PHP lesbar) */
function konfig_speichern(array $werte): void
{
    $datei = daten_ordner() . '/konfig.php';
    $alt = is_file($datei) ? (require $datei) : [];
    $inhalt = "<?php\n// Von der Einrichtung geschrieben – enthält Zugangsdaten, nicht weitergeben.\nreturn "
        . var_export(array_merge(is_array($alt) ? $alt : [], $werte), true) . ";\n";
    if (!is_dir(dirname($datei))) mkdir(dirname($datei), 0700, true);
    if (file_put_contents($datei, $inhalt, LOCK_EX) === false) throw new RuntimeException('Die Einstellungen konnten nicht gespeichert werden (Ordner app/daten beschreibbar?).');
    @chmod($datei, 0600);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($datei, true);
    konfiguration(true);
}

function datenbank(bool $neu = false): PDO
{
    static $db = null;
    if ($neu) $db = null;
    return $db ??= oeffne_datenbank(konfiguration()['datenbank']);
}

/** Tägliche Sicherung in daten/backups (ohne Cronjob: beim ersten Aufruf des Tages), alte werden gelöscht */
function taegliche_sicherung(PDO $db): ?string
{
    if (konfiguration()['datenbank'] === ':memory:') return null;
    $ordner = daten_ordner() . '/backups';
    $heute = $ordner . '/honorarnoten-' . heute_iso();
    if (is_file("$heute.sqlite") || is_file("$heute.sql")) return null;
    $ziel = sichern($db, "$heute.sqlite");
    protokoll($db, 'info', 'sicherung', 'Tägliche Sicherung erstellt: ' . basename($ziel) . ' (' . groesse_text((int) filesize($ziel)) . ')');
    $tage = (int) konfiguration()['backup_tage'];
    foreach (glob($ordner . '/honorarnoten-*.sql*') ?: [] as $f) {
        if ($f !== $ziel && filemtime($f) < time() - $tage * 86400) @unlink($f);
    }
    return $ziel;
}

/** Arbeiten nach der Antwort an den Browser: Warn-Mail, Mails verschicken, aufräumen, tägliche Sicherung */
function hintergrundarbeit(PDO $db): void
{
    // zuerst Warn-Mail und Erinnerung zum Monatsende einreihen, damit sie gleich mit verschickt werden
    try {
        Messung::hintergrund('warnmail', fn () => warnmail_pruefen($db));
        Messung::hintergrund('erinnerung', fn () => monatserinnerung($db));
    } catch (Throwable $e) {
        error_log('Prämienabrechnungen: Warn-Mail/Erinnerung: ' . $e->getMessage());
    }
    try {
        Messung::hintergrund('mails', fn () => mails_verschicken($db));
    } catch (Throwable $e) {
        error_log('Prämienabrechnungen: Mailversand: ' . $e->getMessage());
    }
    try {
        Messung::hintergrund('push', fn () => pushes_verschicken($db));
    } catch (Throwable $e) {
        error_log('Prämienabrechnungen: Push-Mitteilungen: ' . $e->getMessage());
    }
    try {
        if (random_int(1, 50) === 1) Messung::hintergrund('aufraeumen', fn () => aufraeumen($db));
        Messung::hintergrund('sicherung', fn () => taegliche_sicherung($db));
    } catch (Throwable $e) {
        error_log('Prämienabrechnungen: Sicherung: ' . $e->getMessage());
        protokoll($db, 'fehler', 'sicherung', 'Tägliche Sicherung fehlgeschlagen: ' . $e->getMessage());
    }
}

/** 1536 -> „1,5 KB“ */
function groesse_text(int $bytes): string
{
    if ($bytes < 1024) return "$bytes B";
    if ($bytes < 1024 * 1024) return number_format($bytes / 1024, 1, ',', '.') . ' KB';
    return number_format($bytes / 1024 / 1024, 1, ',', '.') . ' MB';
}
