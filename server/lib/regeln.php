<?php
// Regeln, die auch der Browser kennt (public/js/lib/campus.js, konto.js, iban.js, nummer.js, honorarsaetze.js, format.js).
// Hier für den Server nachgebaut – tests/php-gleich.test.mjs prüft, dass beide Seiten gleich rechnen.
declare(strict_types=1);

// ------------------------------------------------------------------ Medien (campus.js)

const MEDIEN = [
    'college' => [
        'name' => 'campus a college',
        'seite' => 'campus-a-college.at',
        'basis' => 'https://www.campus-a-college.at',
        'profilLink' => '~^(?:https?://)?(?:www\.)?campus-a-college\.at/profil/([0-9a-fA-F]+)/?(?:[?#].*)?$~',
        'artikel' => '~^https://www\.campus-a-college\.at/news/detail/[a-z0-9-]{1,250}$~',
    ],
    'campus-a' => [
        'name' => 'campus a',
        'seite' => 'campus-a.at',
        'basis' => 'https://campus-a.at',
        'profilLink' => '~^(?:https?://)?(?:www\.)?campus-a\.at/profil/([0-9a-fA-F]+)/?(?:[?#].*)?$~',
        'artikel' => '~^https://campus-a\.at/news/news-detail/[a-z0-9-]{1,250}$~',
    ],
];
const MEDIUM_KEYS = ['college', 'campus-a'];
const STANDARD_MEDIUM = 'college';
const PROFIL_FELD = ['college' => 'campus_profil', 'campus-a' => 'campus_a_profil'];

function ist_medium(mixed $m): bool
{
    return is_string($m) && isset(MEDIEN[$m]);
}

function medium_oder(mixed $m): string
{
    return ist_medium($m) ? $m : STANDARD_MEDIUM;
}

function medium_name(mixed $m): string
{
    return MEDIEN[medium_oder($m)]['name'];
}

/** Medien, für die im Profil ein Link hinterlegt ist */
function verbundene_medien(array $profil): array
{
    return array_values(array_filter(MEDIUM_KEYS, fn ($m) => tr($profil[PROFIL_FELD[$m]] ?? '') !== ''));
}

function nicht_verbunden(mixed $m): string
{
    $x = MEDIEN[medium_oder($m)];
    return "Für {$x['name']} ist kein Profil-Link hinterlegt. Bitte zuerst im Profil den Link zu {$x['seite']} eintragen.";
}

/** Profil-ID aus dem Profil-Link; leer -> '', ungültig oder Link der anderen Seite -> null */
function profil_id_aus_link(mixed $text, string $medium = STANDARD_MEDIUM): ?string
{
    $t = tr($text);
    if ($t === '') return '';
    $treffer = preg_match(MEDIEN[medium_oder($medium)]['profilLink'], $t, $m);
    if (!$treffer && str_contains($t, '/')) return null;
    $kandidat = strtolower($treffer ? $m[1] : $t);
    return preg_match('/^[0-9a-f]{12,40}$/', $kandidat) ? $kandidat : null;
}

function profil_link(string $profilId, string $medium = STANDARD_MEDIUM): string
{
    return $profilId === '' ? '' : MEDIEN[medium_oder($medium)]['basis'] . '/profil/' . $profilId;
}

/** Medium einer Artikel-Adresse, oder null */
function medium_von_artikel(mixed $url): ?string
{
    $u = s($url);
    foreach (MEDIUM_KEYS as $m) {
        if (preg_match(MEDIEN[$m]['artikel'], $u)) return $m;
    }
    return null;
}

// ------------------------------------------------------------------ Konto (konto.js)

const ROLLEN = ['autor', 'redaktion', 'buchhaltung', 'admin', 'redigieren'];
const KONTO_FEHLT = 'Bitte zuerst dein Konto einrichten (Adresse, Bankverbindung und Profil-Link).';

