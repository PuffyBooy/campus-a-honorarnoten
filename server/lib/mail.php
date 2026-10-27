<?php
// E-Mails über SMTP (z. B. smtp.world4you.com, Port 587, STARTTLS) – ohne Zusatzpakete.
// Mails kommen zuerst in eine Warteschlange (Tabelle mails) und werden nach der Antwort an den Browser
// verschickt; was nicht klappt, wird später erneut versucht (bis zu 5-mal).
declare(strict_types=1);

const MAIL_STANDARD = [
    'aktiv' => false,
    'host' => 'smtp.world4you.com',
    'port' => 587,
    'verschluesselung' => 'starttls',   // starttls | ssl | keine
    'benutzer' => '',                   // meist die Absender-Adresse
    'passwort' => '',
    'absender' => '',
    'absender_name' => 'campus a Office',
    'antwort_an' => '',                 // Antworten auf die automatischen E-Mails landen hier (z. B. die zweite Adresse)
    'zugangsdaten' => true,             // Startpasswörter automatisch per E-Mail an neue Konten
    'adresse' => '',                    // Adresse der App für Links, z. B. https://honorare.example.at/
];

function mail_einstellungen(PDO $db): array
{
    $w = wert($db, "select wert from einstellungen where schluessel = 'mail'");
    $e = $w ? (json_decode($w, true) ?: []) : [];
    return array_merge(MAIL_STANDARD, array_intersect_key($e, MAIL_STANDARD));
}

/** Für den Browser: ohne Passwort, nur ob eines gesetzt ist */
function mail_einstellungen_sicht(PDO $db): array
{
    $e = mail_einstellungen($db);
    $e['passwort_gesetzt'] = $e['passwort'] !== '';
    unset($e['passwort']);
    return $e;
}

function mail_einstellungen_speichern(PDO $db, array $d): void
{
    $alt = mail_einstellungen($db);
    $e = $alt;
    foreach (['host', 'benutzer', 'absender', 'absender_name', 'antwort_an', 'adresse'] as $k) {
        if (array_key_exists($k, $d)) $e[$k] = kuerze(tr($d[$k]), 200);
    }
    if (array_key_exists('port', $d)) $e['port'] = (int) (zahl($d['port']) ?? 587);
    if (array_key_exists('verschluesselung', $d)) $e['verschluesselung'] = in_array($d['verschluesselung'], ['starttls', 'ssl', 'keine'], true) ? $d['verschluesselung'] : 'starttls';
    if (array_key_exists('aktiv', $d)) $e['aktiv'] = (bool) $d['aktiv'];
    if (array_key_exists('zugangsdaten', $d)) $e['zugangsdaten'] = (bool) $d['zugangsdaten'];
    // leeres Passwortfeld = unverändert
    if (s($d['passwort'] ?? '') !== '') $e['passwort'] = s($d['passwort']);
    foreach (['absender', 'antwort_an', 'benutzer'] as $k) {
        if ($k === 'benutzer' && $e[$k] !== '' && !str_contains($e[$k], '@')) continue; // SMTP-Benutzer muss keine Adresse sein
        pruefe($e[$k] === '' || ist_email($e[$k]), 'Bitte gültige E-Mail-Adressen angeben.');
    }
    pruefe($e['port'] > 0 && $e['port'] < 65536, 'Bitte einen gültigen Port angeben (meist 587).');
    pruefe(!$e['aktiv'] || ($e['host'] !== '' && $e['absender'] !== ''), 'Für den E-Mail-Versand bitte SMTP-Server und Absender-Adresse angeben.');
    if ($e['adresse'] !== '') {
        pruefe((bool) preg_match('~^https?://[^\s/]+(/[^\s]*)?$~', $e['adresse']), 'Die Adresse der App muss mit https:// beginnen.');
        if (!str_ends_with($e['adresse'], '/')) $e['adresse'] .= '/';
    }
    upsert($db, 'einstellungen', ['schluessel' => 'mail', 'wert' => json_text($e)], ['schluessel']);
}

