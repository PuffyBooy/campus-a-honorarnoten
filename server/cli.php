<?php
// Verwaltung über die Kommandozeile (SSH bei World4You oder lokal):
//
//   php app/cli.php admin email@beispiel.at [Vorname] [Nachname]   erstes Admin-Konto anlegen
//   php app/cli.php passwort email@beispiel.at                      neues Startpasswort setzen
//   php app/cli.php backup [ziel.sqlite]                            Sicherungskopie erstellen
//   php app/cli.php mails                                           wartende E-Mails verschicken (für einen Cronjob)
//   php app/cli.php testmail an@beispiel.at                         Test-E-Mail sofort senden
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/lib/app.php';

$args = array_slice($argv, 1);
$befehl = array_shift($args) ?? '';

try {
    $db = datenbank();
    switch ($befehl) {
        case 'admin':
            [$email, $vorname, $nachname] = array_pad($args, 3, '');
            if ($email === '') throw new RuntimeException('Aufruf: php app/cli.php admin email@beispiel.at [Vorname] [Nachname]');
            $z = admin_anlegen($db, $email, $vorname, $nachname);
            echo "\nAdmin-Konto angelegt: {$z['email']}\nStartpasswort:        {$z['passwort']}\n\n";
            echo "Beim ersten Anmelden muss ein eigenes Passwort festgelegt werden.\n\n";
            break;
        case 'passwort':
            $email = strtolower(trim($args[0] ?? ''));
            $id = wert($db, 'select id from nutzer where email = ?', [$email]);
            if (!$id) throw new RuntimeException('Kein Konto mit der E-Mail-Adresse ' . ($email ?: '(leer)') . ' gefunden.');
            $passwort = startpasswort();
            q($db, 'update nutzer set passwort = ?, muss_passwort_aendern = 1, aktiv = 1 where id = ?', [passwort_hash($passwort), $id]);
            alle_sitzungen_beenden($db, $id);
            echo "\nNeues Startpasswort für $email: $passwort\n\n";
            break;
        case 'anzahl':
            echo wert($db, 'select count(*) from nutzer'), "\n";
            break;
        case 'backup':
            $ziel = sichern($db, $args[0] ?? daten_ordner() . '/backups/honorarnoten-' . date('Y-m-d-His') . '.sqlite');
            echo "Sicherung erstellt: $ziel\n";
            break;
        case 'mails':
            echo mails_verschicken($db, 200), " E-Mail(s) verschickt.\n";
            taegliche_sicherung($db);
            aufraeumen($db);
            break;
        case 'testmail':
            $an = $args[0] ?? '';
            if (!ist_email($an)) throw new RuntimeException('Aufruf: php app/cli.php testmail an@beispiel.at');
            mail_sofort(mail_einstellungen($db), $an, mail_test($db, $an));
            echo "Test-E-Mail an $an verschickt.\n";
            break;
        default:
            echo "Befehle: admin <email> [Vorname] [Nachname] | passwort <email> | backup [ziel] | mails | testmail <an>\n";
            exit(1);
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Fehler: ' . $e->getMessage() . "\n");
    exit(1);
}
