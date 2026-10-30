<?php
// Kleine Helfer für den ganzen Server (gleiches Verhalten wie die Gegenstücke in JavaScript).
declare(strict_types=1);

/**
 * Zeitmessung einer Anfrage für die Kommandozentrale: Phasen (Start, Datenbank, Sitzung, Funktion),
 * Anzahl und Dauer der SQL-Abfragen und was nach der Antwort im Hintergrund lief.
 */
final class Messung
{
    public static float $beginn = 0;   // hrtime der Anfrage (so früh wie möglich gesetzt)
    private static float $marke = 0;
    public static array $phasen = [];  // Name => ms
    public static int $sql = 0;
    public static float $sqlMs = 0;
    public static array $hintergrund = []; // Aufgabe => ms
    public static ?float $antwortMs = null;

    public static function start(?float $beginn = null): void
    {
        self::$beginn = self::$marke = $beginn ?? hrtime(true);
    }

    /** Zeit seit der letzten Marke dieser Phase zuschreiben */
    public static function phase(string $name): void
    {
        if (!self::$beginn) return;
        $jetzt = hrtime(true);
        self::$phasen[$name] = (self::$phasen[$name] ?? 0) + ($jetzt - self::$marke) / 1e6;
        self::$marke = $jetzt;
    }

    public static function seitBeginn(): float
    {
        return self::$beginn ? (hrtime(true) - self::$beginn) / 1e6 : 0;
    }

    /** Hintergrund-Aufgabe ausführen und ihre Dauer merken */
    public static function hintergrund(string $name, callable $fn): mixed
    {
        $t = hrtime(true);
        try {
            return $fn();
        } finally {
            self::$hintergrund[$name] = (self::$hintergrund[$name] ?? 0) + (hrtime(true) - $t) / 1e6;
        }
    }
}

final class Fehler extends Exception
{
    public function __construct(string $meldung, public readonly int $status = 400)
    {
        parent::__construct($meldung);
    }
}

function pruefe(mixed $bedingung, string $meldung, int $status = 400): void
{
    if (!$bedingung) throw new Fehler($meldung, $status);
}

/** Wie String(x ?? '') in JavaScript (für Eingaben aus dem Browser) */
function s(mixed $x): string
{
    if ($x === null) return '';
    if (is_bool($x)) return $x ? 'true' : 'false';
    if (is_float($x) && floor($x) === $x && abs($x) < 1e15) return (string) (int) $x;
    if (is_scalar($x)) return (string) $x;
    return '';
}

/** trim() wie in JavaScript – auch geschützte Leerzeichen */
function tr(mixed $x): string
{
    return preg_replace('/^[\s\p{Z}\x{FEFF}]+|[\s\p{Z}\x{FEFF}]+$/u', '', s($x)) ?? '';
}

function leer(mixed $x): bool
{
    return tr($x) === '';
}

/** Ersten n Zeichen (UTF-8) */
function kuerze(string $t, int $n): string
{
    return mb_substr($t, 0, $n, 'UTF-8');
}

function ist_email(string $e): bool
{
    return (bool) preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/u', $e);
}

/** Zufällige UUID (Version 4) */
function neue_id(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}

/** Zeitstempel wie Date.toISOString(): 2026-09-01T12:00:00.000Z */
function jetzt(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

/** Heutiges Datum in Wien als "JJJJ-MM-TT" */
function heute_iso(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Vienna')))->format('Y-m-d');
}

function ist_datum(mixed $d): bool
{
    $t = s($d);
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $t, $m)) return false;
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

/** Zahl aus einer Eingabe wie Number(x) in JavaScript; null, wenn keine Zahl */
function zahl(mixed $x): ?float
{
    if (is_int($x) || is_float($x)) return is_finite((float) $x) ? (float) $x : null;
    if (is_string($x)) {
        $t = trim($x);
        if ($t === '') return 0.0;
        return is_numeric($t) ? (float) $t : null;
    }
    if ($x === null || $x === false) return 0.0;
    if ($x === true) return 1.0;
    return null;
}

/** Betrag in Euro -> Cent; wirft bei ungültigem Wert */
function cent(mixed $betrag): int
{
    $b = zahl($betrag);
    $c = $b === null ? 0 : (int) round($b * 100);
    pruefe($b !== null && $c > 0 && $c <= 10000000 && abs($b * 100 - $c) < 1e-6, 'Bitte einen gültigen Betrag angeben.');
    return $c;
}

/** Cent -> Euro (ganze Euro als Ganzzahl, sonst Kommazahl) */
function euro(int $c): int|float
{
    return $c % 100 === 0 ? intdiv($c, 100) : $c / 100;
}

function json_text(mixed $daten, int $flags = 0): string
{
    return json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR | $flags);
}

/** HTML-Sonderzeichen maskieren */
function h(mixed $x): string
{
    return htmlspecialchars(s($x), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
