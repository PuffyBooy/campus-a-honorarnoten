<?php
// Gestaltung der automatischen E-Mails: Kopf in der Farbe von campus a college, eine weiße Karte mit
// Text, Übersicht und Knopf zur App. Nur Tabellen und Inline-Stile – so sieht es in Outlook, Gmail
// und Apple Mail gleich aus. Jede Mail hat auch eine reine Textfassung.
declare(strict_types=1);

const FARBE = '#0f6b66';      // Petrol, wie die App
const FARBE_HELL = '#e3f1ef';

/**
 * Baut eine Mail.
 * $t = [
 *   'betreff', 'vorschau' (Text in der Postfach-Vorschau), 'titel', 'medium' (optional),
 *   'absaetze' => [Text, …] (einfacher Text, wird maskiert),
 *   'hinweis' => [Text, Farbe: 'erfolg'|'gefahr'|'info'] (optional, hervorgehobener Kasten),
 *   'tabelle' => [[links, rechts], …] (optional, Übersicht wie Nummer, Betrag),
 *   'positionen' => [[Titel, Datum, Betrag], …] (optional), 'summe' => Text (optional),
 *   'knopf' => [Beschriftung, Adresse] (optional),
 * ]
 */
function mail_bauen(array $t): array
{
    $medium = $t['medium'] ?? null;
    $marke = $medium ? medium_name($medium) : 'campus a';
    $hinweisFarben = [
        'erfolg' => ['#e6f4ea', '#1a7f37'],
        'gefahr' => ['#fdecea', '#b42318'],
        'info' => [FARBE_HELL, FARBE],
    ];

    $html = '';
    foreach ($t['absaetze'] ?? [] as $a) {
        $html .= '<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1c2321;">' . nl2br(h($a)) . '</p>';
    }
    if (!empty($t['hinweis'])) {
        [$text, $art] = $t['hinweis'] + [1 => 'info'];
        [$hg, $rand] = $hinweisFarben[$art] ?? $hinweisFarben['info'];
        $html .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr>'
            . '<td style="background:' . $hg . ';border-left:4px solid ' . $rand . ';border-radius:6px;padding:12px 16px;'
            . 'font-size:15px;line-height:1.5;color:#1c2321;">' . nl2br(h($text)) . '</td></tr></table>';
    }
    if (!empty($t['tabelle'])) {
        $html .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-collapse:collapse;">';
        foreach ($t['tabelle'] as $zeile) {
            [$l, $r] = $zeile;
            // dritter Wert true: Festbreitenschrift (z. B. Startpasswort – l und I nicht verwechseln)
            $schrift = !empty($zeile[2]) ? 'font-family:Menlo,Consolas,\'Courier New\',monospace;font-size:17px;letter-spacing:.05em;' : 'font-size:15px;';
            $html .= '<tr><td style="padding:7px 0;border-bottom:1px solid #e3ebe8;font-size:14px;color:#59645f;width:42%;">' . h($l) . '</td>'
                . '<td style="padding:7px 0;border-bottom:1px solid #e3ebe8;' . $schrift . 'color:#1c2321;font-weight:600;">' . h($r) . '</td></tr>';
        }
        $html .= '</table>';
    }
    if (!empty($t['positionen'])) {
        $html .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-collapse:collapse;">'
            . '<tr><td style="padding:6px 8px 6px 0;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#59645f;border-bottom:2px solid ' . FARBE . ';">Leistung</td>'
            . '<td style="padding:6px 8px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#59645f;border-bottom:2px solid ' . FARBE . ';white-space:nowrap;">Datum</td>'
            . '<td align="right" style="padding:6px 0 6px 8px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#59645f;border-bottom:2px solid ' . FARBE . ';white-space:nowrap;">Betrag</td></tr>';
        foreach ($t['positionen'] as [$titel, $datum, $betrag]) {
            $html .= '<tr><td style="padding:8px 8px 8px 0;border-bottom:1px solid #e3ebe8;font-size:15px;color:#1c2321;">' . h($titel) . '</td>'
                . '<td style="padding:8px;border-bottom:1px solid #e3ebe8;font-size:14px;color:#59645f;white-space:nowrap;">' . h($datum) . '</td>'
                . '<td align="right" style="padding:8px 0 8px 8px;border-bottom:1px solid #e3ebe8;font-size:15px;color:#1c2321;white-space:nowrap;">' . h($betrag) . '</td></tr>';
        }
        if (!empty($t['summe'])) {
            $html .= '<tr><td colspan="2" style="padding:10px 8px 0 0;font-size:15px;font-weight:700;color:#1c2321;">Gesamt</td>'
                . '<td align="right" style="padding:10px 0 0 8px;font-size:17px;font-weight:700;color:' . FARBE . ';white-space:nowrap;">' . h($t['summe']) . '</td></tr>';
        }
        $html .= '</table>';
    }
    if (!empty($t['knopf'][1])) {
        [$beschriftung, $link] = $t['knopf'];
        $html .= '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr>'
            . '<td style="border-radius:999px;background:' . FARBE . ';">'
            . '<a href="' . h($link) . '" style="display:inline-block;padding:13px 26px;font-size:16px;font-weight:600;'
            . 'color:#ffffff;text-decoration:none;border-radius:999px;">' . h($beschriftung) . '</a></td></tr></table>';
    }

    $seite = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">'
        . '<title>' . h($t['betreff']) . '</title></head>'
        . '<body style="margin:0;padding:0;background:#f3f6f5;-webkit-text-size-adjust:100%;">'
        . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' . h($t['vorschau'] ?? '') . '</div>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f5;"><tr><td align="center" style="padding:28px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
        // Kopf
        . '<tr><td style="background:' . FARBE . ';border-radius:16px 16px 0 0;padding:22px 28px;">'
        . '<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:24px;color:#ffffff;letter-spacing:.01em;">' . h($marke) . '</span>'
        . '<span style="font-size:13px;color:#e3f1ef;letter-spacing:.06em;text-transform:uppercase;padding-left:10px;">Anerkennungsprämien</span>'
        . '</td></tr>'
        // Inhalt
        . '<tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:30px 28px 26px;">'
        . '<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#1c2321;font-weight:700;">' . h($t['titel']) . '</h1>'
        . $html
        . '</td></tr>'
        // Fuß
        . '<tr><td style="padding:18px 28px 0;font-size:12px;line-height:1.5;color:#7f8a86;text-align:center;">'
        . 'Automatische Nachricht der Anerkennungsprämien-App von campus a college und campus a.<br>Bitte nicht auf diese E-Mail antworten.'
        . '</td></tr></table></td></tr></table></body></html>';

    // Textfassung
    $text = $t['titel'] . "\n" . str_repeat('=', min(60, mb_strlen($t['titel']))) . "\n\n";
    foreach ($t['absaetze'] ?? [] as $a) $text .= $a . "\n\n";
    if (!empty($t['hinweis'])) $text .= '» ' . $t['hinweis'][0] . "\n\n";
    foreach ($t['tabelle'] ?? [] as $zeile) $text .= "{$zeile[0]}: {$zeile[1]}\n";
    if (!empty($t['tabelle'])) $text .= "\n";
    foreach ($t['positionen'] ?? [] as [$titel, $datum, $betrag]) $text .= "- $titel ($datum): $betrag\n";
    if (!empty($t['summe'])) $text .= "Gesamt: {$t['summe']}\n";
    if (!empty($t['positionen'])) $text .= "\n";
    if (!empty($t['knopf'][1])) $text .= $t['knopf'][0] . ': ' . $t['knopf'][1] . "\n\n";
    $text .= "--\nAutomatische Nachricht der Anerkennungsprämien-App von campus a college und campus a.\n";

    return ['betreff' => $t['betreff'], 'html' => $seite, 'text' => $text];
}

