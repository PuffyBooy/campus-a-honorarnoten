<?php
// Push-Mitteilungen aufs Handy (Web Push, RFC 8030/8292).
// Geschickt wird ein leerer Push (ohne Inhalt, daher ohne Verschlüsselung); der Service Worker auf dem Gerät
// holt sich die Mitteilungen dann selbst mit der Anmeldung ab (pushAbholen). So verlassen keine Inhalte
// den Server über den Push-Dienst des Browsers (Google, Apple, Mozilla).
declare(strict_types=1);

const PUSH_ZIELE = [
    'neue_note' => '#/redaktion', 'zur_zahlung' => '#/zahlung', 'anfrage' => '#/admin/anfragen', 'probleme' => '#/admin/server',
    'eingang' => '#/noten', 'angenommen' => '#/noten', 'abgelehnt' => '#/leistungen', 'bezahlt' => '#/noten',
    'rueckfrage' => '#/noten', 'erinnerung' => '#/leistungen',
];
const PUSH_MAX_FEHLER = 10; // danach gilt ein Gerät als verschwunden

function b64url(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64url_dekodieren(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
}

/** VAPID-Schlüsselpaar der App (einmal erzeugt, in den Einstellungen gespeichert, nie an den Browser außer dem öffentlichen) */
function vapid_schluessel(PDO $db): array
{
    $z = wert($db, "select wert from einstellungen where schluessel = 'vapid'");
    $v = $z ? json_decode((string) $z, true) : null;
    if (is_array($v) && isset($v['privat'], $v['oeffentlich'])) return $v;
    $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$k) throw new RuntimeException('Schlüssel für Push-Mitteilungen konnte nicht erzeugt werden (OpenSSL).');
    openssl_pkey_export($k, $pem);
    $ec = openssl_pkey_get_details($k)['ec'];
    $v = ['privat' => $pem, 'oeffentlich' => b64url("\x04" . str_pad($ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ec['y'], 32, "\0", STR_PAD_LEFT))];
    upsert($db, 'einstellungen', ['schluessel' => 'vapid', 'wert' => json_text($v)], ['schluessel']);
    return $v;
}

/** ECDSA-Signatur von OpenSSL (DER) in die 64 Bytes r||s, die JWT ES256 verlangt */
function der_zu_roh(string $der): string
{
    $pos = 2; // 0x30 Länge
    $teile = [];
    for ($i = 0; $i < 2; $i++) {
        $laenge = ord($der[$pos + 1]);
        $zahl = substr($der, $pos + 2, $laenge);
        $teile[] = str_pad(ltrim($zahl, "\0"), 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $laenge;
    }
    return $teile[0] . $teile[1];
}

/** Authorization-Header für einen Push-Dienst (VAPID, RFC 8292) */
function vapid_header(array $vapid, string $endpoint, string $kontakt): string
{
    $teile = parse_url($endpoint);
    $aud = $teile['scheme'] . '://' . $teile['host'] . (isset($teile['port']) ? ':' . $teile['port'] : '');
    $kopf = b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $inhalt = b64url(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $kontakt], JSON_UNESCAPED_SLASHES));
    openssl_sign("$kopf.$inhalt", $sig, $vapid['privat'], OPENSSL_ALGO_SHA256);
    return 'vapid t=' . "$kopf.$inhalt." . b64url(der_zu_roh($sig)) . ', k=' . $vapid['oeffentlich'];
}

/** Einen leeren Push an ein Gerät schicken; liefert den HTTP-Status (0 = nicht erreichbar) */
function push_senden(array $abo, array $vapid, string $kontakt): int
{
    $c = curl_init($abo['endpoint']);
    curl_setopt_array($c, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => '',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
        CURLOPT_HTTPHEADER => ['Authorization: ' . vapid_header($vapid, $abo['endpoint'], $kontakt), 'TTL: 86400', 'Urgency: normal', 'Content-Length: 0'],
    ]);
    curl_exec($c);
    $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    return $status;
}

/** Ist dieser Push-Endpunkt erlaubt? Nur HTTPS (in den Tests auch ein lokaler Ersatzdienst) */
function push_endpoint_ok(string $e): bool
{
    if (strlen($e) > 1000 || !filter_var($e, FILTER_VALIDATE_URL)) return false;
    if (str_starts_with($e, 'https://')) return true;
    return (bool) getenv('HONORARE_PUSH_TEST') && str_starts_with($e, 'http://127.0.0.1:');
}

/** Mitteilung für eine Person vormerken – nur, wenn sie auf mindestens einem Gerät Push eingeschaltet hat */
function push_einreihen(PDO $db, string $nutzerId, string $titel, string $ziel = ''): void
{
    if (!(int) wert($db, 'select count(*) from push_abos where nutzer_id = ?', [$nutzerId])) return;
    q($db, 'insert into push_nachrichten (id, nutzer_id, titel, ziel, erstellt_am) values (?, ?, ?, ?, ?)',
        [neue_id(), $nutzerId, kuerze($titel, 300), kuerze($ziel, 200), jetzt()]);
}

/** Nach der Antwort: offene Mitteilungen als leere Pushes an alle Geräte der Empfänger:innen */
function pushes_verschicken(PDO $db, ?callable $senden = null): int
{
    $offen = zeilen($db, 'select distinct nutzer_id from push_nachrichten where gesendet = 0');
    if (!$offen) return 0;
    $senden ??= 'push_senden';
    $vapid = vapid_schluessel($db);
    $kontakt = 'mailto:' . (mail_einstellungen($db)['absender'] ?: 'push@example.org');
    $geschickt = 0;
    foreach ($offen as $z) {
        // erst als gesendet markieren: ein zweiter, gleichzeitiger Lauf schickt nicht doppelt
        q($db, 'update push_nachrichten set gesendet = 1 where nutzer_id = ? and gesendet = 0', [$z['nutzer_id']]);
        foreach (zeilen($db, 'select * from push_abos where nutzer_id = ?', [$z['nutzer_id']]) as $abo) {
            $status = $senden($abo, $vapid, $kontakt);
            if ($status >= 200 && $status < 300) {
                $geschickt++;
                if ($abo['fehler']) q($db, 'update push_abos set fehler = 0 where id = ?', [$abo['id']]);
            } elseif (in_array($status, [404, 410], true) || $abo['fehler'] + 1 >= PUSH_MAX_FEHLER) {
                q($db, 'delete from push_abos where id = ?', [$abo['id']]); // Abo abgelaufen oder Gerät weg
            } else {
                q($db, 'update push_abos set fehler = fehler + 1 where id = ?', [$abo['id']]);
            }
        }
    }
    return $geschickt;
}

function push_aufraeumen(PDO $db): void
{
    q($db, 'delete from push_nachrichten where erstellt_am < ?', [zeit_iso(time() - 7 * 86400)]);
}
