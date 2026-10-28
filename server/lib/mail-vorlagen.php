<?php
// Gestaltung der automatischen E-Mails: schlicht wie ein Brief – weißer Grund, kleiner Schriftzug oben,
// Text, Übersicht und ein Knopf zur App. Nur Tabellen und Inline-Stile (Outlook, Gmail, Apple Mail),
// feste Schriftgrößen in px und eine eigene Fassung für den Dunkelmodus. Jede Mail hat auch eine Textfassung.
declare(strict_types=1);

const FARBE = '#0f6b66';      // Petrol, wie die App
const FARBE_HELL = '#e3f1ef';
const SCHRIFT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const TEXT = '#1c2321';
const LEISE = '#5d6864';
const LINIE = '#e2e8e6';

/** Dunkelmodus: Apple Mail, iOS, Outlook (neu) und Outlook.com übernehmen diese Farben statt sie selbst umzudrehen */
const DUNKEL_CSS = '@media (prefers-color-scheme: dark){'
    . '.m-grund{background:#151a19 !important;}.m-text{color:#e7ecea !important;}.m-leise{color:#a3aeaa !important;}'
    . '.m-linie{border-color:#2c3533 !important;}.m-akzent{color:#5cc2b8 !important;}.m-kasten{background:#1f2826 !important;}'
    . '.m-knopf{background:#1a8c84 !important;}}'
    . '[data-ogsc] .m-text{color:#e7ecea !important;}[data-ogsc] .m-leise{color:#a3aeaa !important;}'
    . '[data-ogsc] .m-akzent{color:#5cc2b8 !important;}[data-ogsb] .m-grund{background:#151a19 !important;}'
    . '[data-ogsb] .m-kasten{background:#1f2826 !important;}';

/** Absatz-Stil (Schrift überall wiederholt: Outlook erbt sie nicht zuverlässig) */
function m_stil(int $groesse, string $farbe = TEXT, string $mehr = ''): string
{
    return SCHRIFT . "font-size:{$groesse}px;line-height:" . round($groesse * 1.5) . "px;color:$farbe;$mehr";
}

/**
 * Baut eine Mail.
 * $t = [
 *   'betreff', 'vorschau' (Text in der Postfach-Vorschau), 'titel', 'medium' (optional),
 *   'absaetze' => [Text, …] (einfacher Text, wird maskiert),
 *   'hinweis' => [Text, Art: 'erfolg'|'gefahr'|'info'] (optional, hervorgehobener Absatz),
 *   'tabelle' => [[links, rechts, festbreite?], …] (optional, Übersicht wie Nummer, Betrag),
 *   'positionen' => [[Titel, Datum, Betrag], …] (optional), 'summe' => Text (optional),
 *   'knopf' => [Beschriftung, Adresse] (optional), 'nachsatz' => kleiner Text unter dem Knopf (optional),
 * ]
 */