function konto_fehlt(?array $n): array
{
    if (!$n || !in_array('autor', $n['rollen'] ?? [], true)) return [];
    $p = $n['profil'] ?? [];
    $fehlt = [];
    if (leer($p['strasse'] ?? '') || leer($p['plz_ort'] ?? '')) $fehlt[] = 'Adresse';
    if (leer($p['kontoinhaber'] ?? '') || iban_fehler($p['iban'] ?? '') !== null) $fehlt[] = 'Bankverbindung';
    $link = false;
    foreach (MEDIUM_KEYS as $m) if (!leer($p[PROFIL_FELD[$m]] ?? '')) $link = true;
    if (!$link) $fehlt[] = 'Profil-Link';
    return $fehlt;
}

function konto_fertig(?array $n): bool
{
    return konto_fehlt($n) === [];
}

function rollen_normalisieren(mixed $rollen): array
{
    $liste = is_array($rollen) ? $rollen : [];
    $r = array_values(array_filter(ROLLEN, fn ($x) => in_array($x, $liste, true)));
    if (in_array('redigieren', $r, true) && !in_array('autor', $r, true)) array_unshift($r, 'autor');
    return $r;
}

function darf_redigieren(?array $n): bool
{
    return in_array('redigieren', $n['rollen'] ?? [], true);
}

// ------------------------------------------------------------------ Benachrichtigungen (benachrichtigungen.js)

/** Art => Rollen, die sie bekommen können (Admins können zusätzlich neue_note und zur_zahlung einschalten) */
const BENACHRICHTIGUNGEN = [
    'neue_note' => ['redaktion'], 'zur_zahlung' => ['buchhaltung'], 'anfrage' => ['admin'],
    'eingang' => ['autor'], 'angenommen' => ['autor'], 'abgelehnt' => ['autor'], 'bezahlt' => ['autor'],
    'probleme' => ['admin'],
];
const BENACHRICHTIGUNGEN_FUER_ADMIN = ['neue_note', 'zur_zahlung'];

function benachrichtigung_verfuegbar(array $n, string $typ): bool
{
    $r = $n['rollen'] ?? [];
    return (bool) array_intersect(BENACHRICHTIGUNGEN[$typ] ?? [], $r)
        || (in_array('admin', $r, true) && in_array($typ, BENACHRICHTIGUNGEN_FUER_ADMIN, true));
}

/** Bekommt dieses Konto diese E-Mail? Ohne eigene Wahl: an (für reine Admins Redaktion/Buchhaltung aus) */
function bekommt(array $n, string $typ): bool
{
    if (!benachrichtigung_verfuegbar($n, $typ)) return false;
    $wahl = $n['benachrichtigungen'][$typ] ?? null;
    return is_bool($wahl) ? $wahl : (bool) array_intersect(BENACHRICHTIGUNGEN[$typ], $n['rollen'] ?? []);
}

function benachrichtigungen_normalisieren(array $n, mixed $wahl): array
{
    $neu = is_array($n['benachrichtigungen'] ?? null) ? $n['benachrichtigungen'] : [];
    foreach (array_keys(BENACHRICHTIGUNGEN) as $typ) {
        if (benachrichtigung_verfuegbar($n, $typ) && is_array($wahl) && is_bool($wahl[$typ] ?? null)) $neu[$typ] = $wahl[$typ];
    }
    return $neu;
}

// ------------------------------------------------------------------ IBAN/BIC (iban.js)

const IBAN_LAENGEN = [
    'AD' => 24, 'AT' => 20, 'BE' => 16, 'BG' => 22, 'CH' => 21, 'CY' => 28, 'CZ' => 24, 'DE' => 22, 'DK' => 18,
    'EE' => 20, 'ES' => 24, 'FI' => 18, 'FR' => 27, 'GB' => 22, 'GI' => 23, 'GR' => 27, 'HR' => 21, 'HU' => 28,
    'IE' => 22, 'IS' => 26, 'IT' => 27, 'LI' => 21, 'LT' => 20, 'LU' => 20, 'LV' => 21, 'MC' => 27, 'MT' => 31,
    'NL' => 18, 'NO' => 15, 'PL' => 28, 'PT' => 25, 'RO' => 24, 'SE' => 24, 'SI' => 19, 'SK' => 24, 'SM' => 27,
    'VA' => 22,
];

