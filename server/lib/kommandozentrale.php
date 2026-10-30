<?php
// Kommandozentrale für Admins: wie geht es dem Server? Messwerte je Stunde, Zustand, Leistungstest, Wartungsaktionen.
declare(strict_types=1);

const LANGSAM_MS = 1000;       // Anfragen ab 1 Sekunde gelten als langsam
const MESSWERTE_TAGE = 30;

/** Nach jeder Anfrage: Dauer und Ergebnis in die Stunde zählen (eine kleine Schreibanfrage) */
function messwert_speichern(PDO $db, int $status, float $ms): void
{
    $stunde = date('Y-m-d\TH');
    $w = [$stunde, (int) round($ms), (int) round($ms), $ms >= LANGSAM_MS ? 1 : 0, $status >= 500 ? 1 : 0];
    q($db, 'insert into messwerte (stunde, anfragen, dauer_ms, max_ms, langsam, fehler) values (?, 1, ?, ?, ?, ?) '
        . (ist_mysql($db)
            ? 'on duplicate key update anfragen = anfragen + 1, dauer_ms = dauer_ms + values(dauer_ms),
               max_ms = greatest(max_ms, values(max_ms)), langsam = langsam + values(langsam), fehler = fehler + values(fehler)'
            : 'on conflict(stunde) do update set anfragen = anfragen + 1, dauer_ms = dauer_ms + excluded.dauer_ms,
               max_ms = max(max_ms, excluded.max_ms), langsam = langsam + excluded.langsam, fehler = fehler + excluded.fehler'), $w);
}

function messwerte_aufraeumen(PDO $db): void
{
    q($db, 'delete from messwerte where stunde < ?', [date('Y-m-d\TH', time() - MESSWERTE_TAGE * 86400)]);
}

const ANFRAGE_LOG_TAGE = 7;
const HINTERGRUND_MERKEN_MS = 5; // kürzere Hintergrund-Aufgaben nicht einzeln aufführen

/** Nach jeder Anfrage: die Phasen dieser Anfrage speichern (für Engpass-Suche und „langsamste Anfragen“) */
function anfrage_log_speichern(PDO $db, string $funktion, int $status, array $sqlVorHintergrund): void
{
    $p = Messung::$phasen;
    $hg = array_filter(Messung::$hintergrund, fn ($ms) => $ms >= HINTERGRUND_MERKEN_MS);
    arsort($hg);
    $hgText = implode(', ', array_map(fn ($k, $ms) => $k . ' ' . (int) round($ms) . ' ms', array_keys($hg), $hg));
    q($db, 'insert into anfrage_log (zeit, funktion, status, ms_gesamt, ms_start, ms_db, ms_sitzung, ms_funktion, sql_anzahl, sql_ms,
            ms_hintergrund, hintergrund, speicher_kb, antwort_frei) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        jetzt(), kuerze($funktion ?: '?', 60), $status, round(Messung::$antwortMs ?? Messung::seitBeginn(), 1),
        round($p['start'] ?? 0, 1), round($p['datenbank'] ?? 0, 1), round($p['sitzung'] ?? 0, 1), round($p['funktion'] ?? 0, 1),
        $sqlVorHintergrund[0], round($sqlVorHintergrund[1], 1),
        round(array_sum(Messung::$hintergrund), 1), kuerze($hgText, 300), (int) (memory_get_peak_usage() / 1024),
        function_exists('fastcgi_finish_request') ? 1 : 0,
    ]);
}

function anfrage_log_aufraeumen(PDO $db): void
{
    q($db, 'delete from anfrage_log where zeit < ?', [zeit_iso(time() - ANFRAGE_LOG_TAGE * 86400)]);
}

/** "128M" -> Bytes; -1 (unbegrenzt) bleibt -1 */
function ini_bytes(string $wert): int
{
    $w = trim($wert);
    if ($w === '' || $w === '-1') return -1;
    $zahl = (int) $w;
    return match (strtolower(substr($w, -1))) { 'g' => $zahl << 30, 'm' => $zahl << 20, 'k' => $zahl << 10, default => $zahl };
}

/** Funktion vorhanden und vom Hoster nicht abgeschaltet? */
function funktion_frei(string $name): bool
{
    return function_exists($name) && !in_array($name, array_map('trim', explode(',', (string) ini_get('disable_functions'))), true);
}

/** Größe der Datenbank in Bytes (SQLite: Datei samt WAL; MySQL: Daten und Indizes) */
function datenbank_groesse(PDO $db): ?int
{
    if (ist_mysql($db)) {
        $g = wert($db, 'select sum(data_length + index_length) from information_schema.tables where table_schema = database()');
        return $g === false || $g === null ? null : (int) $g;
    }
    $datei = (string) (q($db, 'pragma database_list')->fetch()['file'] ?? '');
    if ($datei === '' || !is_file($datei)) return null;
    return (int) filesize($datei) + (is_file("$datei-wal") ? (int) filesize("$datei-wal") : 0);
}

/** Ampel: ['ok'|'warnung'|'fehler', Text] */
function pruefpunkt(string $stufe, string $titel, string $text): array
{
    return ['stufe' => $stufe, 'titel' => $titel, 'text' => $text];
}

