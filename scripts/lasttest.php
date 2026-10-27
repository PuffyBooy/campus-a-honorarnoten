<?php
// Lasttest: füllt eine leere Test-Datenbank mit vielen Daten und misst, wie schnell die wichtigsten
// Funktionen antworten (Zeit pro Aufruf inkl. JSON, Median aus 5 Läufen).
//
//   php scripts/lasttest.php                    SQLite (Datei im Temp-Ordner)
//   HONORARE_MYSQL='{"host":"127.0.0.1","name":"hn_last","benutzer":"hn","passwort":"hnpw"}' php scripts/lasttest.php
//
// Größe: LAST_AUTOREN (Standard 180), LAST_NOTEN_PRO_AUTOR (55) -> rund 10 000 Abrechnungen.
declare(strict_types=1);

if (!getenv('HONORARE_MYSQL')) putenv('HONORARE_DATENBANK=' . sys_get_temp_dir() . '/lasttest-' . getmypid() . '.sqlite');
require __DIR__ . '/../server/lib/app.php';

$db = datenbank();
if (ist_mysql($db)) {
    foreach (array_reverse(TABELLEN) as $t) $db->exec("delete from $t");
}
$autoren = (int) (getenv('LAST_AUTOREN') ?: 180);
$proAutor = (int) (getenv('LAST_NOTEN_PRO_AUTOR') ?: 55);
$hash = passwort_hash('lasttest123');
$start = microtime(true);