function iban_normalisieren(mixed $v): string
{
    return mb_strtoupper(preg_replace('/[\s\p{Z}]+/u', '', s($v)) ?? '', 'UTF-8');
}

/** null, wenn gültig, sonst eine Fehlermeldung */
function iban_fehler(mixed $v): ?string
{
    $s = iban_normalisieren($v);
    if ($s === '') return 'Bitte IBAN angeben.';
    if (!preg_match('/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/', $s)) return 'Die IBAN hat ein ungültiges Format.';
    $land = substr($s, 0, 2);
    if (isset(IBAN_LAENGEN[$land]) && IBAN_LAENGEN[$land] !== strlen($s)) {
        return 'Eine IBAN aus ' . $land . ' hat ' . IBAN_LAENGEN[$land] . ' Zeichen (eingegeben: ' . strlen($s) . ').';
    }
    $umgestellt = substr($s, 4) . substr($s, 0, 4);
    $rest = 0;
    foreach (str_split($umgestellt) as $ch) {
        $code = ord($ch);
        $rest = $code <= 57 ? ($rest * 10 + ($code - 48)) % 97 : ($rest * 100 + ($code - 55)) % 97;
    }
    return $rest === 1 ? null : 'Die Prüfziffer der IBAN stimmt nicht – bitte Tippfehler prüfen.';
}

function iban_formatieren(mixed $v): string
{
    return trim(chunk_split(iban_normalisieren($v), 4, ' '));
}

function bic_normalisieren(mixed $v): string
{
    return mb_strtoupper(preg_replace('/[\s\p{Z}]+/u', '', s($v)) ?? '', 'UTF-8');
}

function bic_gueltig(mixed $v): bool
{
    $s = bic_normalisieren($v);
    return $s === '' || (bool) preg_match('/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/', $s);
}

// ------------------------------------------------------------------ Nummer der Prämienabrechnung (nummer.js)