function eur(int|float $betrag): string
{
    return '€ ' . betrag_text($betrag);
}

function app_link(PDO $db, string $pfad = ''): string
{
    $basis = mail_einstellungen($db)['adresse'] ?: aktuelle_adresse();
    return $basis . ($pfad !== '' ? '#/' . $pfad : '');
}

/** Adresse der App aus der aktuellen Anfrage (z. B. https://honorare.example.at/) */
function aktuelle_adresse(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($host === '' || !preg_match('/^[a-z0-9.:-]+$/i', $host)) return '';
    $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off'
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $pfad = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
    return ($https ? 'https://' : 'http://') . $host . $pfad;
}

function positionen_zeilen(array $note): array
{
    return array_map(fn ($p) => [
        $p['kategorie'] === 'redigieren' ? redigier_text($p) : $p['titel'],
        datum_text($p['veroeffentlichung']),
        eur($p['betrag']),
    ], $note['positionen']);
}

function redigier_text(array $p): string
{
    $anzahl = 'Redigieren (' . text_anzahl($p['anzahl'] ?? 0) . ')';
    $titel = s($p['titel'] ?? '');
    if ($titel === '' || preg_match('/^Redigieren \(\d+ Texte?\)$/', $titel)) return $anzahl;
    return preg_match('/^redigier/i', $titel) ? $titel . ' (' . text_anzahl($p['anzahl'] ?? 0) . ')' : "$anzahl: $titel";
}