function mail_bauen(array $t): array
{
    $medium = $t['medium'] ?? null;
    $marke = $medium ? medium_name($medium) : 'campus a';
    $randFarben = ['erfolg' => '#1a7f37', 'gefahr' => '#b42318', 'info' => FARBE];

    $html = '';
    foreach ($t['absaetze'] ?? [] as $a) {
        $html .= '<p class="m-text" style="margin:0 0 16px;' . m_stil(16) . '">' . nl2br(h($a)) . '</p>';
    }
    if (!empty($t['hinweis'])) {
        [$text, $art] = $t['hinweis'] + [1 => 'info'];
        $html .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr>'
            . '<td class="m-kasten m-text" style="background:#f4f7f6;border-left:3px solid ' . ($randFarben[$art] ?? FARBE) . ';padding:12px 16px;'
            . m_stil(15) . '">' . nl2br(h($text)) . '</td></tr></table>';
    }
    if (!empty($t['tabelle'])) {
        $html .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;border-collapse:collapse;">';
        foreach ($t['tabelle'] as $zeile) {
            [$l, $r] = $zeile;
            // dritter Wert true: Festbreitenschrift (z. B. Startpasswort – l und I nicht verwechseln)
            $wert = !empty($zeile[2])
                ? "font-family:Menlo,Consolas,'Courier New',monospace;font-size:16px;line-height:24px;color:" . TEXT . ';letter-spacing:1px;'
                : m_stil(15);
            $html .= '<tr><td class="m-leise m-linie" style="padding:8px 12px 8px 0;border-bottom:1px solid ' . LINIE . ';width:40%;' . m_stil(14, LEISE) . '">' . h($l) . '</td>'
                . '<td class="m-text m-linie" style="padding:8px 0;border-bottom:1px solid ' . LINIE . ';' . $wert . '">' . h($r) . '</td></tr>';
        }
        $html .= '</table>';
    }
    if (!empty($t['positionen'])) {
        $kopf = fn ($text, $mehr = '') => '<td class="m-leise m-linie" ' . $mehr . ' style="padding:0 0 6px;border-bottom:1px solid ' . LINIE . ';'
            . m_stil(13, LEISE) . '">' . $text . '</td>';
        $html .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;border-collapse:collapse;"><tr>'
            . $kopf('Leistung') . $kopf('Datum') . $kopf('Betrag', 'align="right"') . '</tr>';
        foreach ($t['positionen'] as [$titel, $datum, $betrag]) {
            $html .= '<tr><td class="m-text m-linie" style="padding:10px 12px 10px 0;border-bottom:1px solid ' . LINIE . ';' . m_stil(15) . '">' . h($titel) . '</td>'
                . '<td class="m-leise m-linie" style="padding:10px 12px 10px 0;border-bottom:1px solid ' . LINIE . ';white-space:nowrap;' . m_stil(14, LEISE) . '">' . h($datum) . '</td>'
                . '<td class="m-text m-linie" align="right" style="padding:10px 0;border-bottom:1px solid ' . LINIE . ';white-space:nowrap;' . m_stil(15) . '">' . h($betrag) . '</td></tr>';
        }
        if (!empty($t['summe'])) {
            $html .= '<tr><td colspan="2" class="m-text" style="padding:12px 12px 0 0;' . m_stil(15, TEXT, 'font-weight:600;') . '">Gesamt</td>'
                . '<td class="m-text" align="right" style="padding:12px 0 0;white-space:nowrap;' . m_stil(16, TEXT, 'font-weight:700;') . '">' . h($t['summe']) . '</td></tr>';
        }
        $html .= '</table>';
    }
    if (!empty($t['knopf'][1])) {
        [$beschriftung, $link] = $t['knopf'];
        $html .= '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr>'
            . '<td class="m-knopf" style="border-radius:6px;background:' . FARBE . ';">'
            . '<a href="' . h($link) . '" style="display:inline-block;padding:12px 22px;' . SCHRIFT . 'font-size:16px;line-height:20px;font-weight:600;'
            . 'color:#ffffff;text-decoration:none;border-radius:6px;">' . h($beschriftung) . '</a></td></tr></table>';
        // bei wichtigen Links (Anmelden, Einladung) zusätzlich die Adresse zum Kopieren
        if (isset($t['nachsatz'])) {
            $html .= '<p class="m-leise" style="margin:0 0 8px;' . m_stil(13, LEISE) . '">' . h($t['nachsatz'])
                . '<br><a class="m-akzent" href="' . h($link) . '" style="color:' . FARBE . ';word-break:break-all;">' . h($link) . '</a></p>';
        }
    }

    $seite = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
        . '<title>' . h($t['betreff']) . '</title><style>' . DUNKEL_CSS . '</style></head>'
        . '<body class="m-grund" style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">'
        . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' . h($t['vorschau'] ?? '') . '</div>'
        . '<table role="presentation" class="m-grund" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:32px 20px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">'
        // Schriftzug
        . '<tr><td class="m-linie" style="padding:0 0 14px;border-bottom:2px solid ' . FARBE . ';">'
        . '<span class="m-akzent" style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;line-height:26px;color:' . FARBE . ';">' . h($marke) . '</span>'
        . '<span class="m-leise" style="' . SCHRIFT . 'font-size:12px;line-height:26px;color:' . LEISE . ';letter-spacing:1px;padding-left:8px;">ANERKENNUNGSPRÄMIEN</span>'
        . '</td></tr>'
        // Inhalt
        . '<tr><td style="padding:28px 0 8px;">'
        . '<h1 class="m-text" style="margin:0 0 18px;' . m_stil(22, TEXT, 'font-weight:700;line-height:28px;') . '">' . h($t['titel']) . '</h1>'
        . $html
        . '</td></tr>'
        // Fuß
        . '<tr><td class="m-leise m-linie" style="padding:18px 0 0;border-top:1px solid ' . LINIE . ';' . m_stil(12, LEISE, 'line-height:18px;') . '">'
        . 'Automatische Nachricht der Anerkennungsprämien-App von campus a college und campus a. Bitte nicht direkt antworten.'
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
    if (!empty($t['knopf'][1])) $text .= $t['knopf'][0] . ': ' . $t['knopf'][1] . "\n" . (isset($t['nachsatz']) ? $t['nachsatz'] . "\n" : '') . "\n";
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
        'absaetze' => ["Hallo $vorname,", 'die Buchhaltung hat deine Prämienabrechnung bezahlt. Je nach Bank ist das Geld in ein bis zwei Werktagen auf deinem Konto. Das Zahlungsavis liegt als PDF bei.'],
        'hinweis' => ['Überwiesen am ' . datum_text($datum) . ': ' . eur(note_summe($note)), 'erfolg'],
        'tabelle' => [['Prämienabrechnung', $note['nummer']], ['Betrag', eur(note_summe($note))], ['Bezahlt am', datum_text($datum)]],
        'knopf' => ['Meine Prämienabrechnungen', app_link($db, 'noten')],
    ]) + ['anhaenge' => [[zahlungsavis_name($note), 'application/pdf', zahlungsavis_pdf($note, $datum)]]];
}

