<?php
// Einrichtung nach dem Hochladen: prüft den Webspace, legt das erste Admin-Konto an und richtet den
// E-Mail-Versand ein. Funktioniert nur, solange es noch kein Konto gibt – danach zeigt die Seite nur
// noch „bereits eingerichtet“. Aufruf: https://deine-domain.at/einrichten.php
declare(strict_types=1);

require_once __DIR__ . '/lib/app.php';

header('Content-Type: text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
// same-origin statt no-referrer: sonst schickt der Browser beim Absenden „Origin: null“ und die Prüfung unten schlägt fehl
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

$pruefungen = [
    ['PHP 8.1 oder neuer', version_compare(PHP_VERSION, '8.1.0', '>='), 'Im World4You-Kundenbereich unter „Webspace → Einstellungen“ eine aktuelle PHP-Version wählen (gerade: ' . PHP_VERSION . ').'],
    ['Datenbank (MySQL oder SQLite)', extension_loaded('pdo_mysql') || extension_loaded('pdo_sqlite'), 'Weder pdo_mysql noch pdo_sqlite ist verfügbar – bitte beim World4You-Support nachfragen.'],
    ['mbstring', extension_loaded('mbstring'), 'Die PHP-Erweiterung mbstring fehlt.'],
    ['cURL (für Artikel von campus-a-college.at)', extension_loaded('curl'), 'Die PHP-Erweiterung curl fehlt – Artikel können dann nicht geladen werden.'],
    ['OpenSSL (für verschlüsselten E-Mail-Versand)', extension_loaded('openssl'), 'Die PHP-Erweiterung openssl fehlt.'],
    ['Datenordner beschreibbar', ordner_beschreibbar(), 'Der Ordner app/daten muss beschreibbar sein (per FTP Rechte 755 oder 775 setzen).'],
    ['Datenordner geschützt (.htaccess)', is_file(__DIR__ . '/.htaccess'), 'Die Datei app/.htaccess fehlt – bitte mit hochladen (versteckte Dateien im FTP-Programm anzeigen).'],
    ['HTTPS (verschlüsselte Verbindung)', ist_https(), 'Im World4You-Kundenbereich das kostenlose SSL-Zertifikat für die Domain aktivieren und die Seite mit https:// aufrufen.'],
];

function ordner_beschreibbar(): bool
{
    $ordner = daten_ordner();
    if (!is_dir($ordner)) @mkdir($ordner, 0755, true);
    return is_dir($ordner) && is_writable($ordner);
}

function ist_https(): bool
{
    return (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

$grundlagenOk = $pruefungen[0][1] && $pruefungen[1][1] && $pruefungen[2][1] && $pruefungen[5][1];
$db = null;
$anzahl = null;
$fehler = '';
$ergebnis = null;
$istPost = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
$f = fn ($k) => tr($_POST[$k] ?? '');
// Schutz vor fremden Seiten: Zufallswert im Cookie und im Formular (Doppel-Absende-Token). Funktioniert auch
// hinter Proxys und wenn der Browser keinen brauchbaren Origin-Header schickt (z. B. „Origin: null“).
$token = is_string($_COOKIE['hn_einrichten'] ?? null) && preg_match('/^[a-f0-9]{32}$/', $_COOKIE['hn_einrichten'])
    ? $_COOKIE['hn_einrichten'] : bin2hex(random_bytes(16));
setcookie('hn_einrichten', $token, ['path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => ist_https()]);
$herkunftOk = isset($_COOKIE['hn_einrichten']) && hash_equals($_COOKIE['hn_einrichten'], (string) ($_POST['token'] ?? ''));
if ($istPost && !$herkunftOk) {
    $fehler = 'Das Formular konnte nicht bestätigt werden. Bitte Cookies für diese Seite erlauben, die Seite neu laden und noch einmal absenden.';
}
// MySQL, wenn so eingerichtet oder wenn SQLite fehlt (z. B. bei World4You)
$mitMysql = is_array(konfiguration()['datenbank']) || !extension_loaded('pdo_sqlite');
$mysqlFormular = false;
if ($grundlagenOk) {
    if ($mitMysql && !is_array(konfiguration()['datenbank'])) {
        $mysqlFormular = true;
    } else {
        try {
            $db = datenbank();
            $anzahl = (int) wert($db, 'select count(*) from nutzer');
        } catch (Throwable $e) {
            $fehler = ($mitMysql ? 'Keine Verbindung zur MySQL-Datenbank: ' : 'Die Datenbank konnte nicht angelegt werden: ') . $e->getMessage();
            $mysqlFormular = $mitMysql;
        }
    }
}

// MySQL-Zugangsdaten prüfen und speichern (nur solange keine funktionierende Verbindung besteht)
if ($mysqlFormular && $istPost && $herkunftOk) {
    $mysql = [
        'typ' => 'mysql', 'host' => $f('db_host') ?: 'localhost', 'port' => (int) ($f('db_port') ?: 3306),
        'name' => $f('db_name'), 'benutzer' => $f('db_benutzer'), 'passwort' => (string) ($_POST['db_passwort'] ?? ''),
    ];
    try {
        pruefe($mysql['name'] !== '' && $mysql['benutzer'] !== '', 'Bitte Name der Datenbank und Benutzer angeben.');
        $versuch = oeffne_mysql($mysql); // legt auch die Tabellen an
        $anzahl = (int) wert($versuch, 'select count(*) from nutzer');
        konfig_speichern(['datenbank' => $mysql]);
        $db = datenbank(true);
        $mysqlFormular = false;
        $fehler = '';
    } catch (Fehler $e) {
        $fehler = $e->getMessage();
    } catch (Throwable $e) {
        $fehler = 'Keine Verbindung zur MySQL-Datenbank: ' . $e->getMessage() . ' – bitte die Zugangsdaten prüfen.';
    }
}

if ($db && $anzahl === 0 && $istPost) {
    try {
        pruefe($herkunftOk, $fehler ?: 'Anfrage abgelehnt.');
        pruefe(!leer($f('vorname')) && !leer($f('nachname')), 'Bitte Vor- und Nachnamen angeben.');
        pruefe(ist_email(strtolower($f('email'))), 'Bitte eine gültige E-Mail-Adresse für das Admin-Konto angeben.');
        $mailAn = $f('absender') !== '' || ($_POST['passwort'] ?? '') !== '';
        $mail = [
            'aktiv' => $mailAn,
            'host' => $f('host') ?: 'smtp.world4you.com',
            'port' => (int) ($f('port') ?: 587),
            'verschluesselung' => 'starttls',
            'benutzer' => $f('absender'),
            'passwort' => (string) ($_POST['passwort'] ?? ''),
            'absender' => $f('absender'),
            'absender_name' => $f('absender_name') ?: 'campus a Office',
            'antwort_an' => $f('antwort_an'),
            'zugangsdaten' => true,
            'adresse' => aktuelle_adresse(),
        ];
        if ($mailAn) pruefe(ist_email($mail['absender']) && $mail['passwort'] !== '', 'Für den E-Mail-Versand bitte Absender-Adresse und Passwort des Postfachs angeben (oder beides leer lassen).');
        $mailFehler = '';
        $z = transaktion($db, function () use ($db, $f, $mail) {
            pruefe((int) wert($db, 'select count(*) from nutzer') === 0, 'Es gibt schon ein Konto – die Einrichtung ist bereits erledigt.');
            mail_einstellungen_speichern($db, $mail);
            return admin_anlegen($db, $f('email'), $f('vorname'), $f('nachname'));
        });
        if ($mailAn) {
            try {
                mail_sofort(mail_einstellungen($db), $z['email'], mail_test($db, $z['email']));
            } catch (Throwable $e) {
                $mailFehler = $e->getMessage();
            }
        }
        $ergebnis = $z + ['mail' => $mailAn, 'mail_fehler' => $mailFehler];
        $anzahl = 1;
    } catch (Fehler $e) {
        $fehler = $e->getMessage();
    }
}

// Abgeschickt, aber nichts passiert? Nie wortlos zurück zum Formular – sagen, woran es hängt
if ($istPost && !$ergebnis && $fehler === '') {
    $fehler = match (true) {
        !$grundlagenOk => 'Der Webspace erfüllt die Voraussetzungen oben noch nicht (rote Punkte).',
        $anzahl > 0 => '',
        default => 'Es wurde nichts gespeichert. Bitte die Seite neu laden und noch einmal absenden.',
    };
    error_log('Anerkennungsprämien: Einrichtung ohne Ergebnis abgeschickt');
}

$wert = fn ($k, $standard = '') => h($_POST[$k] ?? $standard);
?><!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Einrichtung – Anerkennungsprämien</title>
  <link rel="icon" href="img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="kopf"><div class="kopf-innen">
    <a class="marke" href="./"><span class="marke-name">campus a</span><span class="marke-zusatz">Anerkennungsprämien</span></a>
  </div></header>
  <main class="inhalt einrichtung-seite">
    <h1>Einrichtung</h1>

    <section class="karte">
      <h2>Webspace prüfen</h2>
      <ul class="pruefliste">
        <?php foreach ($pruefungen as [$name, $ok, $tipp]): ?>
          <li class="<?= $ok ? 'ok' : 'fehlt' ?>"><strong><?= $ok ? '✓' : '✗' ?> <?= h($name) ?></strong>
            <?php if (!$ok): ?><br><span class="klein"><?= h($tipp) ?></span><?php endif ?></li>
        <?php endforeach ?>
      </ul>
    </section>

    <?php if ($fehler !== ''): ?><div class="fehlerbox" role="alert"><?= h($fehler) ?></div><?php endif ?>

    <?php if ($ergebnis): ?>
      <section class="karte">
        <h2>Fertig eingerichtet!</h2>
        <p>Das Admin-Konto ist angelegt. Melde dich jetzt mit diesem <strong>Startpasswort</strong> an
          und lege dabei ein eigenes Passwort fest. <strong>Das Startpasswort wird nur jetzt angezeigt.</strong></p>
        <div class="kopierblock">
          <div class="kopierzeile"><span class="kopier-label">E-Mail</span><span class="kopier-wert"><?= h($ergebnis['email']) ?></span><span></span></div>
          <div class="kopierzeile"><span class="kopier-label">Startpasswort</span><span class="kopier-wert mono"><?= h($ergebnis['passwort']) ?></span><span></span></div>
        </div>
        <?php if ($ergebnis['mail'] && $ergebnis['mail_fehler'] === ''): ?>
          <div class="erfolgbox">Eine Test-E-Mail wurde an <?= h($ergebnis['email']) ?> geschickt – der E-Mail-Versand funktioniert.</div>
        <?php elseif ($ergebnis['mail']): ?>
          <div class="fehlerbox">Die Test-E-Mail konnte nicht verschickt werden: <?= h($ergebnis['mail_fehler']) ?><br>
            Du kannst die E-Mail-Einstellungen nach dem Anmelden unter <strong>Admin → E-Mail</strong> korrigieren.</div>
        <?php else: ?>
          <div class="hinweisbox">E-Mails sind noch ausgeschaltet. Einrichten unter <strong>Admin → E-Mail</strong>.</div>
        <?php endif ?>
        <p class="tipp">Danach unter <strong>Admin → Einstellungen → Betreiber der App</strong> Name und Anschrift eintragen –
          daraus entstehen Impressum und Datenschutzerklärung.</p>
        <p><a class="btn btn-primaer" href="./">Zur Anmeldung</a></p>
      </section>
    <?php elseif ($anzahl > 0): ?>
      <section class="karte">
        <h2>Bereits eingerichtet</h2>
        <p>Es gibt schon ein Admin-Konto. Weitere Konten legt der Admin in der App an.</p>
        <p class="tipp">Passwort vergessen? Per SSH: <code>php app/cli.php passwort deine@email.at</code></p>
        <p><a class="btn btn-primaer" href="./">Zur Anmeldung</a></p>
      </section>
    <?php elseif ($db || $mysqlFormular): ?>
      <form class="karte" method="post" action="einrichten.php" novalidate>
        <input type="hidden" name="token" value="<?= h($token) ?>">
        <?php if ($mysqlFormular): ?>
          <h2>Datenbank (MySQL)</h2>
          <p class="tipp">Die Zugangsdaten stehen im World4You-Kundenbereich unter <strong>Datenbanken</strong> (MySQL).
            Gibt es noch keine Datenbank, dort zuerst eine anlegen. Die Tabellen legt die App selbst an.</p>
          <div class="zeile">
            <div class="feld"><label for="db_host">Server (Host)</label><input id="db_host" name="db_host" value="<?= $wert('db_host', 'localhost') ?>"></div>
            <div class="feld"><label for="db_port">Port</label><input id="db_port" name="db_port" inputmode="numeric" value="<?= $wert('db_port', '3306') ?>"></div>
          </div>
          <label for="db_name">Name der Datenbank</label>
          <input id="db_name" name="db_name" autocomplete="off" value="<?= $wert('db_name') ?>">
          <div class="zeile">
            <div class="feld"><label for="db_benutzer">Benutzer</label><input id="db_benutzer" name="db_benutzer" autocomplete="off" value="<?= $wert('db_benutzer') ?>"></div>
            <div class="feld"><label for="db_passwort">Passwort</label><input id="db_passwort" name="db_passwort" type="password" autocomplete="new-password"></div>
          </div>
        <?php endif ?>
        <h2<?= $mysqlFormular ? ' class="abstand-oben"' : '' ?>>1. Dein Admin-Konto</h2>
        <div class="zeile">
          <div class="feld"><label for="vorname">Vorname</label><input id="vorname" name="vorname" required value="<?= $wert('vorname') ?>"></div>
          <div class="feld"><label for="nachname">Nachname</label><input id="nachname" name="nachname" required value="<?= $wert('nachname') ?>"></div>
        </div>
        <label for="email">Deine E-Mail-Adresse</label>
        <input id="email" name="email" type="email" required autocomplete="email" value="<?= $wert('email') ?>">
        <p class="tipp">Damit meldest du dich an. Hierhin gehen auch neue Zugangsanfragen.</p>

        <h2 class="abstand-oben">2. E-Mail-Versand</h2>
        <p class="tipp">Die App schickt automatisch E-Mails an die Konten (neue Prämienabrechnungen an die Redaktion,
          Bestätigungen an die Autor:innen, Zugangsdaten an neue Konten …) – jede:r wählt im Profil, was sie bekommen will.
          Dafür braucht sie ein Postfach bei World4You, z. B. <em>office@deine-domain.at</em>. Leer lassen = später einrichten.</p>
        <label for="absender">Absender-Adresse (World4You-Postfach, z. B. office@…)</label>
        <input id="absender" name="absender" type="email" autocomplete="off" value="<?= $wert('absender') ?>">
        <label for="passwort">Passwort dieses Postfachs</label>
        <input id="passwort" name="passwort" type="password" autocomplete="new-password">
        <label for="antwort_an">Antworten gehen an (optional)</label>
        <input id="antwort_an" name="antwort_an" type="email" autocomplete="off" value="<?= $wert('antwort_an') ?>">
        <p class="tipp">Wer auf eine automatische E-Mail antwortet, schreibt an diese Adresse – z. B. deine zweite Adresse.
          Leer = an die Absender-Adresse.</p>
        <details class="abstand-oben">
          <summary>Erweitert: SMTP-Server</summary>
          <div class="zeile">
            <div class="feld"><label for="host">SMTP-Server</label><input id="host" name="host" value="<?= $wert('host', 'smtp.world4you.com') ?>"></div>
            <div class="feld"><label for="port">Port</label><input id="port" name="port" inputmode="numeric" value="<?= $wert('port', '587') ?>"></div>
          </div>
          <label for="absender_name">Absendername</label>
          <input id="absender_name" name="absender_name" value="<?= $wert('absender_name', 'campus a Office') ?>">
        </details>
        <p class="abstand-oben"><button type="submit" class="btn btn-primaer">Einrichten</button></p>
      </form>
    <?php endif ?>
  </main>
</body>
</html>