/** Mail in die Warteschlange (wird nach der Antwort verschickt). Ohne aktiven Versand passiert nichts. */
function mail_einreihen(PDO $db, string $an, array $mail): void
{
    $e = mail_einstellungen($db);
    if (!$e['aktiv'] || !ist_email($an)) return;
    q($db, 'insert into mails (id, an, betreff, html, text, erstellt_am) values (?, ?, ?, ?, ?, ?)',
        [neue_id(), $an, $mail['betreff'], $mail['html'], $mail['text'], jetzt()]);
}

/** Offene Mails verschicken (nach der Antwort, per Cronjob oder Kommandozeile). Liefert die Anzahl verschickter Mails. */
function mails_verschicken(PDO $db, int $max = 20): int
{
    $e = mail_einstellungen($db);
    if (!$e['aktiv']) return 0;
    $offen = zeilen($db, 'select * from mails where gesendet_am is null and versuche < 5 and gesperrt_bis < ? order by erstellt_am limit ' . $max, [time()]);
    if (!$offen) return 0;
    $smtp = null;
    $gesendet = 0;
    foreach ($offen as $m) {
        // sperren, damit eine gleichzeitige Anfrage dieselbe Mail nicht auch schickt
        $r = q($db, 'update mails set gesperrt_bis = ? where id = ? and gesperrt_bis < ? and gesendet_am is null', [time() + 300, $m['id'], time()]);
        if ($r->rowCount() !== 1) continue;
        try {
            $smtp ??= new Smtp($e);
            $smtp->senden($m['an'], $m['betreff'], $m['html'], $m['text']);
            q($db, 'update mails set gesendet_am = ?, fehler = \'\' where id = ?', [jetzt(), $m['id']]);
            $gesendet++;
        } catch (Throwable $f) {
            // nächster Versuch nach 5, 10, 20 … Minuten
            $warten = 300 * (2 ** (int) $m['versuche']);
            q($db, 'update mails set versuche = versuche + 1, fehler = ?, gesperrt_bis = ? where id = ?',
                [kuerze($f->getMessage(), 500), time() + $warten, $m['id']]);
            $smtp = null;
            error_log('Prämienabrechnungen: E-Mail an ' . $m['an'] . ' nicht verschickt: ' . $f->getMessage());
        }
    }
    $smtp?->beenden();
    q($db, 'delete from mails where gesendet_am is not null and gesendet_am < ?', [zeit_iso(time() - 90 * 86400)]);
    return $gesendet;
}

/** Sofort senden (Test-E-Mail); wirft bei Fehlern mit verständlicher Meldung */
function mail_sofort(array $e, string $an, array $mail): void
{
    $smtp = new Smtp($e);
    $smtp->senden($an, $mail['betreff'], $mail['html'], $mail['text']);
    $smtp->beenden();
}

final class Smtp
{
    /** @var resource */
    private $verbindung;