function note_summe(array $note): int|float
{
    return euro(array_sum(array_map(fn ($p) => cent($p['betrag']), $note['positionen'])));
}

function autor_name(array $note): string
{
    return trim(($note['autor']['vorname'] ?? '') . ' ' . ($note['autor']['nachname'] ?? ''));
}

// ------------------------------------------------------------------ die einzelnen Mails

function mail_eingereicht_redaktion(PDO $db, array $note): array
{
    $name = autor_name($note);
    return mail_bauen([
        'betreff' => "Neue Prämienabrechnung von $name ({$note['nummer']})",
        'vorschau' => "$name hat eine Prämienabrechnung über " . eur(note_summe($note)) . ' eingereicht.',
        'titel' => 'Neue Prämienabrechnung eingereicht',
        'medium' => $note['medium'],
        'absaetze' => ["$name hat eine Prämienabrechnung für " . medium_name($note['medium']) . ' eingereicht. Bitte prüfen und annehmen oder ablehnen.'],
        'tabelle' => [['Prämienabrechnung', $note['nummer']], ['Von', $name], ['Medium', medium_name($note['medium'])],
            ['Eingereicht am', datum_text(substr(zeit_wien($note['eingereicht_am']), 0, 10))]],
        'positionen' => positionen_zeilen($note),
        'summe' => eur(note_summe($note)),
        'knopf' => ['Prämienabrechnung prüfen', app_link($db, 'redaktion/' . $note['id'])],
    ]);
}

function mail_eingereicht_autor(PDO $db, array $note): array
{
    $vorname = $note['autor']['vorname'] ?? '';
    return mail_bauen([
        'betreff' => "Deine Prämienabrechnung {$note['nummer']} ist eingegangen",
        'vorschau' => 'Danke! Die Redaktion prüft deine Prämienabrechnung über ' . eur(note_summe($note)) . '.',
        'titel' => 'Danke, deine Prämienabrechnung ist da!',
        'medium' => $note['medium'],
        'absaetze' => ["Hallo $vorname,", 'deine Prämienabrechnung ist bei der Redaktion eingegangen. Sobald sie geprüft ist, bekommst du wieder eine Nachricht.'],
        'tabelle' => [['Prämienabrechnung', $note['nummer']], ['Medium', medium_name($note['medium'])]],
        'positionen' => positionen_zeilen($note),
        'summe' => eur(note_summe($note)),
        'knopf' => ['Meine Prämienabrechnungen ansehen', app_link($db, 'noten')],
    ]);
}