function zahlungsavis_name(array $note): string
{
    return 'Zahlungsavis_' . preg_replace('/[^\w-]/', '', $note['nummer']) . '.pdf';
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
            'Mit dem Knopf unten bist du direkt angemeldet und legst ein eigenes Passwort fest' . ($neu ? '. Danach trägst du Adresse, IBAN und den Link zu deinem Profil ein.' : '.'),
            'Falls der Knopf nicht mehr gilt: Anmelden geht auch mit deiner E-Mail-Adresse und dem Startpasswort.',
        ])),
        'tabelle' => [['E-Mail', $z['email']], ['Startpasswort', $z['passwort'], true]],
        'knopf' => [$neu ? 'Konto einrichten' : 'Jetzt anmelden', $z['link'] ?? app_link($db)],
        'nachsatz' => 'Der Knopf meldet dich direkt an und gilt einmal, 7 Tage lang. Danach meldest du dich mit E-Mail und Passwort an.',
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

function mail_pdf(PDO $db, string $vorname, string $titel, string $dateiname): array
{
    return mail_bauen([
        'betreff' => $titel,
        'vorschau' => 'Im Anhang: ' . $dateiname,
        'titel' => $titel,
        'absaetze' => ["Hallo $vorname,", 'wie gewünscht kommen die Prämienabrechnungen als PDF im Anhang.'],
        'tabelle' => [['Datei', $dateiname]],
        'knopf' => ['Zur Buchhaltung', app_link($db, 'zahlung')],
    ]);
}

function mail_registriert_admin(PDO $db, array $n): array
{
    $name = trim($n['vorname'] . ' ' . $n['nachname']);
    return mail_bauen([
        'betreff' => "Neu registriert: $name",
        'vorschau' => "$name hat sich mit einem Registrierungslink angemeldet.",
        'titel' => 'Neues Konto über Registrierungslink',
        'absaetze' => ["$name hat sich mit einem Registrierungslink selbst registriert."],
        'tabelle' => [['Name', $name], ['E-Mail', $n['email']], ['Rollen', implode(', ', array_map(fn ($r) => ROLLEN_LABEL[$r] ?? $r, $n['rollen']))]],
        'knopf' => ['Konten ansehen', app_link($db, 'admin/benutzer')],
    ]);
}

function mail_einladung(PDO $db, string $link, int $tage, array $von): array
{
    $bis = $tage === 1 ? 'einen Tag' : "$tage Tage";
    return mail_bauen([
        'betreff' => 'Einladung zu den Anerkennungsprämien',
        'vorschau' => 'Mit diesem Link legst du dein Konto selbst an.',
        'titel' => 'Du bist eingeladen',
        'absaetze' => ['Hallo,', anzeigename($von) . " lädt dich zu den Anerkennungsprämien von campus a college und campus a ein. Mit dem Knopf unten legst du dein Konto selbst an – das dauert eine Minute.",
            "Der Link gilt $bis."],
        'knopf' => ['Konto anlegen', $link],
        'nachsatz' => 'Oder diese Adresse im Browser öffnen:',
    ]);
}

