<?php
// Schnittstelle der App – der Programmcode liegt im geschützten Ordner app/
if (version_compare(PHP_VERSION, '8.1.0', '<')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('fehler' => 'Der Server braucht PHP 8.1 oder neuer (gerade: ' . PHP_VERSION . '). Bitte im World4You-Kundenbereich umstellen.'));
    exit;
}
require __DIR__ . '/app/api.php';
