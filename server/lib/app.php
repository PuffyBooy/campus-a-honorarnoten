<?php
// Lädt alle Teile des Servers und öffnet die Datenbank.
declare(strict_types=1);

require_once __DIR__ . '/basis.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/regeln.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/artikel.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/mail-vorlagen.php';
require_once __DIR__ . '/honorare.php';

date_default_timezone_set('Europe/Vienna');
mb_internal_encoding('UTF-8');

/**
 * Einstellungen: optional server/konfig.php (gibt ein Array zurück), Umgebungsvariablen haben Vorrang.
 *   datenbank       Pfad der Datenbank-Datei (Standard: server/daten/honorarnoten.sqlite)
 *   backup_tage     wie lange automatische Sicherungen aufgehoben werden (Standard 30)
 */
function konfiguration(): array
{
    static $k = null;
    if ($k !== null) return $k;
    $datei = __DIR__ . '/../konfig.php';
    $eigene = is_file($datei) ? (require $datei) : [];
    $k = array_merge([
        'datenbank' => dirname(__DIR__) . '/daten/honorarnoten.sqlite',
        'backup_tage' => 30,
    ], is_array($eigene) ? $eigene : []);
    if (getenv('HONORARE_DATENBANK')) $k['datenbank'] = getenv('HONORARE_DATENBANK');
    return $k;
}

function datenbank(): PDO
{
    static $db = null;
    return $db ??= oeffne_datenbank(konfiguration()['datenbank']);
}

/** Tägliche Sicherung in daten/backups (ohne Cronjob: beim ersten Aufruf des Tages), alte werden gelöscht */
function taegliche_sicherung(PDO $db): ?string
{
    $pfad = konfiguration()['datenbank'];
    if ($pfad === ':memory:') return null;
    $ordner = dirname($pfad) . '/backups';
    $ziel = $ordner . '/honorarnoten-' . heute_iso() . '.sqlite';
    if (is_file($ziel)) return null;
    sichern($db, $ziel);
    $tage = (int) konfiguration()['backup_tage'];
    foreach (glob($ordner . '/honorarnoten-*.sqlite') ?: [] as $f) {
        if ($f !== $ziel && filemtime($f) < time() - $tage * 86400) @unlink($f);
    }
    return $ziel;
}

/** Arbeiten nach der Antwort an den Browser: Mails verschicken, aufräumen, tägliche Sicherung */
function hintergrundarbeit(PDO $db): void
{
    try {
        mails_verschicken($db);
    } catch (Throwable $e) {
        error_log('Honorarnoten: Mailversand: ' . $e->getMessage());
    }
    try {
        if (random_int(1, 50) === 1) aufraeumen($db);
        taegliche_sicherung($db);
    } catch (Throwable $e) {
        error_log('Honorarnoten: Sicherung: ' . $e->getMessage());
    }
}
