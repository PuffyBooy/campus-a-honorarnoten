<?php
// Betrieb: Wartungsmodus (nur Admins kommen hinein) und Warn-Mail an Admins, wenn im Protokoll Fehler auftauchen.
declare(strict_types=1);

const WARTUNG_TEXT = 'Wir arbeiten gerade an der App. Bitte versuch es etwas später noch einmal.';
/** im Wartungsmodus auch ohne Admin erlaubt: Anmelden (für Admins), Abmelden, Impressum und Datenschutz */
const WARTUNG_ERLAUBT = ['anmelden', 'abmelden', 'rechtliches'];
const WARNMAIL_ABSTAND = 3600; // höchstens eine Warn-Mail pro Stunde, weitere Fehler kommen in die nächste
const ERINNERUNG_TAGE = 3;      // Standard: Erinnerung an gespeicherte Leistungen 3 Tage vor Monatsende

function wartung_laden(PDO $db): array
{
    return wartung_aus_wert(wert($db, "select wert from einstellungen where schluessel = 'wartung'"));
}

/** Wartungsmodus aus dem gespeicherten Wert (JSON) – auch für anfrage_kontext, das ihn gleich mitliest */
function wartung_aus_wert(mixed $wert): array
{
    $w = json_decode((string) $wert, true);
    $w = is_array($w) ? $w : [];
    return ['an' => !empty($w['an']), 'text' => tr($w['text'] ?? '') ?: WARTUNG_TEXT, 'seit' => $w['seit'] ?? null, 'von' => $w['von'] ?? ''];
}

function ist_admin(?array $n): bool
{
    return $n !== null && in_array('admin', $n['rollen'] ?? [], true);
}

/**
 * Warn-Mail an die Admins (Benachrichtigung „probleme“): neue Fehler im Protokoll und gesperrte Anmeldungen,
 * gesammelt, höchstens einmal pro Stunde. Läuft nach jeder Anfrage im Hintergrund.
 */
function warnmail_pruefen(PDO $db): void
{
    $stand = json_decode((string) wert($db, "select wert from einstellungen where schluessel = 'warnmail'"), true);
    $stand = is_array($stand) ? $stand : [];
    $bis = (int) ($stand['bis'] ?? 0);
    if ($bis === 0) {
        // erstes Mal: nur Neues ab jetzt melden, nicht die alten Einträge
        $bis = (int) wert($db, 'select coalesce(max(id), 0) from protokoll');
        upsert($db, 'einstellungen', ['schluessel' => 'warnmail', 'wert' => json_text(['bis' => max($bis, 1), 'zeit' => 0])], ['schluessel']);
        return;
    }
    if (time() - (int) ($stand['zeit'] ?? 0) < WARNMAIL_ABSTAND) return;
    $neu = zeilen($db, "select * from protokoll where id > ? and (stufe = 'fehler' or text like 'Zu viele Anmeldeversuche%')
        and text not like ? order by id limit 30", [$bis, 'E-Mail „' . WARNMAIL_BETREFF . '%']);
    if (!$neu) return;
    $letzte = (int) wert($db, 'select max(id) from protokoll where id > ?', [$bis]);
    // zuerst den Stand speichern: eine zweite, gleichzeitige Anfrage schickt dieselben Einträge nicht noch einmal
    $r = q($db, "update einstellungen set wert = ? where schluessel = 'warnmail' and wert = ?",
        [json_text(['bis' => $letzte, 'zeit' => time()]), wert($db, "select wert from einstellungen where schluessel = 'warnmail'")]);
    if ($r->rowCount() !== 1) return;
    $anzahl = (int) wert($db, "select count(*) from protokoll where id > ? and id <= ? and (stufe = 'fehler' or text like 'Zu viele Anmeldeversuche%')
        and text not like ?", [$bis, $letzte, 'E-Mail „' . WARNMAIL_BETREFF . '%']);
    benachrichtigen($db, 'probleme', mail_probleme($db, array_map('protokoll_aus_zeile', $neu), $anzahl));
}

/**
 * Erinnerung zum Monatsende (einmal pro Monat, ab „erinnerung_tage“ vor Monatsende): wer Leistungen gespeichert,
 * aber noch nicht eingereicht hat, bekommt eine E-Mail (Benachrichtigung „erinnerung“, im Profil abschaltbar).
 */
function monatserinnerung(PDO $db): int
{
    $tage = einstellungen_laden($db)['erinnerung_tage'];
    $rest = (int) date('t') - (int) date('j'); // am letzten Tag des Monats 0
    if ($tage <= 0 || $rest >= $tage) return 0;
    $monat = json_text(date('Y-m'));
    // zuerst vermerken: eine gleichzeitige Anfrage verschickt nicht noch einmal
    if (q($db, "update einstellungen set wert = ? where schluessel = 'erinnerung_monat' and wert <> ?", [$monat, $monat])->rowCount() !== 1) {
        if (wert($db, "select 1 from einstellungen where schluessel = 'erinnerung_monat'")) return 0;
        try {
            q($db, "insert into einstellungen (schluessel, wert) values ('erinnerung_monat', ?)", [$monat]);
        } catch (PDOException) {
            return 0;
        }
    }
    $gesendet = 0;
    foreach (zeilen($db, 'select autor_id, count(*) anzahl, sum(betrag_cent) summe from positionen group by autor_id') as $z) {
        $n = nutzer_laden($db, $z['autor_id']);
        if (!$n || !$n['aktiv']) continue;
        $n['benachrichtigungen'] = (array) $n['benachrichtigungen'];
        if (!bekommt($n, 'erinnerung')) continue;
        $mail = mail_monatserinnerung($db, $n['vorname'], (int) $z['anzahl'], euro((int) $z['summe']), $rest);
        mail_einreihen($db, $n['email'], $mail);
        push_einreihen($db, $n['id'], $mail['betreff'], PUSH_ZIELE['erinnerung']);
        $gesendet++;
    }
    protokoll($db, 'info', 'mail', "Erinnerung zum Monatsende an $gesendet " . ($gesendet === 1 ? 'Person' : 'Personen') . ' mit gespeicherten Leistungen');
    return $gesendet;
}