// Buchstaben mit Akzent -> Grundbuchstabe (wie normalize('NFD') im Browser; ohne PHP-Erweiterung intl)
const OHNE_AKZENT = [
    'À' => 'A', 'Á' => 'A', 'Â' => 'A', 'Ã' => 'A', 'Å' => 'A', 'Ç' => 'C', 'È' => 'E', 'É' => 'E', 'Ê' => 'E', 'Ë' => 'E', 'Ì' => 'I', 'Í' => 'I',
    'Î' => 'I', 'Ï' => 'I', 'Ñ' => 'N', 'Ò' => 'O', 'Ó' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ù' => 'U', 'Ú' => 'U', 'Û' => 'U', 'Ý' => 'Y', 'Ÿ' => 'Y',
    'Ā' => 'A', 'Ă' => 'A', 'Ą' => 'A', 'Ć' => 'C', 'Ĉ' => 'C', 'Ċ' => 'C', 'Č' => 'C', 'Ď' => 'D', 'Ē' => 'E', 'Ĕ' => 'E', 'Ė' => 'E', 'Ę' => 'E',
    'Ě' => 'E', 'Ĝ' => 'G', 'Ğ' => 'G', 'Ġ' => 'G', 'Ģ' => 'G', 'Ĥ' => 'H', 'Ĩ' => 'I', 'Ī' => 'I', 'Ĭ' => 'I', 'Į' => 'I', 'İ' => 'I', 'Ĵ' => 'J',
    'Ķ' => 'K', 'Ĺ' => 'L', 'Ļ' => 'L', 'Ľ' => 'L', 'Ń' => 'N', 'Ņ' => 'N', 'Ň' => 'N', 'Ō' => 'O', 'Ŏ' => 'O', 'Ő' => 'O', 'Ŕ' => 'R', 'Ŗ' => 'R',
    'Ř' => 'R', 'Ś' => 'S', 'Ŝ' => 'S', 'Ş' => 'S', 'Š' => 'S', 'Ţ' => 'T', 'Ť' => 'T', 'Ũ' => 'U', 'Ū' => 'U', 'Ŭ' => 'U', 'Ů' => 'U', 'Ű' => 'U',
    'Ų' => 'U', 'Ŵ' => 'W', 'Ŷ' => 'Y', 'Ź' => 'Z', 'Ż' => 'Z', 'Ž' => 'Z', 'Ơ' => 'O', 'Ư' => 'U', 'Ǎ' => 'A', 'Ǐ' => 'I', 'Ǒ' => 'O', 'Ǔ' => 'U',
    'Ǖ' => 'U', 'Ǘ' => 'U', 'Ǚ' => 'U', 'Ǜ' => 'U', 'Ǟ' => 'A', 'Ǡ' => 'A', 'Ǧ' => 'G', 'Ǩ' => 'K', 'Ǫ' => 'O', 'Ǭ' => 'O', 'Ǵ' => 'G', 'Ǹ' => 'N',
    'Ǻ' => 'A', 'Ȁ' => 'A', 'Ȃ' => 'A', 'Ȅ' => 'E', 'Ȇ' => 'E', 'Ȉ' => 'I', 'Ȋ' => 'I', 'Ȍ' => 'O', 'Ȏ' => 'O', 'Ȑ' => 'R', 'Ȓ' => 'R', 'Ȕ' => 'U',
    'Ȗ' => 'U', 'Ș' => 'S', 'Ț' => 'T', 'Ȟ' => 'H', 'Ȧ' => 'A', 'Ȩ' => 'E', 'Ȫ' => 'O', 'Ȭ' => 'O', 'Ȯ' => 'O', 'Ȱ' => 'O', 'Ȳ' => 'Y',
];

/** Großbuchstaben, Umlaute ausgeschrieben, nur A–Z (Bindestriche zwischen Namensteilen) */
function namensteil(mixed $text): string
{
    $t = mb_strtoupper(s($text), 'UTF-8');
    $t = strtr($t, ['Ä' => 'AE', 'Ö' => 'OE', 'Ü' => 'UE', 'ß' => 'SS', 'ẞ' => 'SS']);
    $t = strtr($t, OHNE_AKZENT);
    $t = preg_replace('/[^A-Z]+/', '-', $t) ?? '';
    return trim($t, '-');
}

function initialen(mixed $vorname): string
{
    return substr(str_replace('-', '', namensteil($vorname)), 0, 2) ?: 'XX';
}

function honorarnote_nummer(string $vorname, string $nachname, int $jahr, int $laufendeNummer): string
{
    return (namensteil($nachname) ?: 'NACHNAME') . '-' . initialen($vorname) . '-' . $jahr . '-' . str_pad((string) $laufendeNummer, 2, '0', STR_PAD_LEFT);
}

// ------------------------------------------------------------------ Prämiensätze (honorarsaetze.js)

const SATZ_KATEGORIEN = ['college' => ['kolumne', 'ausserordentlich', 'redigieren'], 'campus-a' => ['kolumne', 'ausserordentlich']];
const SATZ_STANDARD = ['kolumne' => 15, 'ausserordentlich' => null, 'redigieren' => 2];

function standard_saetze(): array
{
    $r = [];
    foreach (MEDIUM_KEYS as $m) foreach (SATZ_KATEGORIEN[$m] as $k) $r[$m][$k] = SATZ_STANDARD[$k];
    return $r;
}

function satz_pruefen(mixed $roh): int|float|null
{
    if ($roh === null || $roh === '') return null;
    $b = zahl($roh);
    $c = $b === null ? 0 : (int) round($b * 100);
    if ($b === null || $c <= 0 || $c > 10000000 || abs($b * 100 - $c) > 1e-6) {
        throw new Fehler('Bitte gültige Prämiensätze angeben (z. B. 15 oder 15,50) oder das Feld leer lassen.');
    }
    return euro($c);
}