function mail_angenommen_autor(PDO $db, array $note): array
{
    $vorname = $note['autor']['vorname'] ?? '';
    $korrigiert = array_filter($note['positionen'], fn ($p) => ($p['betrag_vermerk'] ?? '') !== '');
    $absaetze = ["Hallo $vorname,", 'gute Nachrichten: Die Redaktion hat deine Prämienabrechnung angenommen. Die Buchhaltung überweist den Betrag in den nächsten Tagen.'];
    foreach ($korrigiert as $p) {
        $absaetze[] = "Betrag geändert bei „{$p['titel']}“: " . eur($p['betrag_eingereicht']) . ' → ' . eur($p['betrag']) . " ({$p['betrag_vermerk']})";
    }
    return mail_bauen([
        'betreff' => "Prämienabrechnung {$note['nummer']} angenommen",
        'vorschau' => 'Deine Prämienabrechnung über ' . eur(note_summe($note)) . ' wurde angenommen.',
        'titel' => 'Deine Prämienabrechnung wurde angenommen',
        'medium' => $note['medium'],
        'absaetze' => $absaetze,
        'hinweis' => ['Angenommen – ' . eur(note_summe($note)) . ' werden überwiesen.', 'erfolg'],
        'tabelle' => [['Prämienabrechnung', $note['nummer']], ['Betrag', eur(note_summe($note))]],
        'knopf' => ['Prämienabrechnung ansehen', app_link($db, 'noten')],
    ]);
}

function mail_angenommen_buchhaltung(PDO $db, array $note): array
{
    $name = autor_name($note);
    return mail_bauen([
        'betreff' => "Zur Zahlung: {$note['nummer']} (" . eur(note_summe($note)) . ')',
        'vorschau' => "Die Redaktion hat die Prämienabrechnung von $name angenommen.",
        'titel' => 'Prämienabrechnung zur Zahlung freigegeben',
        'medium' => $note['medium'],
        'absaetze' => ["Die Redaktion hat die Prämienabrechnung von $name angenommen. Sie steht jetzt in der Buchhaltung zur Zahlung bereit."],
        'tabelle' => [['Prämienabrechnung', $note['nummer']], ['Von', $name], ['Medium', medium_name($note['medium'])], ['Betrag', eur(note_summe($note))]],
        'knopf' => ['Zur Buchhaltung', app_link($db, 'zahlung')],
    ]);
}

function mail_abgelehnt_autor(PDO $db, array $note, string $grund): array
{
    $vorname = $note['autor']['vorname'] ?? '';
    return mail_bauen([
        'betreff' => "Prämienabrechnung {$note['nummer']}: bitte überarbeiten",
        'vorschau' => 'Die Redaktion hat deine Prämienabrechnung zurückgegeben: ' . kuerze($grund, 80),
        'titel' => 'Bitte überarbeite deine Prämienabrechnung',
        'medium' => $note['medium'],
        'absaetze' => ["Hallo $vorname,", 'die Redaktion hat deine Prämienabrechnung zurückgegeben. Die Leistungen stehen wieder unter „Mein Monat“ – dort kannst du sie korrigieren und neu abschicken.'],
        'hinweis' => ["Begründung der Redaktion:\n$grund", 'gefahr'],
        'tabelle' => [['Prämienabrechnung', $note['nummer']]],
        'knopf' => ['Leistungen überarbeiten', app_link($db, 'leistungen')],
    ]);
}

function mail_bezahlt_autor(PDO $db, array $note, string $datum): array
{
    $vorname = $note['autor']['vorname'] ?? '';
    return mail_bauen([
        'betreff' => "Prämienabrechnung {$note['nummer']} bezahlt",
        'vorschau' => eur(note_summe($note)) . ' wurden am ' . datum_text($datum) . ' überwiesen.',
        'titel' => 'Deine Anerkennungsprämie ist unterwegs',
        'medium' => $note['medium'],
        'absaetze' => ["Hallo $vorname,", 'die Buchhaltung hat deine Prämienabrechnung bezahlt. Je nach Bank ist das Geld in ein bis zwei Werktagen auf deinem Konto.'],
        'hinweis' => ['Überwiesen am ' . datum_text($datum) . ': ' . eur(note_summe($note)), 'erfolg'],
        'tabelle' => [['Prämienabrechnung', $note['nummer']], ['Betrag', eur(note_summe($note))], ['Bezahlt am', datum_text($datum)]],
        'knopf' => ['Meine Prämienabrechnungen', app_link($db, 'noten')],
    ]);
}