function mail_passwort_vergessen(PDO $db, string $vorname, string $link): array
{
    return mail_bauen([
        'betreff' => 'Neues Passwort für die Anerkennungsprämien',
        'vorschau' => 'Mit diesem Link legst du ein neues Passwort fest.',
        'titel' => 'Neues Passwort festlegen',
        'absaetze' => ["Hallo $vorname,", 'du hast ein neues Passwort angefordert. Mit dem Knopf legst du es fest. Der Link gilt eine Stunde und nur einmal.',
            'Warst du das nicht? Dann ignoriere diese E-Mail einfach, dein bisheriges Passwort bleibt gültig.'],
        'knopf' => ['Neues Passwort festlegen', $link],
        'nachsatz' => 'Oder diese Adresse im Browser öffnen:',
    ]);
}

function mail_passwort_geaendert(PDO $db, string $vorname): array
{
    return mail_bauen([
        'betreff' => 'Dein Passwort wurde geändert',
        'vorschau' => 'Für dein Konto gilt jetzt ein neues Passwort.',
        'titel' => 'Passwort geändert',
        'absaetze' => ["Hallo $vorname,", 'das Passwort deines Kontos bei den Anerkennungsprämien wurde gerade geändert.'],
        'hinweis' => ['Warst du das nicht? Dann melde dich bitte sofort beim Admin.', 'gefahr'],
        'knopf' => ['Zur Anmeldung', app_link($db)],
    ]);
}

function mail_zwei_faktor(PDO $db, string $vorname, bool $an): array
{
    return mail_bauen([
        'betreff' => $an ? 'Zwei-Faktor-Anmeldung eingeschaltet' : 'Zwei-Faktor-Anmeldung ausgeschaltet',
        'vorschau' => $an ? 'Beim Anmelden brauchst du ab jetzt den Code aus der App.' : 'Beim Anmelden reicht wieder das Passwort.',
        'titel' => $an ? 'Zwei-Faktor-Anmeldung ist an' : 'Zwei-Faktor-Anmeldung ist aus',
        'absaetze' => ["Hallo $vorname,", $an
            ? 'für dein Konto ist jetzt die Zwei-Faktor-Anmeldung eingeschaltet. Beim Anmelden brauchst du zusätzlich den Code aus deiner App. Bewahre die Ersatz-Codes gut auf.'
            : 'für dein Konto ist die Zwei-Faktor-Anmeldung jetzt ausgeschaltet. Beim Anmelden reicht wieder das Passwort.'],
        'hinweis' => ['Warst du das nicht? Dann melde dich bitte sofort beim Admin.', $an ? 'info' : 'gefahr'],
        'knopf' => ['Zur App', app_link($db)],
    ]);
}

const WARNMAIL_BETREFF = 'Probleme in der Anerkennungsprämien-App';

/** Warn-Mail an Admins: neue Fehler aus dem Protokoll */
function mail_probleme(PDO $db, array $eintraege, int $anzahl): array
{
    return mail_bauen([
        'betreff' => WARNMAIL_BETREFF,
        'vorschau' => $anzahl === 1 ? 'Im Protokoll steht ein neuer Fehler.' : "Im Protokoll stehen $anzahl neue Fehler.",
        'titel' => 'Da stimmt etwas nicht',
        'absaetze' => [$anzahl === 1 ? 'Im Protokoll der App steht ein neuer Fehler:' : "Im Protokoll der App stehen $anzahl neue Fehler oder Warnungen:"],
        'tabelle' => array_map(fn ($e) => [zeitpunkt_text($e['zeit']), $e['text']], $eintraege),
        'hinweis' => [($anzahl > count($eintraege) ? 'Hier stehen nur die ersten ' . count($eintraege) . '. ' : '')
            . 'Weitere Fehler sammeln wir und schicken höchstens eine E-Mail pro Stunde. Ausschalten im Profil unter „E-Mail-Benachrichtigungen“.', 'gefahr'],
        'knopf' => ['Protokoll öffnen', app_link($db, 'admin/protokoll')],
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