/** Zustand des Servers für die Kommandozentrale */
function server_status(PDO $db, bool $https): array
{
    $jetzt = time();
    $seit24 = zeit_iso($jetzt - 86400);
    $ordner = daten_ordner();
    $frei = @disk_free_space($ordner);
    $gesamt = @disk_total_space($ordner);
    $last = funktion_frei('sys_getloadavg') ? @sys_getloadavg() : false;
    $kerne = null;
    if (@is_readable('/proc/cpuinfo')) $kerne = substr_count((string) @file_get_contents('/proc/cpuinfo'), 'processor') ?: null;
    $opcache = funktion_frei('opcache_get_status') ? @opcache_get_status(false) : false;
    $sicherungen = sicherungen_liste();
    $mail = mail_einstellungen($db);
    $mysql = ist_mysql($db);

    // Messwerte der letzten 48 Stunden (fehlende Stunden mit 0)
    $roh = [];
    foreach (zeilen($db, 'select * from messwerte where stunde >= ? order by stunde', [date('Y-m-d\TH', $jetzt - 47 * 3600)]) as $z) $roh[$z['stunde']] = $z;
    $stunden = [];
    for ($i = 47; $i >= 0; $i--) {
        $s = date('Y-m-d\TH', $jetzt - $i * 3600);
        $z = $roh[$s] ?? null;
        $stunden[] = [
            'stunde' => $s, 'anfragen' => (int) ($z['anfragen'] ?? 0),
            'mittel_ms' => $z && $z['anfragen'] ? (int) round($z['dauer_ms'] / $z['anfragen']) : 0,
            'max_ms' => (int) ($z['max_ms'] ?? 0), 'langsam' => (int) ($z['langsam'] ?? 0), 'fehler' => (int) ($z['fehler'] ?? 0),
        ];
    }
    $letzte24 = array_slice($stunden, -24);
    $anfragen24 = array_sum(array_column($letzte24, 'anfragen'));
    $dauer24 = array_sum(array_map(fn ($h) => $h['mittel_ms'] * $h['anfragen'], $letzte24));
    $fehler24 = array_sum(array_column($letzte24, 'fehler'));
    $langsam24 = array_sum(array_column($letzte24, 'langsam'));

    $tabellen = [];
    foreach (TABELLEN as $t) $tabellen[$t] = (int) wert($db, "select count(*) from $t");

    $protokoll = fn ($stufe) => (int) wert($db, 'select count(*) from protokoll where stufe = ? and zeit >= ?', [$stufe, $seit24]);
    $mailsOffen = (int) wert($db, 'select count(*) from mails where gesendet_am is null and versuche < 5');
    $mailsKaputt = (int) wert($db, 'select count(*) from mails where gesendet_am is null and versuche >= 5');
    $letzteSicherung = $sicherungen[0] ?? null;
    $sicherungAlter = $letzteSicherung ? $jetzt - (int) strtotime($letzteSicherung['zeit']) : null;
    $speicherLimit = ini_bytes((string) ini_get('memory_limit'));
    $schutz = is_file($ordner . '/.htaccess') || !str_starts_with(realpath($ordner) ?: $ordner, realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? '')) ?: "\0");

    $pruefungen = [
        $https ? pruefpunkt('ok', 'Verschlüsselung', 'Die App läuft über https.')
            : pruefpunkt('warnung', 'Verschlüsselung', 'Die Anfrage kam ohne https. Im Betrieb bitte nur über https öffnen.'),
        version_compare(PHP_VERSION, '8.1', '>=') ? pruefpunkt('ok', 'PHP', 'PHP ' . PHP_VERSION . '.')
            : pruefpunkt('fehler', 'PHP', 'PHP ' . PHP_VERSION . ' ist zu alt (mindestens 8.1).'),
        $speicherLimit === -1 || $speicherLimit >= 128 << 20 ? pruefpunkt('ok', 'Arbeitsspeicher', 'Grenze für PHP: ' . ini_get('memory_limit') . '.')
            : pruefpunkt('warnung', 'Arbeitsspeicher', 'Nur ' . ini_get('memory_limit') . ' für PHP – bei großen PDFs oder Sicherungen kann das knapp werden (empfohlen: 128M).'),
        $frei === false ? pruefpunkt('warnung', 'Speicherplatz', 'Der Hoster verrät den freien Speicherplatz nicht.')
            : ($frei > 500 << 20 ? pruefpunkt('ok', 'Speicherplatz', groesse_text((int) $frei) . ' frei.')
                : pruefpunkt($frei > 100 << 20 ? 'warnung' : 'fehler', 'Speicherplatz', 'Nur noch ' . groesse_text((int) $frei) . ' frei.')),
        is_writable($ordner) ? pruefpunkt('ok', 'Datenordner', 'Beschreibbar (Sicherungen, Einstellungen).')
            : pruefpunkt('fehler', 'Datenordner', 'Der Ordner für Daten und Sicherungen ist nicht beschreibbar.'),
        $schutz ? pruefpunkt('ok', 'Schutz der Daten', 'Der Datenordner ist von außen nicht abrufbar.')
            : pruefpunkt('warnung', 'Schutz der Daten', 'Im Datenordner fehlt die .htaccess-Sperre.'),
        $sicherungAlter === null ? pruefpunkt('warnung', 'Sicherung', 'Noch keine Sicherung vorhanden.')
            : ($sicherungAlter < 36 * 3600 ? pruefpunkt('ok', 'Sicherung', 'Letzte Sicherung ' . zeitpunkt_text($letzteSicherung['zeit']) . '.')
                : pruefpunkt('warnung', 'Sicherung', 'Letzte Sicherung ist älter als 36 Stunden (' . zeitpunkt_text($letzteSicherung['zeit']) . ').')),
        !$mail['aktiv'] ? pruefpunkt('warnung', 'E-Mail', 'Der E-Mail-Versand ist nicht eingeschaltet.')
            : ($mailsKaputt ? pruefpunkt('fehler', 'E-Mail', "$mailsKaputt E-Mails konnten nicht verschickt werden.")
                : ($mailsOffen > 20 ? pruefpunkt('warnung', 'E-Mail', "$mailsOffen E-Mails warten auf den Versand.") : pruefpunkt('ok', 'E-Mail', 'Versand läuft, keine Rückstände.'))),
        $protokoll('fehler') ? pruefpunkt('fehler', 'Fehler', $protokoll('fehler') . ' Fehler im Protokoll in den letzten 24 Stunden.')
            : pruefpunkt('ok', 'Fehler', 'Keine Fehler in den letzten 24 Stunden.'),
        $anfragen24 && $langsam24 / $anfragen24 > 0.05 ? pruefpunkt('warnung', 'Antwortzeit', "$langsam24 von $anfragen24 Anfragen dauerten über 1 Sekunde.")
            : pruefpunkt('ok', 'Antwortzeit', $anfragen24 ? 'Ø ' . (int) round($dauer24 / max(1, $anfragen24)) . ' ms je Anfrage.' : 'Noch keine Messwerte.'),
    ];
    if (is_array($last) && $kerne) {
        $proKern = $last[0] / $kerne;
        $pruefungen[] = $proKern < 0.7 ? pruefpunkt('ok', 'Auslastung', 'Server-Last ' . number_format($last[0], 2, ',', '') . " bei $kerne Kernen.")
            : pruefpunkt($proKern < 1.5 ? 'warnung' : 'fehler', 'Auslastung', 'Server-Last ' . number_format($last[0], 2, ',', '') . " bei $kerne Kernen – der Server ist stark beschäftigt.");
    }

    return [
        'zeit' => jetzt(),
        'pruefungen' => $pruefungen,
        'auslastung' => [
            'anfragen_24h' => $anfragen24,
            'mittel_ms_24h' => $anfragen24 ? (int) round($dauer24 / $anfragen24) : 0,
            'max_ms_24h' => max(array_column($letzte24, 'max_ms') ?: [0]),
            'langsam_24h' => $langsam24,
            'fehler_24h' => $fehler24,
            'stunden' => $stunden,
            'last' => is_array($last) ? array_map(fn ($x) => round($x, 2), $last) : null,
            'kerne' => $kerne,
            'sitzungen' => (int) wert($db, 'select count(*) from sitzungen where laeuft_ab > ?', [jetzt()]),
            'anmeldungen_24h' => (int) wert($db, "select count(*) from protokoll where bereich = 'anmeldung' and stufe = 'info' and text like 'Angemeldet%' and zeit >= ?", [$seit24]),
            'gesperrt_24h' => (int) wert($db, "select count(*) from protokoll where text like 'Zu viele%' and zeit >= ?", [$seit24]),
            'warnungen_24h' => $protokoll('warnung'),
            'fehler_protokoll_24h' => $protokoll('fehler'),
        ],
        'php' => [
            'version' => PHP_VERSION, 'sapi' => PHP_SAPI, 'betriebssystem' => PHP_OS_FAMILY,
            'server' => (string) ($_SERVER['SERVER_SOFTWARE'] ?? ''),
            'memory_limit' => (string) ini_get('memory_limit'), 'max_execution_time' => (int) ini_get('max_execution_time'),
            'post_max_size' => (string) ini_get('post_max_size'), 'upload_max_filesize' => (string) ini_get('upload_max_filesize'),
            'speicher_jetzt' => memory_get_usage(true), 'speicher_spitze' => memory_get_peak_usage(true),
            'zeitzone' => date_default_timezone_get(),
            'opcache' => is_array($opcache) ? [
                'an' => (bool) ($opcache['opcache_enabled'] ?? false),
                'trefferquote' => round((float) ($opcache['opcache_statistics']['opcache_hit_rate'] ?? 0), 1),
            ] : null,
            'erweiterungen' => array_combine(
                $e = ['pdo_mysql', 'pdo_sqlite', 'mbstring', 'openssl', 'curl', 'json', 'zlib', 'intl'],
                array_map('extension_loaded', $e),
            ),
        ],
        'datenbank' => [
            'typ' => $mysql ? 'MySQL/MariaDB' : 'SQLite',
            'version' => (string) $db->getAttribute(PDO::ATTR_SERVER_VERSION),
            'schema' => (int) ($mysql ? wert($db, 'select max(version) from schema_version') : wert($db, 'pragma user_version')),
            'groesse' => datenbank_groesse($db),
            'tabellen' => $tabellen,
        ],
        'speicher' => [
            'frei' => $frei === false ? null : (int) $frei,
            'gesamt' => $gesamt === false ? null : (int) $gesamt,
            'sicherungen' => count($sicherungen),
            'sicherungen_groesse' => array_sum(array_column($sicherungen, 'groesse')),
            'letzte_sicherung' => $letzteSicherung,
        ],
        'mail' => ['aktiv' => $mail['aktiv'], 'server' => $mail['aktiv'] ? $mail['host'] . ':' . $mail['port'] : '', 'offen' => $mailsOffen, 'fehlgeschlagen' => $mailsKaputt],
    ];
}