function mail_anfrage_admin(PDO $db, array $a): array
{
    $name = trim($a['vorname'] . ' ' . $a['nachname']);
    $absaetze = ["$name möchte einen Zugang zu den Anerkennungsprämien."];
    if (($a['nachricht'] ?? '') !== '') $absaetze[] = "Nachricht: „{$a['nachricht']}“";
    return mail_bauen([
        'betreff' => "Neue Zugangsanfrage: $name",
        'vorschau' => "$name ({$a['email']}) hat einen Zugang angefragt.",
        'titel' => 'Neue Zugangsanfrage',
        'absaetze' => $absaetze,
        'tabelle' => [['Name', $name], ['E-Mail', $a['email']]],
        'knopf' => ['Anfrage bearbeiten', app_link($db, 'admin/anfragen')],
    ]);
}

function mail_zugang(PDO $db, array $z, bool $neu = true): array
{
    return mail_bauen([
        'betreff' => $neu ? 'Dein Zugang zu den Anerkennungsprämien' : 'Dein neues Startpasswort für die Prämienabrechnungen',
        'vorschau' => $neu ? 'Dein Konto ist bereit – hier sind deine Zugangsdaten.' : 'Hier ist dein neues Startpasswort.',
        'titel' => $neu ? 'Willkommen bei den Anerkennungsprämien!' : 'Neues Startpasswort',
        'absaetze' => array_values(array_filter([
            "Hallo {$z['vorname']},",
            $neu ? 'dein Zugang zu den Anerkennungsprämien von campus a college und campus a ist bereit.' : 'für dein Konto wurde ein neues Startpasswort erstellt.',
            'Beim ersten Anmelden legst du ein eigenes Passwort fest' . ($neu ? ' und richtest dein Konto ein (Adresse, IBAN und Link zu deinem Profil).' : '.'),
        ])),
        'tabelle' => [['E-Mail', $z['email']], ['Startpasswort', $z['passwort'], true]],
        'knopf' => ['Jetzt anmelden', app_link($db)],
    ]);
}

function mail_email_geaendert(PDO $db, string $vorname, string $alt, string $neu): array
{
    return mail_bauen([
        'betreff' => 'Deine E-Mail-Adresse wurde geändert',
        'vorschau' => 'Für dein Konto bei den Anerkennungsprämien gilt jetzt eine neue E-Mail-Adresse.',
        'titel' => 'E-Mail-Adresse geändert',
        'absaetze' => ["Hallo $vorname,", 'die E-Mail-Adresse deines Kontos bei den Anerkennungsprämien wurde geändert. Zum Anmelden verwendest du ab jetzt die neue Adresse, dein Passwort bleibt gleich.'],
        'tabelle' => [['Bisher', $alt], ['Neu', $neu, true]],
        'hinweis' => ['Warst du das nicht? Dann melde dich bitte sofort beim Admin.', 'gefahr'],
        'knopf' => ['Zur Anmeldung', app_link($db)],
    ]);
}

function mail_test(PDO $db, string $an): array
{
    return mail_bauen([
        'betreff' => 'Test-E-Mail der Anerkennungsprämien',
        'vorschau' => 'Der E-Mail-Versand funktioniert.',
        'titel' => 'Der E-Mail-Versand funktioniert',
        'absaetze' => ['Diese Test-E-Mail kommt von der Anerkennungsprämien-App. Ab jetzt gehen Benachrichtigungen automatisch hinaus:',
            "• neue Prämienabrechnungen an die Redaktion\n• Eingangsbestätigung, Annahme, Rückgabe und Zahlung an die Autor:innen\n• angenommene Prämienabrechnungen an die Buchhaltung\n• Zugangsanfragen an die Admins",
            'Jede:r wählt im eigenen Profil aus, welche dieser E-Mails sie bekommen will.'],
        'hinweis' => ['Gesendet an ' . $an, 'erfolg'],
        'knopf' => ['Zur App', app_link($db)],
    ]);
}

/** ISO-Zeitstempel (UTC) -> Wiener Ortszeit "JJJJ-MM-TT HH:MM" */
function zeit_wien(?string $iso): string
{
    if (!$iso) return '';
    return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('Y-m-d H:i');
}