// ---- Daten anlegen
$db->beginTransaction();
$konto = function (string $vorname, string $nachname, array $rollen) use ($db, $hash): array {
    $id = konto_einfuegen($db, $vorname, $nachname, strtolower("$vorname.$nachname@example.org"), $rollen, $hash);
    q($db, "update nutzer set muss_passwort_aendern = 0, strasse = 'Weg 1', plz_ort = '1010 Wien', iban = 'AT611904300234573201',
            campus_profil = 'profil-x', hinweis_bestaetigt_am = ? where id = ?", [jetzt(), $id]);
    return nutzer_laden($db, $id);
};
$admin = $konto('Ada', 'Admin', ['admin']);
$redaktion = $konto('Rita', 'Redaktion', ['redaktion']);
$kasse = $konto('Bernd', 'Kasse', ['buchhaltung']);
for ($i = 0; $i < 10; $i++) $konto('Red' . $i, 'Team', ['redaktion']);

$note = $db->prepare("insert into noten (id, nummer, jahr, laufende_nummer, monat, medium, autor_id, status, eingereicht_am, entschieden_am,
        bezahlt_am, ablehnungsgrund, autor_json, zahlung_json, empfaenger_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
$pos = $db->prepare("insert into note_positionen (id, note_id, reihenfolge, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe,
        vereinbart_mit, notiz, betrag_cent, betrag_eingereicht_cent, artikel_url, medium, anzahl) values (?, ?, ?, ?, '', '', ?, ?, '', '', '', ?, ?, ?, ?, 0)");
$verlauf = $db->prepare('insert into verlauf (id, note_id, akteur_id, akteur_name, aktion, details, am) values (?, ?, ?, ?, ?, ?, ?)');
$entwurf = $db->prepare("insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe, vereinbart_mit,
        notiz, betrag_cent, artikel_url, medium, anzahl, erstellt_am) values (?, ?, 'kolumne', '', '', ?, ?, '', '', '', 1500, '', 'college', 0, ?)");
$autor = null;
$noten = 0;
for ($a = 0; $a < $autoren; $a++) {
    $autor = $konto('Autor' . $a, 'Muster' . $a, ['autor']);
    for ($n = 1; $n <= $proAutor; $n++) {
        $t = time() - ($proAutor - $n) * 13 * 86400 - random_int(0, 86400);
        $jahr = (int) date('Y', $t);
        $r = random_int(1, 100);
        $status = $n > $proAutor - 2 ? ($r <= 60 ? 'eingereicht' : 'angenommen') : ($r <= 4 ? 'abgelehnt' : 'bezahlt');
        $id = neue_id();
        $nummer = honorarnote_nummer($autor['vorname'], $autor['nachname'], $jahr, $n) . '-' . $a;
        $note->execute([$id, $nummer, $jahr, $n, date('Y-m', $t), $n % 3 ? 'college' : 'campus-a', $autor['id'], $status, zeit_iso($t),
            $status === 'eingereicht' ? null : zeit_iso($t + 86400), $status === 'bezahlt' ? date('Y-m-d', $t + 5 * 86400) : null,
            $status === 'abgelehnt' ? 'Test' : '', json_text(['vorname' => $autor['vorname'], 'nachname' => $autor['nachname'], 'email' => $autor['email']]),
            json_text(['kontoinhaber' => 'X', 'iban' => 'AT611904300234573201', 'bic' => '']), json_text(STANDARD_EMPFAENGER)]);
        for ($p = 0; $p < 3; $p++) {
            $pos->execute([neue_id(), $id, $p, 'kolumne', "Beitrag $a-$n-$p", date('Y-m-d', $t), 1500, 1500,
                "https://www.campus-a-college.at/artikel/a$a-n$n-p$p", 'college']);
        }
        $verlauf->execute([neue_id(), $id, $autor['id'], 'Autor', 'eingereicht', '{}', zeit_iso($t)]);
        if ($status !== 'eingereicht') $verlauf->execute([neue_id(), $id, $redaktion['id'], 'Rita Redaktion', 'angenommen', '{}', zeit_iso($t + 86400)]);
        $noten++;
    }
    for ($e = 0; $e < 4; $e++) $entwurf->execute([neue_id(), $autor['id'], "Entwurf $a-$e", date('Y-m-d'), jetzt()]);
}
$prot = $db->prepare('insert into protokoll (zeit, stufe, bereich, text, wer, ip) values (?, ?, ?, ?, ?, ?)');
for ($i = 0; $i < 50000; $i++) {
    $prot->execute([zeit_iso(time() - $i * 600), ['info', 'info', 'info', 'warnung', 'fehler'][$i % 5], ['anmeldung', 'konten', 'abrechnungen'][$i % 3],
        "Ereignis Nummer $i", 'Autor' . ($i % 180), '10.0.0.0']);
}
$db->commit();
printf("Angelegt: %d Konten, %d Abrechnungen, %d Leistungen, 50 000 Protokolleinträge in %.1f s (%s)\n\n",
    wert($db, 'select count(*) from nutzer'), $noten, wert($db, 'select count(*) from note_positionen'), microtime(true) - $start,
    ist_mysql($db) ? 'MySQL/MariaDB' : 'SQLite');

// ---- Messen
$als = fn (array $n) => new Honorare(new Ctx($db, $n, 'x'));
$eineNote = (string) wert($db, "select id from noten where status = 'eingereicht' limit 1");
$faelle = [
    ['Autor: meineLeistungen', $autor, fn ($h) => $h->meineLeistungen()],
    ['Autor: meineNoten', $autor, fn ($h) => $h->meineNoten()],
    ['Autor: naechsteNummer', $autor, fn ($h) => $h->naechsteNummer()],
    ['Redaktion: Liste zu prüfen', $redaktion, fn ($h) => $h->redaktionListe(['status' => 'eingereicht'])],
    ['Redaktion: Liste alle (1. Seite)', $redaktion, fn ($h) => $h->redaktionListe(['status' => ''])],
    ['Redaktion: Liste bezahlt, Betrag', $redaktion, fn ($h) => $h->redaktionListe(['status' => 'bezahlt', 'sortierung' => 'betrag_desc'])],
    ['Redaktion: Liste Suche', $redaktion, fn ($h) => $h->redaktionListe(['status' => '', 'suche' => 'Muster17'])],
    ['Redaktion: note', $redaktion, fn ($h) => $h->note($eineNote)],
    ['Redaktion: pruefInfo', $redaktion, fn ($h) => $h->pruefInfo($eineNote)],
    ['Redaktion: verlaufVon', $redaktion, fn ($h) => $h->verlaufVon($eineNote)],
    ['Buchhaltung: offeneZahlungen', $kasse, fn ($h) => $h->offeneZahlungen()],
    ['Buchhaltung: bezahlt 12 Wochen', $kasse, fn ($h) => $h->bezahlteNotenSeit(date('Y-m-d', time() - 84 * 86400))],
    ['Buchhaltung: ausgezahltImJahr', $kasse, fn ($h) => $h->ausgezahltImJahr()],
    ['Admin: statistik', $admin, fn ($h) => $h->statistik()],
    ['Admin: dashboard', $admin, fn ($h) => $h->dashboard()],
    ['Admin: protokoll', $admin, fn ($h) => $h->protokoll([])],
    ['Admin: protokoll (Suche)', $admin, fn ($h) => $h->protokoll(['suche' => 'Nummer 4711', 'stufe' => 'fehler'])],
    ['Admin: nutzerListe', $admin, fn ($h) => $h->nutzerListe()],
];
printf("%-38s %10s %12s\n", 'Funktion', 'Median ms', 'Antwort');
$langsam = 0;
foreach ($faelle as [$name, $wer, $fn]) {
    $zeiten = [];
    $groesse = 0;
    for ($i = 0; $i < 5; $i++) {
        $t = hrtime(true);
        $groesse = strlen(json_text(['daten' => $fn($als($wer))]));
        $zeiten[] = (hrtime(true) - $t) / 1e6;
    }
    sort($zeiten);
    $ms = $zeiten[2];
    if ($ms > 300) $langsam++;
    printf("%-38s %10.1f %12s%s\n", $name, $ms, groesse_text($groesse), $ms > 300 ? '  ← über 300 ms' : '');
}
echo $langsam ? "\n$langsam Funktionen über 300 ms.\n" : "\nAlle Funktionen unter 300 ms.\n";
if (!ist_mysql($db)) @unlink(konfiguration()['datenbank']);