/** Zeit für $fn in Millisekunden */
function stoppuhr(callable $fn): float
{
    $t = hrtime(true);
    $fn();
    return (hrtime(true) - $t) / 1e6;
}

/** ein Ergebnis des Leistungstests mit Bewertung (gut / mittel / schlecht nach den Grenzen in ms) */
function testergebnis(string $titel, ?float $ms, array $grenzen, string $text, ?string $fehler = null): array
{
    $stufe = $fehler !== null ? 'fehler' : ($ms <= $grenzen[0] ? 'ok' : ($ms <= $grenzen[1] ? 'warnung' : 'fehler'));
    return ['titel' => $titel, 'ms' => $ms === null ? null : round($ms, 1), 'stufe' => $stufe, 'text' => $fehler ?? $text];
}

/** Leistungstest: Datenbank, Rechenleistung, Dateien, PDF, Erreichbarkeit von Webseite und Mailserver */
function leistungstest(PDO $db): array
{
    $e = [];
    $ms = stoppuhr(function () use ($db) { for ($i = 0; $i < 50; $i++) wert($db, 'select 1'); }) / 50;
    $e[] = testergebnis('Datenbank lesen', $ms, [2, 15], 'Ø je einfache Abfrage (50 Mal).');
    $ms = stoppuhr(function () use ($db) {
        for ($i = 0; $i < 10; $i++) {
            transaktion($db, function () use ($db, $i) {
                q($db, 'insert into versuche (schluessel, zeit) values (?, ?)', ["leistungstest-$i", 0]);
                q($db, 'delete from versuche where schluessel = ?', ["leistungstest-$i"]);
            });
        }
    }) / 10;
    $e[] = testergebnis('Datenbank schreiben', $ms, [15, 80], 'Ø je Speichern mit Transaktion (10 Mal).');
    $ms = stoppuhr(fn () => wert($db, 'select count(*) from noten n join note_positionen np on np.note_id = n.id'));
    $e[] = testergebnis('Große Abfrage', $ms, [50, 300], 'Alle Abrechnungen mit allen Leistungen zählen.');
    $ms = stoppuhr(function () { $h = ''; for ($i = 0; $i < 100000; $i++) $h = hash('sha256', $h . $i, true); });
    $e[] = testergebnis('Rechenleistung', $ms, [150, 600], '100.000 Prüfsummen berechnen.');
    $datei = daten_ordner() . '/leistungstest-' . bin2hex(random_bytes(4)) . '.tmp';
    try {
        $ms = stoppuhr(function () use ($datei) {
            $daten = random_bytes(1 << 20);
            if (file_put_contents($datei, $daten) !== 1 << 20 || file_get_contents($datei) !== $daten) throw new RuntimeException('Lesen oder Schreiben fehlgeschlagen.');
        });
        $e[] = testergebnis('Dateien', $ms, [50, 300], '1 MB schreiben und wieder lesen.');
    } catch (Throwable $f) {
        $e[] = testergebnis('Dateien', null, [0, 0], '', 'Datei konnte nicht geschrieben werden: ' . $f->getMessage());
    } finally {
        @unlink($datei);
    }
    $ms = stoppuhr(function () {
        $pdf = new EinfachesPdf();
        for ($i = 0; $i < 60; $i++) $pdf->text(56, 60 + $i * 12, "Testzeile $i – Prämienabrechnung", 10);
        $pdf->ausgeben('Leistungstest');
    });
    $e[] = testergebnis('PDF erstellen', $ms, [50, 250], 'Eine Seite mit 60 Zeilen (wie das Zahlungsavis).');

    // Datenbank-Verbindung: kostet jede Anfrage einmal (bei MySQL auf einem eigenen Server oft der größte Teil)
    $ziel = konfiguration()['datenbank'];
    if ($ziel !== ':memory:') {
        $werte = [];
        try {
            for ($i = 0; $i < 5; $i++) $werte[] = stoppuhr(fn () => oeffne_datenbank($ziel));
            $e[] = testergebnis('Datenbank-Verbindung', array_sum($werte) / 5, [15, 60],
                'Neu verbinden und Schema prüfen (Ø von 5, langsamste ' . round(max($werte)) . ' ms) – passiert bei jeder Anfrage.');
        } catch (Throwable $f) {
            $e[] = testergebnis('Datenbank-Verbindung', null, [0, 0], '', $f->getMessage());
        }
    }

    // Namensauflösung (DNS): hängt sie, wartet alles, was nach außen geht (Mails, Artikel, Push)
    $m = mail_einstellungen($db);
    $hosts = array_values(array_unique(array_filter([parse_url(MEDIEN['college']['basis'], PHP_URL_HOST), $m['aktiv'] ? $m['host'] : ''])));
    foreach ($hosts as $host) {
        $ips = false;
        $ms = stoppuhr(function () use ($host, &$ips) { $ips = @gethostbynamel($host); });
        $e[] = $ips
            ? testergebnis("DNS $host", $ms, [50, 500], 'Adresse nachschlagen: ' . implode(', ', array_slice($ips, 0, 2)) . '.')
            : testergebnis("DNS $host", $ms, [0, 0], '', 'Name konnte nicht aufgelöst werden.');
    }

    $url = MEDIEN['college']['basis'] . '/';
    $antwort = null;
    $ms = stoppuhr(function () use ($url, &$antwort) { $antwort = standard_holen([$url], microtime(true) + 8)[$url] ?? null; });
    $e[] = is_string($antwort)
        ? testergebnis('campus-a-college.at', $ms, [1500, 5000], 'Startseite abrufen (für „Meine Artikel“).')
        : testergebnis('campus-a-college.at', $ms, [0, 0], '', 'Nicht erreichbar: ' . ($antwort instanceof Throwable ? $antwort->getMessage() : 'keine Antwort'));

    // Mailserver: Verbindung, Verschlüsselung und Anmeldung – genau das, was jede Mail kostet (es wird nichts verschickt)
    if ($m['aktiv'] && $m['host'] !== '') {
        $fehler = null;
        $smtp = null;
        $ms = stoppuhr(function () use ($m, &$fehler, &$smtp) {
            try {
                $smtp = new Smtp($m);
                $smtp->beenden();
            } catch (Throwable $f) {
                $fehler = $f->getMessage();
            }
        });
        $namen = ['verbindung' => 'Verbindung', 'verbindung_tls' => 'Verbindung mit TLS', 'begruessung' => 'Begrüßung', 'ehlo' => 'EHLO',
            'tls' => 'STARTTLS', 'anmeldung' => 'Anmeldung'];
        $schritte = $smtp ? implode(' · ', array_map(fn ($k, $v) => ($namen[$k] ?? $k) . " $v ms", array_keys($smtp->zeiten), $smtp->zeiten)) : '';
        $e[] = testergebnis('Mailserver', $ms, [800, 3000], "{$m['host']}:{$m['port']} – $schritte. So lange braucht jede Mail zusätzlich.", $fehler);
    }

    // Umgebung: kann der Server die Antwort vor der Hintergrundarbeit abschicken? Ist OPcache an?
    $fpm = function_exists('fastcgi_finish_request');
    $e[] = ['titel' => 'Antwort vor Hintergrundarbeit', 'ms' => null, 'stufe' => $fpm ? 'ok' : 'warnung',
        'text' => $fpm ? 'PHP-FPM: Mails, Push und Sicherung laufen erst nach der Antwort – der Browser wartet nicht darauf.'
            : 'PHP ohne FPM (' . PHP_SAPI . '): die Antwort wird mit „flush“ geschickt; mit Kompression kann der Browser trotzdem warten. Siehe Browser-Messung.'];
    $opcache = function_exists('opcache_get_status') ? @opcache_get_status(false) : false;
    $e[] = ['titel' => 'OPcache', 'ms' => null, 'stufe' => $opcache && $opcache['opcache_enabled'] ? 'ok' : 'warnung',
        'text' => $opcache && $opcache['opcache_enabled']
            ? 'An – Trefferquote ' . round($opcache['opcache_statistics']['opcache_hit_rate'] ?? 0, 1) . ' %, '
                . round(($opcache['memory_usage']['used_memory'] ?? 0) / 1048576, 1) . ' MB belegt.'
            : 'Aus oder nicht abfragbar – dann lädt PHP die App bei jeder Anfrage neu (siehe „Programmstart“ in der Engpass-Tabelle).'];
    $zlib = filter_var(ini_get('zlib.output_compression'), FILTER_VALIDATE_BOOLEAN);
    $e[] = ['titel' => 'Kompression der Antworten', 'ms' => null, 'stufe' => 'ok',
        'text' => ($zlib ? 'zlib.output_compression ist an – die App schaltet es für die Schnittstelle ab. ' : 'zlib.output_compression ist aus. ')
            . 'Apache-Kompression (mod_deflate) ist für api/ in der .htaccess abgeschaltet.'];

    return ['zeit' => jetzt(), 'ergebnisse' => $e, 'gesamt_ms' => round(array_sum(array_column($e, 'ms')), 1)];
}