function saetze_normalisieren(mixed $saetze = []): array
{
    $saetze = is_array($saetze) ? $saetze : [];
    $flach = array_key_exists('kolumne', $saetze) || array_key_exists('ausserordentlich', $saetze);
    $standard = standard_saetze();
    $r = [];
    foreach (MEDIUM_KEYS as $m) {
        $quelle = $flach ? $saetze : ($saetze[$m] ?? null);
        if (!is_array($quelle)) $quelle = $standard[$m];
        foreach (SATZ_KATEGORIEN[$m] as $k) {
            $satz = satz_pruefen($quelle[$k] ?? null);
            $r[$m][$k] = $k === 'redigieren' && $satz === null ? SATZ_STANDARD['redigieren'] : $satz;
        }
    }
    return $r;
}

// ------------------------------------------------------------------ Formatierung (format.js)

const STATUS_LABEL = ['eingereicht' => 'Eingereicht', 'angenommen' => 'Angenommen', 'abgelehnt' => 'Abgelehnt', 'bezahlt' => 'Bezahlt'];
const KATEGORIE_LABEL = ['kolumne' => 'Kolumne', 'ausserordentlich' => 'Außerordentliche Anerkennungsprämie', 'redigieren' => 'Redigieren'];
// Vorlagen für Rückgabegründe der Redaktion (wie public/js/lib/vorlagen.js)
const STANDARD_RUECKGABE = [
    'Der Artikel ist noch nicht erschienen. Bitte erst nach der Veröffentlichung abrechnen.',
    'Der Betrag war so nicht vereinbart. Bitte mit dem vereinbarten Betrag neu einreichen.',
    'Diese Leistung wurde schon in einer anderen Abrechnung abgerechnet.',
    'Bitte den Link zum Artikel ergänzen.',
    'Die Leistung gehört in einen anderen Abrechnungsmonat.',
];

function vorlagen_normalisieren(mixed $liste): array
{
    if (!is_array($liste)) return STANDARD_RUECKGABE;
    $r = array_map(fn ($x) => mb_substr(trim((string) preg_replace('/\s+/u', ' ', is_scalar($x) ? (string) $x : '')), 0, 300), array_values($liste));
    return array_slice(array_values(array_filter($r, fn ($x) => $x !== '')), 0, 15);
}

const ROLLEN_LABEL = [
    'autor' => 'Autor:in', 'redaktion' => 'Redaktion', 'buchhaltung' => 'Buchhaltung', 'admin' => 'Admin',
    'redigieren' => 'Redigieren (campus a college)',
];

function text_anzahl(mixed $n): string
{
    $z = (int) (zahl($n) ?? 0);
    return $z . ' ' . ($z === 1 ? 'Text' : 'Texte');
}

function art_normalisieren(mixed $text): string
{
    return kuerze(tr(preg_replace('/[\s\p{Z}]+/u', ' ', s($text)) ?? ''), 100);
}

/** 1234.5 -> "1.234,50" */
function betrag_text(int|float $betrag): string
{
    return number_format((float) $betrag, 2, ',', '.');
}

/** "2026-09-01" -> "01.09.2026" */
function datum_text(?string $iso): string
{
    if (!$iso) return '';
    [$j, $m, $t] = array_pad(explode('-', substr($iso, 0, 10)), 3, '');
    return "$t.$m.$j";
}

/** ISO-Zeitpunkt -> "28.10.2026, 14:05" (Wiener Zeit) */
function zeitpunkt_text(string $iso): string
{
    $t = strtotime($iso);
    return $t ? date('d.m.Y, H:i', $t) : $iso;
}

const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function monat_text(string $iso): string
{
    [$j, $m] = array_pad(explode('-', $iso), 2, '1');
    return (MONATE[(int) $m - 1] ?? '') . ' ' . $j;
}
