<?php
// Zwei-Faktor-Anmeldung mit Einmal-Codes aus einer App (TOTP nach RFC 6238: 6 Ziffern, alle 30 Sekunden neu,
// wie Google Authenticator, Microsoft Authenticator, Aegis …). Dazu Ersatz-Codes für ein verlorenes Handy.
declare(strict_types=1);

const TOTP_SCHRITT = 30;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp_geheimnis(): string
{
    $b = '';
    foreach (str_split(random_bytes(20)) as $byte) $b .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
    return implode('', array_map(fn ($teil) => BASE32[bindec($teil)], str_split($b, 5)));
}

function base32_dekodieren(string $s): string
{
    $bits = '';
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s))) as $z) $bits .= str_pad(decbin(strpos(BASE32, $z)), 5, '0', STR_PAD_LEFT);
    return implode('', array_map(fn ($b) => chr(bindec($b)), array_filter(str_split($bits, 8), fn ($b) => strlen($b) === 8)));
}

function totp_code(string $geheimnis, int $schritt): string
{
    $h = hash_hmac('sha1', pack('J', $schritt), base32_dekodieren($geheimnis), true);
    $o = ord($h[19]) & 0x0f;
    $zahl = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string) ($zahl % 1000000), 6, '0', STR_PAD_LEFT);
}

/** Schritt, zu dem der Code passt (±1 Schritt Toleranz für ungenaue Uhren), sonst null */
function totp_pruefen(string $geheimnis, string $code, ?int $zeit = null): ?int
{
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) return null;
    $jetzt = intdiv($zeit ?? time(), TOTP_SCHRITT);
    foreach ([0, -1, 1] as $d) {
        if (hash_equals(totp_code($geheimnis, $jetzt + $d), $code)) return $jetzt + $d;
    }
    return null;
}

function totp_uri(string $geheimnis, string $konto): string
{
    return 'otpauth://totp/' . rawurlencode('campus a Prämien:' . $konto) . '?secret=' . $geheimnis
        . '&issuer=' . rawurlencode('campus a Prämien') . '&digits=6&period=' . TOTP_SCHRITT;
}

/** 8 Ersatz-Codes (je einmal verwendbar), gespeichert nur als Hash */
function ersatzcodes(): array
{
    $codes = [];
    for ($i = 0; $i < 8; $i++) $codes[] = substr(bin2hex(random_bytes(5)), 0, 5) . '-' . substr(bin2hex(random_bytes(5)), 0, 5);
    return $codes;
}
