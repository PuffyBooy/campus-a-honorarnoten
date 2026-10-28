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

    $url = MEDIEN['college']['basis'] . '/';
    $antwort = null;
    $ms = stoppuhr(function () use ($url, &$antwort) { $antwort = standard_holen([$url], microtime(true) + 8)[$url] ?? null; });
    $e[] = is_string($antwort)
        ? testergebnis('campus-a-college.at', $ms, [1500, 5000], 'Startseite abrufen (für „Meine Artikel“).')
        : testergebnis('campus-a-college.at', $ms, [0, 0], '', 'Nicht erreichbar: ' . ($antwort instanceof Throwable ? $antwort->getMessage() : 'keine Antwort'));

    $m = mail_einstellungen($db);
    if ($m['aktiv'] && $m['host'] !== '') {
        $fehler = null;
        $ms = stoppuhr(function () use ($m, &$fehler) {
            $s = @stream_socket_client('tcp://' . $m['host'] . ':' . (int) $m['port'], $nr, $text, 8);
            if ($s === false) $fehler = "Keine Verbindung zu {$m['host']}:{$m['port']} ($text)";
            else fclose($s);
        });
        $e[] = testergebnis('Mailserver', $ms, [300, 2000], "Verbindung zu {$m['host']}:{$m['port']} aufbauen.", $fehler);
    }
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
