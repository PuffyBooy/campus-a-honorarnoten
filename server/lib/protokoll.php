<?php
// Protokoll für den Admin: was im Hintergrund passiert (Anmeldungen, Änderungen, E-Mails, Sicherungen, Fehler),
// sortiert nach Info, Warnung und Fehler. Wird 1 Jahr aufgehoben. IP-Adressen nur gekürzt (Datenschutz).
declare(strict_types=1);

const PROTOKOLL_STUFEN = ['info', 'warnung', 'fehler'];
const PROTOKOLL_BEREICHE = [
    'anmeldung' => 'Anmeldung', 'konten' => 'Konten', 'abrechnungen' => 'Abrechnungen', 'zahlung' => 'Zahlung',
    'einstellungen' => 'Einstellungen', 'mail' => 'E-Mail', 'sicherung' => 'Sicherung', 'system' => 'System',
];
const PROTOKOLL_TAGE = 365;

/** Eintrag schreiben; darf nie die eigentliche Anfrage stören */
function protokoll(PDO $db, string $stufe, string $bereich, string $text, ?array $wer = null): void
{
    try {
        q($db, 'insert into protokoll (zeit, stufe, bereich, text, wer, ip) values (?, ?, ?, ?, ?, ?)', [
            jetzt(), $stufe, $bereich, kuerze($text, 1000),
            $wer ? kuerze(trim(($wer['vorname'] ?? '') . ' ' . ($wer['nachname'] ?? '')) ?: ($wer['email'] ?? ''), 250) : '',
            ip_gekuerzt((string) ($_SERVER['REMOTE_ADDR'] ?? '')),
        ]);
    } catch (Throwable $e) {
        error_log('Prämienabrechnungen: Protokoll: ' . $e->getMessage());
    }
}

/** 203.0.113.57 -> 203.0.113.0, IPv6 nur die ersten 3 Blöcke */
function ip_gekuerzt(string $ip): string
{
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) return preg_replace('/\.\d+$/', '.0', $ip);
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) return implode(':', array_slice(explode(':', $ip), 0, 3)) . '::';
    return '';
}

function protokoll_aufraeumen(PDO $db): void
{
    q($db, 'delete from protokoll where zeit < ?', [zeit_iso(time() - PROTOKOLL_TAGE * 86400)]);
}
