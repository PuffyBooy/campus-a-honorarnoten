<?php
// Betrieb: Wartungsmodus (nur Admins kommen hinein) und Warn-Mail an Admins, wenn im Protokoll Fehler auftauchen.
declare(strict_types=1);

const WARTUNG_TEXT = 'Wir arbeiten gerade an der App. Bitte versuch es etwas später noch einmal.';
/** im Wartungsmodus auch ohne Admin erlaubt: Anmelden (für Admins), Abmelden, Impressum und Datenschutz */
const WARTUNG_ERLAUBT = ['anmelden', 'abmelden', 'rechtliches'];
const WARNMAIL_ABSTAND = 3600; // höchstens eine Warn-Mail pro Stunde, weitere Fehler kommen in die nächste

function wartung_laden(PDO $db): array
{
    $w = json_decode((string) wert($db, "select wert from einstellungen where schluessel = 'wartung'"), true);
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
