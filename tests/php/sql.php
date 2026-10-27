<?php
// Für die Tests: eine SQL-Anweisung in der Datenbank des Test-Servers ausführen (SQLite oder MySQL).
// stdin: {"sql": "...", "params": [...]}
declare(strict_types=1);

require_once __DIR__ . '/../../server/lib/app.php';

$a = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$st = q(datenbank(), $a['sql'], $a['params'] ?? []);
echo json_encode(['zeilen' => $st->columnCount() ? $st->fetchAll() : [], 'geaendert' => $st->rowCount()]);
