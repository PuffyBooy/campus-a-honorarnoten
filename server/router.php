<?php
// Nur für die Entwicklung und die Tests: php -S 127.0.0.1:3000 server/router.php
// Macht dasselbe wie die .htaccess auf World4You: App aus public/ ausliefern, api/<Funktion> an api.php.
declare(strict_types=1);

$pfad = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

const STATISCH_HEADER = [
    'Content-Security-Policy' => "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
        . "connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    'X-Content-Type-Options' => 'nosniff',
    'X-Frame-Options' => 'DENY',
    'Referrer-Policy' => 'no-referrer',
    'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy' => 'same-origin',
];

if (preg_match('~^/api/([A-Za-z]+)$~', $pfad, $m)) {
    $_GET['f'] = $m[1];
    $_SERVER['SCRIPT_NAME'] = '/api.php';
    require __DIR__ . '/api.php';
    return true;
}
if ($pfad === '/einrichten.php') {
    $_SERVER['SCRIPT_NAME'] = '/einrichten.php';
    require __DIR__ . '/einrichten.php';
    return true;
}

$typen = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'ico' => 'image/x-icon',
    'json' => 'application/json; charset=utf-8', 'txt' => 'text/plain; charset=utf-8',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
foreach (STATISCH_HEADER as $k => $v) header("$k: $v");

// Im Server-Modus meldet diese Datei dem Browser, dass die API benutzt wird
if ($pfad === '/js/modus.js') {
    header('Content-Type: text/javascript; charset=utf-8');
    header('Cache-Control: no-cache');
    echo "export const MODUS = 'server';\n";
    return true;
}

$relativ = rawurldecode($pfad === '/' ? '/index.html' : $pfad);
$teile = explode('/', $relativ);
$wurzel = realpath(__DIR__ . '/../public');
$ziel = realpath($wurzel . $relativ);
$versteckt = (bool) array_filter($teile, fn ($t) => str_starts_with($t, '.'));
if ($versteckt || !$ziel || !str_starts_with($ziel, $wurzel . DIRECTORY_SEPARATOR) || !is_file($ziel)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Nicht gefunden';
    return true;
}
header('Content-Type: ' . ($typen[strtolower(pathinfo($ziel, PATHINFO_EXTENSION))] ?? 'application/octet-stream'));
header('Cache-Control: no-cache');
header('Content-Length: ' . filesize($ziel));
readfile($ziel);
return true;