    public function __construct(private array $e)
    {
        $host = $e['host'];
        $ssl = $e['verschluesselung'] === 'ssl';
        $kontext = stream_context_create(['ssl' => ['peer_name' => $host, 'verify_peer' => true, 'verify_peer_name' => true]]);
        $v = @stream_socket_client(($ssl ? 'ssl://' : 'tcp://') . $host . ':' . $e['port'], $nr, $text, 15, STREAM_CLIENT_CONNECT, $kontext);
        if (!$v) throw new RuntimeException("Keine Verbindung zum Mailserver $host:{$e['port']} ($text).");
        stream_set_timeout($v, 20);
        $this->verbindung = $v;
        $this->antwort(220);
        $this->hallo();
        if ($e['verschluesselung'] === 'starttls') {
            $this->befehl('STARTTLS', 220);
            if (!@stream_socket_enable_crypto($v, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new RuntimeException('Verschlüsselte Verbindung (STARTTLS) zum Mailserver nicht möglich.');
            }
            $this->hallo();
        }
        if ($e['benutzer'] !== '' || $e['passwort'] !== '') {
            $this->befehl('AUTH LOGIN', 334);
            $this->befehl(base64_encode($e['benutzer'] ?: $e['absender']), 334);
            try {
                $this->befehl(base64_encode($e['passwort']), 235);
            } catch (RuntimeException) {
                throw new RuntimeException('Anmeldung beim Mailserver fehlgeschlagen – bitte E-Mail-Adresse und Passwort prüfen.');
            }
        }
    }

    private function hallo(): void
    {
        $name = preg_replace('/[^a-z0-9.-]/i', '', $_SERVER['HTTP_HOST'] ?? '') ?: 'localhost';
        $this->befehl('EHLO ' . $name, 250);
    }

    private function schreiben(string $zeile): void
    {
        if (@fwrite($this->verbindung, $zeile . "\r\n") === false) throw new RuntimeException('Verbindung zum Mailserver unterbrochen.');
    }

    private function antwort(int $erwartet): string
    {
        $text = '';
        while (($zeile = fgets($this->verbindung, 1024)) !== false) {
            $text .= $zeile;
            if (strlen($zeile) < 4 || $zeile[3] === ' ') break;
        }
        $code = (int) substr($text, 0, 3);
        if ($code !== $erwartet) throw new RuntimeException('Mailserver: ' . trim($text ?: 'keine Antwort'));
        return $text;
    }

    private function befehl(string $zeile, int $erwartet): string
    {
        $this->schreiben($zeile);
        return $this->antwort($erwartet);
    }

    public function senden(string $an, string $betreff, string $html, string $text): void
    {
        $von = $this->e['absender'];
        $this->befehl("MAIL FROM:<$von>", 250);
        $this->befehl("RCPT TO:<$an>", 250);
        $this->befehl('DATA', 354);
        $grenze = 'hn-' . bin2hex(random_bytes(12));
        $domain = substr(strrchr($von, '@') ?: '@localhost', 1);
        $kopf = [
            'Date: ' . date(DATE_RFC2822),
            'From: ' . self::adresse($this->e['absender_name'], $von),
            'To: <' . $an . '>',
            'Subject: ' . self::kodiert($betreff),
            ...(($this->e['antwort_an'] ?? '') !== '' ? ['Reply-To: <' . $this->e['antwort_an'] . '>'] : []),
            'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domain . '>',
            'MIME-Version: 1.0',
            'Auto-Submitted: auto-generated',
            'Content-Type: multipart/alternative; boundary="' . $grenze . '"',
        ];
        $koerper = "--$grenze\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($text))
            . "--$grenze\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($html))
            . "--$grenze--\r\n";
        // Zeilen, die mit einem Punkt beginnen, verdoppeln (SMTP-Regel); base64 enthält keine
        $nachricht = implode("\r\n", $kopf) . "\r\n\r\n" . $koerper;
        $nachricht = preg_replace('/^\./m', '..', $nachricht);
        if (@fwrite($this->verbindung, $nachricht . ".\r\n") === false) throw new RuntimeException('Verbindung zum Mailserver unterbrochen.');
        $this->antwort(250);
        $this->befehl('RSET', 250);
    }

    public function beenden(): void
    {
        try {
            $this->schreiben('QUIT');
        } catch (Throwable) {
        }
        @fclose($this->verbindung);
    }

    private static function kodiert(string $t): string
    {
        return preg_match('/[^\x20-\x7e]/', $t) ? '=?UTF-8?B?' . base64_encode($t) . '?=' : $t;
    }

    private static function adresse(string $name, string $mail): string
    {
        $name = str_replace(['"', "\r", "\n"], '', $name);
        if ($name === '') return "<$mail>";
        return (preg_match('/[^\x20-\x7e]/', $name) ? self::kodiert($name) : '"' . $name . '"') . " <$mail>";
    }
}
