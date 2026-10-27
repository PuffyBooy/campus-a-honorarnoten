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
    ['SQLite (pdo_sqlite)', extension_loaded('pdo_sqlite'), 'Die PHP-Erweiterung pdo_sqlite fehlt – bitte beim World4You-Support nachfragen.'],
    ['mbstring', extension_loaded('mbstring'), 'Die PHP-Erweiterung mbstring fehlt.'],
    ['cURL (für Artikel von campus-a-college.at)', extension_loaded('curl'), 'Die PHP-Erweiterung curl fehlt – Artikel können dann nicht geladen werden.'],
    ['OpenSSL (für verschlüsselten E-Mail-Versand)', extension_loaded('openssl'), 'Die PHP-Erweiterung openssl fehlt.'],
    ['Datenordner beschreibbar', ordner_beschreibbar(), 'Der Ordner app/daten muss beschreibbar sein (per FTP Rechte 755 oder 775 setzen).'],
    ['Datenordner geschützt (.htaccess)', is_file(__DIR__ . '/.htaccess'), 'Die Datei app/.htaccess fehlt – bitte mit hochladen (versteckte Dateien im FTP-Programm anzeigen).'],
    ['HTTPS (verschlüsselte Verbindung)', ist_https(), 'Im World4You-Kundenbereich das kostenlose SSL-Zertifikat für die Domain aktivieren und die Seite mit https:// aufrufen.'],
];

function ordner_beschreibbar(): bool
{
    $ordner = dirname(konfiguration()['datenbank']);
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
if ($grundlagenOk) {
    try {
        $db = datenbank();
        $anzahl = (int) wert($db, 'select count(*) from nutzer');
    } catch (Throwable $e) {
        $fehler = 'Die Datenbank konnte nicht angelegt werden: ' . $e->getMessage();
    }
}

if ($db && $anzahl === 0 && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $f = fn ($k) => tr($_POST[$k] ?? '');
    try {
        pruefe($origin === '' || parse_url($origin, PHP_URL_HOST) === parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST), 'Anfrage abgelehnt.');
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
            'absender_name' => $f('absender_name') ?: 'campus a Honorarnoten',
            'redaktion' => $f('redaktion') ?: $f('absender'),
            'buchhaltung' => $f('buchhaltung'),
            'admin' => strtolower($f('email')),
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

$wert = fn ($k, $standard = '') => h($_POST[$k] ?? $standard);
?><!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Einrichtung – Honorarnoten</title>
  <link rel="icon" href="img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="kopf"><div class="kopf-innen">
    <a class="marke" href="./"><span class="marke-name">campus a <em>college</em></span><span class="marke-zusatz">Honorarnoten</span></a>
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
    <?php elseif ($db): ?>
      <form class="karte" method="post" action="einrichten.php" novalidate>
        <h2>1. Dein Admin-Konto</h2>
        <div class="zeile">
          <div class="feld"><label for="vorname">Vorname</label><input id="vorname" name="vorname" required value="<?= $wert('vorname') ?>"></div>
          <div class="feld"><label for="nachname">Nachname</label><input id="nachname" name="nachname" required value="<?= $wert('nachname') ?>"></div>
        </div>
        <label for="email">Deine E-Mail-Adresse</label>
        <input id="email" name="email" type="email" required autocomplete="email" value="<?= $wert('email') ?>">
        <p class="tipp">Damit meldest du dich an. Hierhin gehen auch neue Zugangsanfragen.</p>

        <h2 class="abstand-oben">2. E-Mail-Versand</h2>
        <p class="tipp">Die App schickt automatisch E-Mails: neue Honorarnoten an die Redaktion, Bestätigungen an die
          Autor:innen, Zugangsdaten an neue Konten. Dafür braucht sie ein Postfach bei World4You
          (z. B. <em>honorare@deine-domain.at</em>). Leer lassen = später einrichten.</p>
        <label for="absender">Absender-Adresse (World4You-Postfach)</label>
        <input id="absender" name="absender" type="email" autocomplete="off" value="<?= $wert('absender') ?>">
        <label for="passwort">Passwort dieses Postfachs</label>
        <input id="passwort" name="passwort" type="password" autocomplete="new-password">
        <label for="redaktion">Postfach der Redaktion (bekommt neue Honorarnoten)</label>
        <input id="redaktion" name="redaktion" type="email" autocomplete="off" value="<?= $wert('redaktion') ?>">
        <p class="tipp">Z. B. deine zweite Adresse. Leer = dieselbe wie der Absender.</p>
        <label for="buchhaltung">Postfach der Buchhaltung (optional, bekommt angenommene Honorarnoten)</label>
        <input id="buchhaltung" name="buchhaltung" type="email" autocomplete="off" value="<?= $wert('buchhaltung') ?>">
        <details class="abstand-oben">
          <summary>Erweitert: SMTP-Server</summary>
          <div class="zeile">
            <div class="feld"><label for="host">SMTP-Server</label><input id="host" name="host" value="<?= $wert('host', 'smtp.world4you.com') ?>"></div>
            <div class="feld"><label for="port">Port</label><input id="port" name="port" inputmode="numeric" value="<?= $wert('port', '587') ?>"></div>
          </div>
          <label for="absender_name">Absendername</label>
          <input id="absender_name" name="absender_name" value="<?= $wert('absender_name', 'campus a Honorarnoten') ?>">
        </details>
        <p class="abstand-oben"><button type="submit" class="btn btn-primaer">Einrichten</button></p>
      </form>
    <?php endif ?>
  </main>
</body>
</html>