/** Abbruch des Funktionstests: alles in der Transaktion wird zurückgenommen */
final class FunktionstestZurueck extends Exception
{
}

/**
 * Funktionstest: der ganze Ablauf mit drei Testkonten – Leistungen speichern (mit Nachweis), einreichen, Rückfrage,
 * prüfen, annehmen, bezahlen, Zahlungsavis. Alles läuft in einer Transaktion, die am Ende zurückgenommen wird:
 * es bleibt nichts übrig und keine E-Mail geht hinaus.
 */
function funktionstest(PDO $db): array
{
    $schritte = [];
    $kennung = bin2hex(random_bytes(3));
    $adresse = fn (string $rolle) => "funktionstest-$kennung-$rolle@example.invalid";
    $schritt = function (string $titel, callable $fn) use (&$schritte): mixed {
        $t = hrtime(true);
        try {
            [$text, $wert, $stufe] = $fn() + [null, null, 'ok'];
            $schritte[] = ['titel' => $titel, 'stufe' => $stufe, 'text' => (string) $text, 'ms' => round((hrtime(true) - $t) / 1e6, 1)];
            return $wert;
        } catch (Throwable $e) {
            $schritte[] = ['titel' => $titel, 'stufe' => 'fehler', 'text' => $e->getMessage(), 'ms' => round((hrtime(true) - $t) / 1e6, 1)];
            throw new FunktionstestZurueck();
        }
    };
    try {
        transaktion($db, function () use ($db, $schritt, $adresse, $kennung) {
            $ids = $schritt('Testkonten anlegen', function () use ($db, $adresse) {
                $ids = [];
                foreach (['autor' => ['autor', 'redigieren'], 'redaktion' => ['redaktion'], 'buchhaltung' => ['buchhaltung']] as $k => $rollen) {
                    $ids[$k] = konto_einfuegen($db, 'Funktionstest', ucfirst($k), $adresse($k), $rollen, BLIND_HASH);
                }
                q($db, "update nutzer set muss_passwort_aendern = 0, strasse = 'Testgasse 1', plz_ort = '1010 Wien',
                        iban = 'AT611904300234573201', campus_profil = 'ae10f00d' where id = ?", [$ids['autor']]);
                q($db, 'update nutzer set muss_passwort_aendern = 0 where id in (?, ?)', [$ids['redaktion'], $ids['buchhaltung']]);
                return ['Autor:in, Redaktion und Buchhaltung', $ids];
            });
            $als = fn (string $k) => new Honorare(new Ctx($db, nutzer_laden($db, $ids[$k])));
            $heute = heute_iso();
            $pids = $schritt('Leistungen speichern', function () use ($als, $heute) {
                $a = $als('autor');
                $p1 = $a->leistungSpeichern(['kategorie' => 'kolumne', 'titel' => 'Funktionstest Kolumne', 'veroeffentlichung' => $heute, 'betrag' => 15, 'medium' => 'college']);
                $p2 = $a->leistungSpeichern(['kategorie' => 'redigieren', 'anzahl' => 2, 'veroeffentlichung' => $heute]);
                $a->nachweisHochladen($p2, 'Funktionstest.pdf', base64_encode("%PDF-1.4\n% Funktionstest\n%%EOF\n"));
                pruefe(count($a->meineLeistungen()) === 2, 'Die gespeicherten Leistungen fehlen in „Mein Monat“.');
                return ['Kolumne und Redigieren mit Nachweis (PDF)', [$p1, $p2]];
            });
            $note = $schritt('Prämienabrechnung einreichen', function () use ($als, $pids) {
                $note = $als('autor')->abrechnungAbschicken($pids);
                return ["{$note['nummer']} über " . eur($note['betrag']), $note];
            });
            $schritt('Redaktion sieht die Abrechnung', function () use ($als, $note) {
                $l = $als('redaktion')->redaktionListe(['status' => 'eingereicht', 'suche' => $note['nummer']]);
                pruefe(in_array($note['id'], array_column($l['noten'], 'id'), true), 'Die Abrechnung fehlt in der Liste der Redaktion.');
                return ['In „Zu prüfen“ gefunden'];
            });
            $schritt('Rückfrage und Antwort', function () use ($als, $note) {
                $als('redaktion')->nachfragen($note['id'], 'Funktionstest: Frage der Redaktion');
                $als('autor')->rueckfrageBeantworten($note['id'], 'Funktionstest: Antwort');
                pruefe(count($als('redaktion')->nachrichten($note['id'])) === 2, 'Die Nachrichten fehlen.');
                return ['Redaktion fragt, Autor:in antwortet'];
            });
            $schritt('Prüfen und annehmen', function () use ($als, $note) {
                $r = $als('redaktion');
                foreach ($note['positionen'] as $p) $r->positionPruefen($note['id'], $p['id'], true);
                $r->annehmen($note['id']);
                return [count($note['positionen']) . ' Leistungen abgehakt, angenommen'];
            });
            $schritt('Buchhaltung bezahlt', function () use ($als, $note, $heute) {
                $b = $als('buchhaltung');
                pruefe(in_array($note['id'], array_column($b->offeneZahlungen(), 'id'), true), 'Die Abrechnung fehlt bei der Buchhaltung.');
                $b->alsBezahltMarkieren($note['id'], $heute);
                return ['Als bezahlt markiert'];
            });
            $schritt('Zahlungsavis (PDF)', function () use ($als, $note) {
                $avis = $als('autor')->zahlungsavis($note['id']);
                pruefe(str_starts_with((string) base64_decode($avis['inhalt']), '%PDF'), 'Das Zahlungsavis ist kein PDF.');
                return [$avis['name']];
            });
            $schritt('E-Mails vorbereitet', function () use ($db, $kennung) {
                if (!mail_einstellungen($db)['aktiv']) return ['Der E-Mail-Versand ist ausgeschaltet – im Betrieb gingen hier keine E-Mails hinaus.', null, 'warnung'];
                $n = (int) wert($db, 'select count(*) from mails where an like ?', ["funktionstest-$kennung-%"]);
                pruefe($n >= 3, "Nur $n E-Mails vorbereitet (erwartet: Eingang, Rückfrage, Annahme, Zahlung …).");
                return ["$n E-Mails – werden nicht verschickt"];
            });
            throw new FunktionstestZurueck(); // alles zurücknehmen
        });
    } catch (FunktionstestZurueck) {
    }
    $rest = (int) wert($db, 'select count(*) from nutzer where email like ?', ["funktionstest-$kennung-%"])
        + (int) wert($db, 'select count(*) from mails where an like ?', ["funktionstest-$kennung-%"]);
    $schritte[] = $rest === 0
        ? ['titel' => 'Aufgeräumt', 'stufe' => 'ok', 'text' => 'Testkonten, Abrechnung und E-Mails sind wieder weg.', 'ms' => null]
        : ['titel' => 'Aufgeräumt', 'stufe' => 'fehler', 'text' => "Es sind noch $rest Testeinträge übrig.", 'ms' => null];
    $ok = !array_filter($schritte, fn ($s) => $s['stufe'] === 'fehler');
    return ['zeit' => jetzt(), 'ok' => $ok, 'schritte' => $schritte];
}

/** p-Perzentil (0–100) einer Zahlenliste */
function perzentil(array $werte, float $p): float
{
    if (!$werte) return 0;
    sort($werte);
    $i = ($p / 100) * (count($werte) - 1);
    $u = (int) floor($i);
    return $werte[$u] + ($werte[min($u + 1, count($werte) - 1)] - $werte[$u]) * ($i - $u);
}

function kennzahlen(array $werte): array
{
    return [
        'avg' => $werte ? round(array_sum($werte) / count($werte), 1) : 0,
        'p50' => round(perzentil($werte, 50), 1),
        'p95' => round(perzentil($werte, 95), 1),
        'max' => $werte ? round(max($werte), 1) : 0,
    ];
}

const PHASEN = [
    'ms_start' => ['Programmstart', 'PHP lädt die App (ohne OPcache jedes Mal neu)'],
    'ms_db' => ['Datenbank verbinden', 'Verbindung aufbauen und Schema-Stand prüfen'],
    'ms_sitzung' => ['Anmeldung prüfen', 'Sitzung, Konto, Wartungsmodus'],
    'ms_funktion' => ['Funktion', 'die eigentliche Arbeit (Laden, Speichern …)'],
    'sql_ms' => ['davon SQL', 'Zeit in Datenbankabfragen (in den Phasen oben enthalten)'],
    'ms_gesamt' => ['Antwort gesamt', 'bis die Antwort geschickt ist'],
    'ms_hintergrund' => ['Danach im Hintergrund', 'Mails, Push, Sicherung, Aufräumen – nach der Antwort'],
];

/**
 * Engpass-Suche über die letzten Stunden: Phasen, je Funktion, langsamste Anfragen, Hintergrundarbeit
 * und automatische Befunde mit Erklärung.
 */
function anfrage_analyse(PDO $db, int $stunden): array
{
    $zeilen = zeilen($db, 'select * from anfrage_log where zeit >= ? order by zeit', [zeit_iso(time() - $stunden * 3600)]);
    $spalte = fn (string $k, ?array $z = null) => array_map(fn ($r) => (float) $r[$k], $z ?? $zeilen);
    $phasen = [];
    foreach (PHASEN as $k => [$titel, $text]) $phasen[] = ['schluessel' => $k, 'titel' => $titel, 'text' => $text] + kennzahlen($spalte($k));

    // je Funktion
    $gruppen = [];
    foreach ($zeilen as $z) $gruppen[$z['funktion']][] = $z;
    $jeFunktion = [];
    foreach ($gruppen as $f => $g) {
        $jeFunktion[] = ['funktion' => $f, 'anzahl' => count($g)] + kennzahlen($spalte('ms_gesamt', $g)) + [
            'sql_anzahl' => round(array_sum($spalte('sql_anzahl', $g)) / count($g), 1),
            'sql_ms' => round(array_sum($spalte('sql_ms', $g)) / count($g), 1),
            'funktion_ms' => round(array_sum($spalte('ms_funktion', $g)) / count($g), 1),
        ];
    }
    usort($jeFunktion, fn ($a, $b) => $b['p95'] <=> $a['p95']);

    // Hintergrund: „mails 820 ms, push 12 ms“ je Aufgabe zusammenzählen
    $aufgaben = [];
    foreach ($zeilen as $z) {
        foreach (array_filter(explode(', ', (string) $z['hintergrund'])) as $teil) {
            if (preg_match('/^(\S+) (\d+) ms$/', $teil, $m)) $aufgaben[$m[1]][] = (float) $m[2];
        }
    }
    $hintergrund = [];
    foreach ($aufgaben as $name => $w) $hintergrund[] = ['aufgabe' => $name, 'anzahl' => count($w)] + kennzahlen($w);
    usort($hintergrund, fn ($a, $b) => $b['max'] <=> $a['max']);

    $langsamste = $zeilen;
    usort($langsamste, fn ($a, $b) => $b['ms_gesamt'] <=> $a['ms_gesamt']);
    $langsamste = array_map(fn ($z) => array_intersect_key($z, array_flip(['zeit', 'funktion', 'status', 'ms_gesamt', 'ms_start', 'ms_db',
        'ms_sitzung', 'ms_funktion', 'sql_anzahl', 'sql_ms', 'ms_hintergrund', 'hintergrund', 'speicher_kb'])), array_slice($langsamste, 0, 15));

    return [
        'stunden' => $stunden, 'anzahl' => count($zeilen), 'phasen' => $phasen, 'je_funktion' => $jeFunktion,
        'hintergrund' => $hintergrund, 'langsamste' => $langsamste,
        'befunde' => engpass_befunde($zeilen, $phasen, $jeFunktion, $hintergrund),
    ];
}

/** Aus den Messwerten verständliche Befunde ableiten: was bremst, woran es liegt, was hilft */
function engpass_befunde(array $zeilen, array $phasen, array $jeFunktion, array $hintergrund): array
{
    if (!$zeilen) return [pruefpunkt('info', 'Noch keine Messwerte', 'Sobald die App benutzt wird, erscheinen hier die Zeiten jeder Anfrage.')];
    $p = array_column($phasen, null, 'schluessel');
    $b = [];
    $fpm = function_exists('fastcgi_finish_request');
    $hgMax = max(array_column($hintergrund, 'max') ?: [0]);
    if (!$fpm && $hgMax >= 300) {
        $b[] = pruefpunkt('warnung', 'Antworten können auf Hintergrundarbeit warten',
            'Dieser Server (PHP ohne FPM) kann die Antwort nicht sicher vor der Hintergrundarbeit abschließen. Dauerte die bis zu '
            . round($hgMax) . ' ms (z. B. Mails), kann der Browser so lange warten – das wären „mal schnell, mal ewig“-Momente. '
            . 'Die App schaltet die Kompression für die Schnittstelle deshalb ab; ob es reicht, zeigt die Browser-Messung unten '
            . '(„Wartezeit nach Server-Ende“).');
    } elseif ($hgMax >= 300) {
        $b[] = pruefpunkt('ok', 'Hintergrundarbeit bremst nicht',
            'Mails, Push und Sicherung liefen bis zu ' . round($hgMax) . ' ms – aber erst nach der Antwort (PHP-FPM), der Browser wartet darauf nicht.');
    }
    if ($p['ms_start']['avg'] > 40) {
        $b[] = pruefpunkt('warnung', 'Programmstart langsam (Ø ' . round($p['ms_start']['avg']) . ' ms)',
            'PHP lädt die App bei jeder Anfrage neu. Mit eingeschaltetem OPcache (siehe Zustand) sind es meist unter 10 ms.');
    }
    if ($p['ms_db']['avg'] > 30) {
        $b[] = pruefpunkt('warnung', 'Verbindung zur Datenbank kostet Ø ' . round($p['ms_db']['avg']) . ' ms je Anfrage',
            'Jede Anfrage baut die Verbindung neu auf (bei World4You liegt MySQL auf einem eigenen Server). Spitze: '
            . round($p['ms_db']['max']) . ' ms. Wenig dagegen zu tun – außer weniger Anfragen pro Seite.');
    }
    if ($p['ms_sitzung']['avg'] > 30) {
        $b[] = pruefpunkt('warnung', 'Anmeldung prüfen dauert Ø ' . round($p['ms_sitzung']['avg']) . ' ms', 'Sitzung und Konto werden je Anfrage aus der Datenbank gelesen.');
    }
    foreach (array_slice($jeFunktion, 0, 5) as $f) {
        if ($f['anzahl'] >= 3 && $f['p95'] >= 800) {
            $b[] = pruefpunkt('warnung', "„{$f['funktion']}“ ist oft langsam (95 % unter " . round($f['p95']) . ' ms)',
                'Ø ' . round($f['avg']) . " ms bei {$f['anzahl']} Aufrufen, davon Funktion Ø {$f['funktion_ms']} ms, "
                . "{$f['sql_anzahl']} SQL-Abfragen mit Ø {$f['sql_ms']} ms.");
        }
        if ($f['sql_anzahl'] >= 40) {
            $b[] = pruefpunkt('warnung', "„{$f['funktion']}“ macht viele Datenbankabfragen (Ø {$f['sql_anzahl']})",
                'Bei einer entfernten Datenbank kostet jede Abfrage Zeit – hier lohnt es sich zusammenzufassen.');
        }
    }
    foreach ($hintergrund as $h) {
        if ($h['aufgabe'] === 'mails' && $h['max'] >= 2000) {
            $b[] = pruefpunkt('info', 'Mailversand dauerte bis zu ' . round($h['max'] / 1000, 1) . ' s',
                'Verbindung, Verschlüsselung und Anmeldung beim Mailserver. Der Leistungstest zeigt, welcher Schritt so lange braucht.');
        }
    }
    $langsam = count(array_filter($zeilen, fn ($z) => $z['ms_gesamt'] >= LANGSAM_MS));
    if (!array_filter($b, fn ($x) => $x['stufe'] === 'warnung')) {
        $b[] = pruefpunkt('ok', 'Server antwortet zügig',
            'Ø ' . round($p['ms_gesamt']['avg']) . ' ms, 95 % unter ' . round($p['ms_gesamt']['p95']) . ' ms'
            . ($langsam ? ", $langsam langsame Anfragen (über 1 s)." : ', keine langsame Anfrage. Wenn es sich trotzdem langsam anfühlt: Browser-Messung unten (Netz, Laden der Seite).'));
    }
    return $b;
}
