<?php
// Einrichtung nach dem Hochladen (erstes Admin-Konto, E-Mail-Versand) – funktioniert nur, solange es kein Konto gibt
if (version_compare(PHP_VERSION, '8.1.0', '<')) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>Einrichtung</title><h1>PHP-Version zu alt</h1>'
        . '<p>Die Honorarnoten brauchen PHP 8.1 oder neuer, gerade läuft ' . htmlspecialchars(PHP_VERSION) . '.</p>'
        . '<p>Im World4You-Kundenbereich unter <strong>Webspace → Einstellungen</strong> die neueste PHP-Version wählen und diese Seite neu laden.</p>';
    exit;
}
require __DIR__ . '/app/einrichten.php';
