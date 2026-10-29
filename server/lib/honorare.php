<?php
// Geschäftslogik des Servers: dieselben Regeln wie in der Demo (public/js/store.js),
// aber hier auf dem Server geprüft – im Browser lässt sich nichts umgehen.
declare(strict_types=1);

const STANDARD_EMPFAENGER = [
    'name' => 'campus a Medien GmbH',
    'strasse' => 'Stiftgasse 6/1/2',
    'plz_ort' => '1070 Wien',
    'uid' => 'ATU81242718',
];
const STANDARD_HOSTER = 'World4You Internet Services GmbH, Wolfgang-Pauli-Straße 2, BT3, 4020 Linz, Österreich';
// Wer die App betreibt (Impressum, Datenschutz, Hinweis „nicht bei campus a angestellt“) – wie public/js/lib/rechtliches.js
const BETREIBER_STANDARD = [
    'name' => '', 'anschrift' => '', 'email' => '', 'telefon' => '', 'extern' => true, 'hoster' => STANDARD_HOSTER,
    'zusatz_impressum' => '', 'zusatz_datenschutz' => '', 'stand' => '',
];
const PDF_MAX = 6 * 1024 * 1024; // größere PDFs bitte herunterladen statt mailen
const ARTIKEL_DOPPELT = 'Dieser Artikel ist schon als Leistung gespeichert oder abgerechnet.';
const ZUSTIMMUNG_FEHLT = 'Bitte bestätige, dass du die Datenschutzerklärung und den Hinweis zum Betreiber gelesen hast.';

/** Kontext einer Anfrage */
final class Ctx
{
    public ?string $neueSitzung = null;
    public bool $sitzungLoeschen = false;
    public bool $erlaubtMitStartpasswort = false;
    /** Admin, der die App gerade als $nutzer ansieht (nur lesen), sonst null */
    public ?array $ansichtVon = null;
    /** @var callable|null Ersatz für den Abruf von campus-a-college.at (Tests) */
    public $holen = null;

    public function __construct(public PDO $db, public ?array $nutzer = null, public ?string $token = null)
    {
    }
}

function profil_link_fehler(string $m): string
{
    return 'Bitte den Link zu deinem Profil auf ' . MEDIEN[$m]['seite'] . ' einfügen, z. B. ' . MEDIEN[$m]['basis'] . '/profil/…';
}

function anzeigename(array $n): string
{
    return trim($n['vorname'] . ' ' . $n['nachname']) ?: $n['email'];
}

// ------------------------------------------------------------------ Nutzer:innen

function nutzer_aus_zeile(?array $z): ?array
{
    if (!$z) return null;
    return [
        'id' => $z['id'],
        'email' => $z['email'],
        'vorname' => $z['vorname'],
        'nachname' => $z['nachname'],
        'rollen' => json_decode($z['rollen'], true) ?: [],
        'aktiv' => (bool) $z['aktiv'],
        'muss_passwort_aendern' => (bool) $z['muss_passwort_aendern'],
        'profil' => [
            'strasse' => $z['strasse'], 'plz_ort' => $z['plz_ort'], 'kontoinhaber' => $z['kontoinhaber'], 'iban' => $z['iban'], 'bic' => $z['bic'],
            'campus_profil' => $z['campus_profil'] ?? '', 'campus_a_profil' => $z['campus_a_profil'] ?? '',
        ],
        'erstellt_am' => $z['erstellt_am'],
        'letzter_login' => $z['letzter_login'],
        'hinweis_bestaetigt_am' => $z['hinweis_bestaetigt_am'] ?? null,
        'zwei_faktor' => !empty($z['zwei_faktor']),
        'neuigkeiten_gesehen' => $z['neuigkeiten_gesehen'] ?? null,
        'nummer_basis' => $z['nummer_basis'] ?? null,
        'benachrichtigungen' => (object) (json_decode($z['benachrichtigungen'] ?? '{}', true) ?: []),
    ];
}

function nutzer_laden(PDO $db, string $id): ?array
{
    return nutzer_aus_zeile(zeile($db, 'select * from nutzer where id = ?', [$id]));
}

function hat(array $n, string $rolle): bool
{
    return in_array($rolle, $n['rollen'], true) || ($rolle !== 'autor' && in_array('admin', $n['rollen'], true));
}

function ich(Ctx $ctx): array
{
    pruefe($ctx->nutzer, 'Bitte melde dich an.', 401);
    // Solange das Startpasswort gilt, ist nur das Festlegen eines eigenen Passworts erlaubt
    pruefe(!$ctx->nutzer['muss_passwort_aendern'] || $ctx->erlaubtMitStartpasswort, 'Bitte lege zuerst ein eigenes Passwort fest.', 403);
    return $ctx->nutzer;
}

function brauche(Ctx $ctx, string $rolle): array
{
    $n = ich($ctx);
    pruefe(hat($n, $rolle), 'Dafür fehlt dir die Berechtigung.', 403);
    // Autor:innen müssen zuerst ihr Konto einrichten (Adresse, Bankverbindung, Profil-Link)
    if ($rolle === 'autor') pruefe(konto_fertig($n), KONTO_FEHLT, 403);
    return $n;
}

function einstellungen_laden(PDO $db): array
{
    $e = ['empfaenger' => STANDARD_EMPFAENGER, 'datenschutzKontakt' => '', 'honorarsaetze' => standard_saetze(), 'betreiber' => BETREIBER_STANDARD];
    foreach (zeilen($db, 'select * from einstellungen') as $z) {
        // „auftraggeber“: früheres SEPA-Konto, „mail“: eigene Einstellungen (mit Passwort, nie an den Browser),
        // „zahlungskonto“: nur für Buchhaltung und Admin (eigene Funktion)
        if (in_array($z['schluessel'], ['auftraggeber', 'mail', 'zahlungskonto', 'wartung', 'warnmail', 'erinnerung_monat'], true)) continue;
        $e[$z['schluessel']] = json_decode($z['wert'], true);
    }
    $e['honorarsaetze'] = saetze_normalisieren($e['honorarsaetze']); // ältere Sätze ohne Medium gelten für beide
    $e['betreiber'] = array_merge(BETREIBER_STANDARD, array_intersect_key(is_array($e['betreiber']) ? $e['betreiber'] : [], BETREIBER_STANDARD));
    $e['rueckgabe_vorlagen'] = vorlagen_normalisieren($e['rueckgabe_vorlagen'] ?? null);
    $e['erinnerung_tage'] = max(0, min(31, (int) ($e['erinnerung_tage'] ?? ERINNERUNG_TAGE)));
    return $e;
}

// ------------------------------------------------------------------ Prämienabrechnungen laden

function position_aus_zeile(array $p): array
{
    return [
        'id' => $p['id'], 'kategorie' => $p['kategorie'], 'art' => $p['art'], 'kolumnenart' => $p['kolumnenart'] ?? '', 'titel' => $p['titel'],
        'veroeffentlichung' => $p['veroeffentlichung'], 'artikel_url' => $p['artikel_url'] ?? '', 'medium' => medium_oder($p['medium'] ?? null),
        'anzahl' => (int) ($p['anzahl'] ?? 0), 'zurueck_nummer' => $p['zurueck_nummer'] ?? '', 'zurueck_grund' => $p['zurueck_grund'] ?? '',
        'ausgabe' => $p['ausgabe'], 'vereinbart_mit' => $p['vereinbart_mit'], 'notiz' => $p['notiz'],
        'betrag' => euro((int) $p['betrag_cent']), 'betrag_eingereicht' => euro((int) $p['betrag_eingereicht_cent']),
        'betrag_vermerk' => $p['betrag_vermerk'],
        'geprueft_von' => $p['geprueft_von'] ?? null, 'geprueft_am' => $p['geprueft_am'] ?? null,
    ];
}

/**
 * $positionen: schon geladene Zeilen aus note_positionen (sonst werden sie hier geholt),
 * $nachrichten: Anzahl der Nachrichten zu Rückfragen (sonst wird sie hier gezählt)
 */
function note_aus_zeile(PDO $db, array $z, ?array $positionen = null, ?int $nachrichten = null): array
{
    $positionen = nachweise_anhaengen($db, array_map('position_aus_zeile',
        $positionen ?? zeilen($db, 'select * from note_positionen where note_id = ? order by reihenfolge', [$z['id']])));
    return [
        'id' => $z['id'], 'nummer' => $z['nummer'], 'jahr' => (int) $z['jahr'], 'laufende_nummer' => (int) $z['laufende_nummer'],
        'monat' => $z['monat'], 'medium' => medium_oder($z['medium']), 'autor_id' => $z['autor_id'], 'status' => $z['status'],
        'eingereicht_am' => $z['eingereicht_am'], 'entschieden_am' => $z['entschieden_am'], 'bezahlt_am' => $z['bezahlt_am'],
        'ablehnungsgrund' => $z['ablehnungsgrund'], 'zurueckgeholt_am' => $z['zurueckgeholt_am'],
        'rueckfrage' => $z['rueckfrage'] ?? null,
        'nachrichten' => $nachrichten ?? (int) wert($db, 'select count(*) from nachrichten where note_id = ?', [$z['id']]),
        'autor' => json_decode($z['autor_json'], true), 'zahlung' => json_decode($z['zahlung_json'], true),
        'empfaenger' => json_decode($z['empfaenger_json'], true),
        'positionen' => $positionen,
    ];
}

function note_holen(PDO $db, mixed $noteId): array
{
    $z = zeile($db, 'select * from noten where id = ?', [s($noteId)]);
    pruefe($z, 'Diese Prämienabrechnung gibt es nicht (mehr).', 404);
    return note_aus_zeile($db, $z);
}

function darf_sehen(array $n, array $note): bool
{
    if (hat($n, 'redaktion')) return true;
    if ($note['autor_id'] === $n['id']) return true;
    return hat($n, 'buchhaltung') && in_array($note['status'], ['angenommen', 'bezahlt'], true);
}

function darf_zahlungsdaten(array $n, array $note): bool
{
    return $note['autor_id'] === $n['id'] || in_array('admin', $n['rollen'], true)
        || (hat($n, 'buchhaltung') && in_array($note['status'], ['angenommen', 'bezahlt'], true));
}

/** Sicht auf eine Note: die Redaktion bekommt keine IBAN und keine Adresse */
function sicht(array $n, array $note): array
{
    $k = $note;
    $k['betrag'] = note_summe($note);
    if (!darf_zahlungsdaten($n, $note)) {
        unset($k['zahlung']);
        $k['autor'] = ['vorname' => $note['autor']['vorname'] ?? '', 'nachname' => $note['autor']['nachname'] ?? '', 'email' => $note['autor']['email'] ?? ''];
    }
    return $k;
}

function noten_liste(PDO $db, array $n, string $where = '', array $params = [], string $order = 'eingereicht_am desc', string $limit = ''): array
{
    $zeilen = zeilen($db, "select * from noten $where order by $order $limit", $params);
    // Leistungen aller Noten gesammelt laden statt mit einer Abfrage pro Note
    $positionen = [];
    $nachrichten = [];
    foreach (array_chunk(array_column($zeilen, 'id'), 500) as $ids) {
        $platz = implode(',', array_fill(0, count($ids), '?'));
        foreach (zeilen($db, "select * from note_positionen where note_id in ($platz) order by reihenfolge", $ids) as $p) $positionen[$p['note_id']][] = $p;
        foreach (zeilen($db, "select note_id, count(*) anzahl from nachrichten where note_id in ($platz) group by note_id", $ids) as $r) {
            $nachrichten[$r['note_id']] = (int) $r['anzahl'];
        }
    }
    return array_map(fn ($z) => sicht($n, note_aus_zeile($db, $z, $positionen[$z['id']] ?? [], $nachrichten[$z['id']] ?? 0)), $zeilen);
}

const REDAKTION_SORTIERUNG = [
    'eingereicht_asc' => 'eingereicht_am asc', 'eingereicht_desc' => 'eingereicht_am desc',
    'betrag_desc' => '(select sum(betrag_cent) from note_positionen np where np.note_id = noten.id) desc, eingereicht_am desc',
    'name' => 'nummer asc', // die Nummer beginnt mit dem Nachnamen
];

function verlauf_eintragen(PDO $db, string $noteId, array $n, string $aktion, array $details = []): void
{
    q($db, 'insert into verlauf (id, note_id, akteur_id, akteur_name, aktion, details, am) values (?, ?, ?, ?, ?, ?, ?)',
        [neue_id(), $noteId, $n['id'], anzeigename($n), $aktion, json_text((object) $details), jetzt()]);
}

function rueckfrage_text(mixed $text): string
{
    pruefe(!leer($text), 'Die Nachricht ist leer.');
    return kuerze(tr($text), 2000);
}

function nachricht_speichern(PDO $db, string $noteId, array $von, bool $redaktion, string $text): void
{
    q($db, 'insert into nachrichten (id, note_id, von_id, von_name, von_redaktion, text, am) values (?, ?, ?, ?, ?, ?, ?)',
        [neue_id(), $noteId, $von['id'], anzeigename($von), $redaktion ? 1 : 0, $text, jetzt()]);
}

/** E-Mail an alle aktiven Konten, die diese Benachrichtigung eingeschaltet haben (z. B. die Redaktion) */
function benachrichtigen(PDO $db, string $typ, array $mail, ?string $ohne = null): void
{
    foreach (zeilen($db, 'select * from nutzer where aktiv = 1') as $z) {
        $n = nutzer_aus_zeile($z);
        $n['benachrichtigungen'] = (array) $n['benachrichtigungen'];
        if ($n['id'] !== $ohne && bekommt($n, $typ)) mail_einreihen($db, $n['email'], $mail);
    }
}

/** E-Mail an die Autor:in einer Abrechnung – wenn sie diese Benachrichtigung nicht ausgeschaltet hat */
function autor_benachrichtigen(PDO $db, array $note, string $typ, array $mail): void
{
    $n = $note['autor_id'] ? nutzer_laden($db, $note['autor_id']) : null;
    if (!$n) return; // Konto gelöscht
    $n['benachrichtigungen'] = (array) $n['benachrichtigungen'];
    if ($n['aktiv'] && bekommt($n, $typ)) mail_einreihen($db, $n['email'], $mail);
}

// ================================================================== API-Funktionen
// Jede Funktion bekommt den Kontext und die Argumente aus dem Browser.

final class Honorare
{
    /** Alle Funktionen, die der Browser aufrufen darf */
    public const FUNKTIONEN = [
        'aktuellerNutzer', 'anmelden', 'abmelden', 'zugangAnfragen', 'erstesPasswortSetzen', 'passwortAendern',
        'profilSpeichern', 'einstellungen', 'meineLeistungen', 'leistungSpeichern', 'leistungLoeschen', 'nachweisHochladen', 'nachweisLoeschen', 'nachweisLaden', 'meineArtikel',
        'naechsteNummer', 'nummerFestlegen', 'notenDiesenMonat', 'abrechnungAbschicken', 'meineNoten', 'leistungenZurueckholen', 'abrechnungZurueckziehen',
        'alleNoten', 'redaktionListe', 'pruefInfo', 'ausgezahltImJahr', 'note', 'annehmen', 'ablehnen', 'betragKorrigieren', 'positionPruefen', 'kommentieren', 'kommentare', 'verlaufVon',
        'nachrichten', 'nachfragen', 'rueckfrageBeantworten', 'rueckfrageErledigt', 'navZaehler', 'ablaufZeiten', 'neuigkeitenGesehen', 'serverStatus', 'leistungstest', 'serverAktion', 'funktionstest', 'sicherungZurueckspielen', 'ansichtStarten', 'ansichtBeenden',
        'offeneZahlungen', 'zahlungsavis', 'zahlungskonto', 'zahlungskontoSpeichern', 'pdfMailen', 'bezahlteNoten', 'bezahlteNotenSeit', 'alsBezahltMarkieren', 'alleAlsBezahltMarkieren',
        'anfragen', 'offeneAnfragenAnzahl', 'anfrageFreischalten', 'anfrageAblehnen', 'nutzerAnlegen', 'nutzerListe',
        'rollenSetzen', 'nutzerAktivSetzen', 'passwortZuruecksetzen', 'emailAendern', 'nutzerLoeschen', 'noteLoeschen',
        'loeschprotokoll', 'einstellungenSpeichern', 'statistik', 'exportieren',
        'mailEinstellungen', 'mailEinstellungenSpeichern', 'testMail', 'wartung', 'wartungSetzen', 'zweiFaktorStarten', 'zweiFaktorEinschalten', 'zweiFaktorAusschalten', 'zweiFaktorZuruecksetzen', 'passwortVergessen', 'passwortNeuSetzen', 'linkAnmelden', 'einladungPruefen', 'mitLinkRegistrieren',
        'registrierungslinkErstellen', 'registrierungslinks', 'registrierungslinkWiderrufen',
        'dashboard', 'protokoll', 'sicherungen', 'jetztSichern', 'sicherungHerunterladen', 'rechtliches', 'hinweisBestaetigen', 'benachrichtigungenSpeichern',
    ];

    /** „Als Person ansehen“: nur diese Funktionen (lesen) – alles andere ist gesperrt (lib/ansicht.js) */
    public const NUR_ANSEHEN = ['aktuellerNutzer', 'abmelden', 'ansichtBeenden', 'einstellungen', 'rechtliches', 'navZaehler', 'ablaufZeiten',
        'meineLeistungen', 'meineArtikel', 'naechsteNummer', 'notenDiesenMonat', 'meineNoten', 'note', 'nachrichten', 'nachweisLaden',
        'zahlungsavis', 'alleNoten', 'redaktionListe', 'pruefInfo', 'ausgezahltImJahr', 'kommentare', 'verlaufVon',
        'offeneZahlungen', 'bezahlteNoten', 'bezahlteNotenSeit', 'zahlungskonto'];

    /** ohne Anmeldung erlaubt (Impressum und Datenschutz müssen für alle lesbar sein) */
    public const OEFFENTLICH = ['aktuellerNutzer', 'anmelden', 'abmelden', 'zugangAnfragen', 'rechtliches',
        'linkAnmelden', 'einladungPruefen', 'mitLinkRegistrieren', 'passwortVergessen', 'passwortNeuSetzen'];

    public function __construct(private Ctx $ctx)
    {
    }

    /** Eintrag ins Protokoll, mit der angemeldeten Person */
    private function log(string $stufe, string $bereich, string $text, ?array $wer = null): void
    {
        protokoll($this->db(), $stufe, $bereich, $text, $wer ?? $this->ctx->nutzer);
    }

    private function db(): PDO
    {
        return $this->ctx->db;
    }

    // ---------------------------------------------------------------- Sitzung
    public function aktuellerNutzer(): ?array
    {
        $n = $this->ctx->nutzer;
        // Admins sehen oben, dass der Wartungsmodus an ist
        if (ist_admin($n) && wartung_laden($this->db())['an']) $n['wartung'] = true;
        if ($n && $this->ctx->ansichtVon) $n['ansicht_von'] = anzeigename($this->ctx->ansichtVon);
        return $n;
    }

    /** Admin: die App so sehen, wie diese Person sie sieht (nur ansehen, nur in dieser Sitzung) */
    public function ansichtStarten(mixed $uid = null): bool
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        $n = nutzer_laden($db, s($uid));
        pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
        pruefe($n['id'] !== $admin['id'], 'Das ist dein eigenes Konto.');
        pruefe($n['aktiv'], 'Dieses Konto ist deaktiviert.');
        pruefe(!ist_admin($n), 'Admin-Konten können nicht angesehen werden.');
        q($db, 'update sitzungen set ansicht_als = ? where token_hash = ?', [$n['id'], token_hash((string) $this->ctx->token)]);
        $this->log('warnung', 'konten', 'Ansehen als ' . anzeigename($n) . ' (nur lesen) begonnen');
        return true;
    }

    public function ansichtBeenden(): bool
    {
        $db = $this->db();
        if (!$this->ctx->ansichtVon) return true;
        q($db, 'update sitzungen set ansicht_als = null where token_hash = ?', [token_hash((string) $this->ctx->token)]);
        protokoll($db, 'info', 'konten', 'Ansehen als ' . anzeigename($this->ctx->nutzer) . ' beendet', $this->ctx->ansichtVon);
        return true;
    }

    public function wartung(): array
    {
        brauche($this->ctx, 'admin');
        return wartung_laden($this->db());
    }

    /** Wartungsmodus ein/aus: solange er an ist, kommen nur Admins in die App */
    public function wartungSetzen(mixed $an = false, mixed $text = ''): array
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        $an = $an === true;
        $text = kuerze(tr($text), 500);
        upsert($db, 'einstellungen', ['schluessel' => 'wartung', 'wert' => json_text(
            ['an' => $an, 'text' => $text, 'seit' => $an ? jetzt() : null, 'von' => $an ? anzeigename($admin) : ''])], ['schluessel']);
        $this->log('warnung', 'einstellungen', $an ? 'Wartungsmodus eingeschaltet' : 'Wartungsmodus ausgeschaltet');
        return wartung_laden($db);
    }

    /**
     * Anmelden; mit Zwei-Faktor zuerst ohne Code: Antwort ['code_noetig' => true], dann noch einmal mit Code
     * (6 Ziffern aus der App oder ein Ersatz-Code).
     */
    public function anmelden(mixed $email = null, mixed $passwort = null, mixed $code = null): array
    {
        $db = $this->db();
        $z = zeile($db, 'select * from nutzer where email = ?', [strtolower(tr($email))]);
        // auch bei unbekannter E-Mail rechnen, damit man Konten nicht an der Antwortzeit erkennt
        $ok = passwort_passt($z['passwort'] ?? null, s($passwort));
        if (!$z || !$ok) $this->log('warnung', 'anmeldung', 'Anmeldung fehlgeschlagen für ' . kuerze(strtolower(tr($email)), 200), $z ? nutzer_aus_zeile($z) : null);
        pruefe($z && $ok, 'E-Mail oder Passwort ist falsch.', 401);
        if (!$z['aktiv']) $this->log('warnung', 'anmeldung', 'Anmeldeversuch mit deaktiviertem Konto', nutzer_aus_zeile($z));
        pruefe($z['aktiv'], 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.', 403);
        $wartung = wartung_laden($db);
        if ($wartung['an'] && !ist_admin(nutzer_aus_zeile($z))) throw new Fehler($wartung['text'], 503);
        if (!empty($z['zwei_faktor'])) {
            if (leer($code)) return ['code_noetig' => true];
            if (!zwei_faktor_code_ok($db, $z, s($code))) {
                $this->log('warnung', 'anmeldung', 'Falscher Zwei-Faktor-Code', nutzer_aus_zeile($z));
                throw new Fehler('Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.', 401);
            }
        }
        $this->log('info', 'anmeldung', !empty($z['zwei_faktor']) ? 'Angemeldet (mit Zwei-Faktor)' : 'Angemeldet', nutzer_aus_zeile($z));
        if ($this->ctx->token) sitzung_beenden($db, $this->ctx->token);
        $this->ctx->neueSitzung = sitzung_erstellen($db, $z['id']);
        q($db, 'update nutzer set letzter_login = ? where id = ?', [jetzt(), $z['id']]);
        return nutzer_laden($db, $z['id']);
    }

    public function abmelden(): mixed
    {
        sitzung_beenden($this->db(), $this->ctx->token);
        $this->ctx->sitzungLoeschen = true;
        return null;
    }

    // ---------------------------------------------------------------- Zugang anfragen (ohne Anmeldung)
    public function zugangAnfragen(mixed $daten = []): bool
    {
        $db = $this->db();
        $d = is_array($daten) ? $daten : [];
        $email = strtolower(tr($d['email'] ?? ''));
        pruefe(!leer($d['vorname'] ?? '') && !leer($d['nachname'] ?? ''), 'Bitte Vor- und Nachnamen angeben.');
        pruefe(ist_email($email) && strlen($email) <= 200, 'Bitte eine gültige E-Mail-Adresse angeben.');
        pruefe(($d['zustimmung'] ?? null) === true, ZUSTIMMUNG_FEHLT);
        // bewusst dieselbe Antwort, ob ein Konto existiert oder nicht (kein Ausforschen von Konten)
        $vorhanden = wert($db, 'select 1 from nutzer where email = ?', [$email])
            || wert($db, "select 1 from anfragen where email = ? and status = 'offen'", [$email]);
        $offen = (int) wert($db, "select count(*) from anfragen where status = 'offen'");
        pruefe($offen < 500, 'Derzeit können keine Anfragen angenommen werden. Bitte später erneut versuchen.', 503);
        if (!$vorhanden) {
            $a = [
                'vorname' => kuerze(tr($d['vorname']), 100), 'nachname' => kuerze(tr($d['nachname']), 100), 'email' => $email,
                'nachricht' => kuerze(tr($d['nachricht'] ?? ''), 1000),
            ];
            q($db, 'insert into anfragen (id, vorname, nachname, email, nachricht, am, zustimmung_am) values (?, ?, ?, ?, ?, ?, ?)',
                [neue_id(), $a['vorname'], $a['nachname'], $email, $a['nachricht'], jetzt(), jetzt()]);
            benachrichtigen($db, 'anfrage', mail_anfrage_admin($db, $a));
            $this->log('info', 'konten', "Zugang angefragt: {$a['vorname']} {$a['nachname']} ($email)", ['vorname' => $a['vorname'], 'nachname' => $a['nachname']]);
        }
        return true;
    }

    public function erstesPasswortSetzen(mixed $neu = null): bool
    {
        $db = $this->db();
        $this->ctx->erlaubtMitStartpasswort = true;
        $n = ich($this->ctx);
        pruefe($n['muss_passwort_aendern'], 'Bitte das Passwort im Profil ändern.');
        pruefe(mb_strlen(s($neu)) >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
        $alt = wert($db, 'select passwort from nutzer where id = ?', [$n['id']]);
        pruefe(!password_verify(s($neu), $alt), 'Bitte ein neues Passwort wählen, nicht das Startpasswort.');
        q($db, 'update nutzer set passwort = ?, muss_passwort_aendern = 0 where id = ?', [passwort_hash(s($neu)), $n['id']]);
        alle_sitzungen_beenden($db, $n['id'], $this->ctx->token);
        anmeldelinks_widerrufen($db, $n['id']); // ab jetzt gilt das eigene Passwort
        $this->log('info', 'konten', 'Eigenes Passwort festgelegt (erstes Anmelden)');
        return true;
    }

    public function passwortAendern(mixed $alt = null, mixed $neu = null): bool
    {
        $db = $this->db();
        $n = ich($this->ctx);
        pruefe(password_verify(s($alt), wert($db, 'select passwort from nutzer where id = ?', [$n['id']])), 'Das bisherige Passwort stimmt nicht.');
        pruefe(mb_strlen(s($neu)) >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
        q($db, 'update nutzer set passwort = ?, muss_passwort_aendern = 0 where id = ?', [passwort_hash(s($neu)), $n['id']]);
        alle_sitzungen_beenden($db, $n['id'], $this->ctx->token);
        $this->log('info', 'konten', 'Passwort geändert');
        return true;
    }

    // ---------------------------------------------------------------- Profil
    public function profilSpeichern(mixed $daten = []): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        $d = is_array($daten) ? $daten : [];
        $email = strtolower(tr($d['email'] ?? ''));
        pruefe(!leer($d['vorname'] ?? '') && !leer($d['nachname'] ?? ''), 'Bitte Vor- und Nachnamen angeben.');
        pruefe(ist_email($email), 'Bitte eine gültige E-Mail-Adresse angeben.');
        pruefe(!wert($db, 'select 1 from nutzer where email = ? and id <> ?', [$email, $n['id']]), 'Diese E-Mail-Adresse wird schon verwendet.');
        if (!leer($d['iban'] ?? '')) pruefe(iban_fehler($d['iban']) === null, (string) iban_fehler($d['iban']));
        pruefe(bic_gueltig($d['bic'] ?? ''), 'Der BIC ist ungültig.');
        // Profil-Links auf campus-a-college.at und campus-a.at; ohne Angabe bleibt eine bestehende Verknüpfung erhalten
        $links = [];
        foreach (MEDIUM_KEYS as $m) {
            $feld = PROFIL_FELD[$m];
            $links[$feld] = array_key_exists($feld, $d) ? profil_id_aus_link($d[$feld], $m) : $n['profil'][$feld];
            pruefe($links[$feld] !== null, profil_link_fehler($m));
        }
        q($db, 'update nutzer set vorname = ?, nachname = ?, email = ?, strasse = ?, plz_ort = ?,
                kontoinhaber = ?, iban = ?, bic = ?, campus_profil = ?, campus_a_profil = ? where id = ?', [
            kuerze(tr($d['vorname']), 100), kuerze(tr($d['nachname']), 100), $email, kuerze(tr($d['strasse'] ?? ''), 150),
            kuerze(tr($d['plz_ort'] ?? ''), 100), kuerze(tr($d['kontoinhaber'] ?? ''), 70), iban_normalisieren($d['iban'] ?? ''),
            bic_normalisieren($d['bic'] ?? ''), $links['campus_profil'], $links['campus_a_profil'], $n['id'],
        ]);
        if ($email !== $n['email']) {
            email_geaendert_melden($db, $n['vorname'], $n['email'], $email);
            $this->log('info', 'konten', "Eigene E-Mail-Adresse geändert: {$n['email']} → $email");
        }
        if (iban_normalisieren($d['iban'] ?? '') !== ($n['profil']['iban'] ?? '') && ($n['profil']['iban'] ?? '') !== '') {
            $this->log('info', 'konten', 'Bankverbindung geändert');
        }
        return nutzer_laden($db, $n['id']);
    }

    /** Angaben für Impressum, Datenschutzerklärung und den Hinweis zum Betreiber – auch ohne Anmeldung */
    public function rechtliches(): array
    {
        $e = einstellungen_laden($this->db());
        return ['betreiber' => $e['betreiber'], 'empfaenger' => $e['empfaenger'], 'datenschutzKontakt' => $e['datenschutzKontakt']];
    }

    /** Hinweis zum Betreiber zur Kenntnis genommen (auch beim ersten Anmelden mit dem Startpasswort) */
    public function hinweisBestaetigen(): array
    {
        $this->ctx->erlaubtMitStartpasswort = true;
        $n = ich($this->ctx);
        q($this->db(), 'update nutzer set hinweis_bestaetigt_am = ? where id = ?', [jetzt(), $n['id']]);
        return nutzer_laden($this->db(), $n['id']);
    }

    /** Welche E-Mails dieses Konto bekommen will (nur die für die eigenen Rollen) */
    public function benachrichtigungenSpeichern(mixed $wahl = []): array
    {
        $n = ich($this->ctx);
        $neu = benachrichtigungen_normalisieren(['benachrichtigungen' => (array) $n['benachrichtigungen']] + $n, $wahl);
        q($this->db(), 'update nutzer set benachrichtigungen = ? where id = ?', [json_text((object) $neu), $n['id']]);
        return nutzer_laden($this->db(), $n['id']);
    }

    public function einstellungen(): array
    {
        ich($this->ctx);
        return einstellungen_laden($this->db());
    }

    // ---------------------------------------------------------------- Leistungen (Entwürfe)
    public function meineLeistungen(): array
    {
        $n = brauche($this->ctx, 'autor');
        return nachweise_anhaengen($this->db(), array_map(
            fn ($p) => position_aus_zeile($p + ['betrag_eingereicht_cent' => $p['betrag_cent'], 'betrag_vermerk' => '']),
            zeilen($this->db(), 'select * from positionen where autor_id = ? order by veroeffentlichung, erstellt_am', [$n['id']]),
        ));
    }

    /** Liefert die Id der Leistung (für Nachweise zu einer neuen Leistung) */
    public function leistungSpeichern(mixed $daten = []): string
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        $d = is_array($daten) ? $daten : [];
        $kat = $d['kategorie'] ?? null;
        $istKolumne = $kat === 'kolumne';
        // Redigieren (nur campus a college): Anzahl der Texte × Satz pro Text
        $istRedigieren = $kat === 'redigieren';
        $anzahl = $istRedigieren ? zahl($d['anzahl'] ?? null) : 0.0;
        $p = [
            'kategorie' => $kat,
            'art' => $kat === 'ausserordentlich' ? art_normalisieren($d['art'] ?? '') : '',
            'kolumnenart' => $istKolumne ? art_normalisieren($d['kolumnenart'] ?? '') : '',
            'titel' => kuerze(tr($d['titel'] ?? '') ?: ($istRedigieren && $anzahl !== null ? 'Redigieren (' . text_anzahl($anzahl) . ')' : ''), 200),
            'artikel_url' => $istRedigieren ? '' : tr($d['artikel_url'] ?? ''),
            // ohne Angabe: das (erste) Medium mit Profil-Link
            'medium' => $istRedigieren ? 'college' : ($d['medium'] ?? (verbundene_medien($n['profil'])[0] ?? 'college')),
            'veroeffentlichung' => s($d['veroeffentlichung'] ?? ''),
            'ausgabe' => kuerze(tr($d['ausgabe'] ?? ''), 100),
            'vereinbart_mit' => $kat === 'ausserordentlich' ? kuerze(tr($d['vereinbart_mit'] ?? ''), 100) : '',
            'notiz' => kuerze(tr($d['notiz'] ?? ''), 1000),
        ];
        pruefe(in_array($kat, ['kolumne', 'ausserordentlich', 'redigieren'], true), 'Bitte wählen, ob Kolumne oder außerordentliche Anerkennungsprämie.');
        if ($istRedigieren) {
            pruefe(darf_redigieren($n), 'Redigieren ist für dein Konto nicht freigeschaltet. Bitte wende dich an den Admin.', 403);
            pruefe($anzahl !== null && floor($anzahl) === $anzahl && $anzahl >= 1 && $anzahl <= 1000, 'Bitte die Anzahl der redigierten Texte angeben (1 bis 1000).');
        }
        $anzahl = (int) $anzahl;
        pruefe(!leer($p['titel']), 'Bitte den Titel des Beitrags angeben.');
        if ($kat === 'ausserordentlich') pruefe(!leer($p['art']), 'Bitte die Art der Anerkennungsprämie angeben.');
        pruefe(ist_medium($p['medium']), 'Bitte wählen, ob für campus a college oder campus a.');
        // nur Medien mit Profil-Link (Redigieren: Rolle vom Admin, immer campus a college); eine ältere Leistung darf ihr Medium behalten
        $id = isset($d['id']) && $d['id'] !== '' && $d['id'] !== null ? s($d['id']) : null;
        $bisher = $id ? wert($db, 'select medium from positionen where id = ? and autor_id = ?', [$id, $n['id']]) : false;
        pruefe($istRedigieren || in_array($p['medium'], verbundene_medien($n['profil']), true) || $bisher === $p['medium'], nicht_verbunden($p['medium']));
        if ($p['artikel_url'] !== '') {
            pruefe(medium_von_artikel($p['artikel_url']) === $p['medium'],
                'Der Link zum Artikel ist ungültig (erwartet: ein Artikel auf ' . MEDIEN[$p['medium']]['seite'] . ').');
            pruefe(!isset(verwendete_artikel($db, $n['id'], $id)[$p['artikel_url']]), ARTIKEL_DOPPELT);
        }
        pruefe(ist_datum($p['veroeffentlichung']), 'Bitte das Datum der Veröffentlichung angeben.');
        if ($kat === 'ausserordentlich') pruefe(!leer($p['vereinbart_mit']), 'Bitte angeben, mit wem aus der Redaktion die Anerkennungsprämie vereinbart wurde.');
        // Redigieren: Betrag rechnet der Server aus (Anzahl × eingestellter Satz pro Text)
        $betragCent = $istRedigieren ? $anzahl * cent(einstellungen_laden($db)['honorarsaetze']['college']['redigieren']) : cent($d['betrag'] ?? null);
        $werte = [$kat, $p['art'], $p['kolumnenart'], $p['titel'], $p['veroeffentlichung'], $p['ausgabe'], $p['vereinbart_mit'], $p['notiz'],
            $betragCent, $p['artikel_url'], $p['medium'], $anzahl];
        if ($id) {
            $r = q($db, 'update positionen set kategorie = ?, art = ?, kolumnenart = ?, titel = ?, veroeffentlichung = ?, ausgabe = ?,
                    vereinbart_mit = ?, notiz = ?, betrag_cent = ?, artikel_url = ?, medium = ?, anzahl = ?, geaendert_am = ? where id = ? and autor_id = ?',
                [...$werte, jetzt(), $id, $n['id']]);
            pruefe($r->rowCount() === 1, 'Diese Leistung gibt es nicht (mehr).', 404);
            // nicht mehr Redigieren: Nachweise gehören nicht mehr dazu
            if (!$istRedigieren) q($db, 'delete from nachweise where position_id = ?', [$id]);
            return $id;
        }
        pruefe((int) wert($db, 'select count(*) from positionen where autor_id = ?', [$n['id']]) < 500, 'Zu viele gespeicherte Leistungen.');
        $id = neue_id();
        q($db, 'insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe, vereinbart_mit,
                notiz, betrag_cent, artikel_url, medium, anzahl, erstellt_am) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $n['id'], ...$werte, jetzt()]);
        return $id;
    }

    public function leistungLoeschen(mixed $pid = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        $r = q($db, 'delete from positionen where id = ? and autor_id = ?', [s($pid), $n['id']]);
        pruefe($r->rowCount() === 1, 'Diese Leistung gibt es nicht (mehr).', 404);
        q($db, 'delete from nachweise where position_id = ?', [s($pid)]);
        return true;
    }

    // ---------------------------------------------------------------- Nachweise zum Redigieren
    /** Datei an eine gespeicherte (noch nicht abgeschickte) Leistung „Redigieren“ hängen; $inhalt als base64 */
    public function nachweisHochladen(mixed $positionId = null, mixed $name = null, mixed $inhalt = null): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        $p = zeile($db, 'select id, kategorie from positionen where id = ? and autor_id = ?', [s($positionId), $n['id']]);
        pruefe($p, 'Diese Leistung gibt es nicht (mehr) oder sie ist schon abgeschickt.', 404);
        pruefe($p['kategorie'] === 'redigieren', 'Nachweise gibt es nur beim Redigieren.');
        $name = nachweis_name($name);
        pruefe($name !== null, 'Diese Datei geht nicht. Erlaubt sind PDF, Word (doc, docx), odt, rtf, txt, Excel (xls, xlsx), ods, png und jpg.');
        $daten = base64_decode(s($inhalt), true);
        pruefe($daten !== false && $daten !== '', 'Die Datei ist leer oder beschädigt.');
        pruefe(strlen($daten) <= NACHWEIS_MAX_BYTES, 'Die Datei ist zu groß (höchstens 5 MB).', 413);
        pruefe((int) wert($db, 'select count(*) from nachweise where position_id = ?', [$p['id']]) < NACHWEISE_PRO_LEISTUNG,
            'Höchstens ' . NACHWEISE_PRO_LEISTUNG . ' Nachweise pro Leistung.');
        $id = neue_id();
        q($db, 'insert into nachweise (id, position_id, autor_id, name, typ, groesse, inhalt, erstellt_am) values (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $p['id'], $n['id'], $name, NACHWEIS_TYPEN[strtolower(pathinfo($name, PATHINFO_EXTENSION))], strlen($daten), base64_encode($daten), jetzt()]);
        return ['id' => $id, 'name' => $name, 'groesse' => strlen($daten)];
    }

    /** Nachweis entfernen – nur solange die Leistung noch nicht abgeschickt ist */
    public function nachweisLoeschen(mixed $id = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        $r = q($db, 'delete from nachweise where id = ? and autor_id = ? and position_id in (select id from positionen where autor_id = ?)',
            [s($id), $n['id'], $n['id']]);
        pruefe($r->rowCount() === 1, 'Diesen Nachweis gibt es nicht (mehr) oder die Leistung ist schon abgeschickt.', 404);
        return true;
    }

    /** Nachweis herunterladen: die Autor:in selbst, sonst wer die Abrechnung sehen darf (Redaktion, Buchhaltung, Admin) */
    public function nachweisLaden(mixed $id = null): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        $z = zeile($db, 'select * from nachweise where id = ?', [s($id)]);
        pruefe($z, 'Diesen Nachweis gibt es nicht (mehr).', 404);
        if ($z['autor_id'] !== $n['id']) {
            $noteId = wert($db, 'select note_id from note_positionen where id = ?', [$z['position_id']]);
            pruefe($noteId && darf_sehen($n, note_holen($db, $noteId)), 'Dafür fehlt dir die Berechtigung.', 403);
        }
        return ['name' => $z['name'], 'typ' => $z['typ'], 'inhalt' => $z['inhalt']];
    }

    /** Alle Artikel der Autor:in auf beiden Seiten (je nach Profilen), neueste zuerst, mit Vermerk „schon erfasst“ */
    public function meineArtikel(mixed $optionen = []): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        $neu = is_array($optionen) && !empty($optionen['neu']);
        $medien = verbundene_medien($n['profil']);
        if (!$medien) return ['verknuepft' => false, 'artikel' => []];
        $alle = [];
        $nichtErreichbar = [];
        foreach ($medien as $m) {
            try {
                $alle = [...$alle, ...artikel_von_profil($db, $n['profil'][PROFIL_FELD[$m]], $m, $this->ctx->holen, $neu)];
            } catch (Throwable $e) {
                $nichtErreichbar[] = MEDIEN[$m]['seite'];
            }
        }
        pruefe(count($nichtErreichbar) < count($medien),
            implode(' und ', $nichtErreichbar) . (count($nichtErreichbar) > 1 ? ' sind' : ' ist') . ' gerade nicht erreichbar. Bitte später erneut versuchen.', 502);
        $verwendet = verwendete_artikel($db, $n['id']);
        usort($alle, fn ($x, $y) => strcmp($y['datum'], $x['datum']));
        return [
            'verknuepft' => true,
            'medien' => $medien,
            'warnung' => $nichtErreichbar ? implode(' und ', $nichtErreichbar) . ' ist gerade nicht erreichbar, diese Artikel fehlen.' : '',
            'artikel' => array_map(fn ($a) => $a + ['erfasst' => isset($verwendet[$a['url']])], $alle),
        ];
    }

    public function naechsteNummer(): array
    {
        return naechste_nummer($this->db(), brauche($this->ctx, 'autor'));
    }

    /** Nummer der zuletzt geschriebenen Prämienabrechnung dieses Jahres (z. B. vor der App) – ab da wird weitergezählt */
    public function nummerFestlegen(mixed $letzte = null): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        $letzte = filter_var($letzte, FILTER_VALIDATE_INT);
        pruefe($letzte !== false && $letzte >= 0 && $letzte <= 999, 'Bitte eine Zahl zwischen 0 und 999 eingeben.');
        $jahr = (int) substr(heute_iso(), 0, 4);
        $inApp = (int) wert($db, 'select coalesce(max(laufende_nummer), 0) from noten where autor_id = ? and jahr = ?', [$n['id'], $jahr]);
        pruefe($letzte >= $inApp, "Du hast $jahr in der App schon die Nummer $inApp eingereicht – kleiner geht nicht, sonst gäbe es Nummern doppelt.");
        q($db, 'update nutzer set nummer_basis = ? where id = ?', [$letzte ? "$jahr:$letzte" : null, $n['id']]);
        protokoll($db, 'info', 'konto', "Nummerierung: letzte Prämienabrechnung $jahr ist Nr. $letzte", $n);
        return naechste_nummer($db, nutzer_laden($db, $n['id']), $jahr);
    }

    public function notenDiesenMonat(): array
    {
        $n = brauche($this->ctx, 'autor');
        return noten_liste($this->db(), $n, 'where autor_id = ? and monat = ?', [$n['id'], substr(heute_iso(), 0, 7)]);
    }

    public function abrechnungAbschicken(mixed $positionIds = null): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        pruefe(is_array($positionIds) && $positionIds && count($positionIds) <= 200, 'Bitte mindestens eine Leistung auswählen.');
        $ids = array_map('s', array_values($positionIds));
        return transaktion($db, function () use ($db, $n, $ids) {
            $platz = implode(',', array_fill(0, count($ids), '?'));
            $positionen = zeilen($db, "select * from positionen where autor_id = ? and id in ($platz) order by veroeffentlichung, erstellt_am", [$n['id'], ...$ids]);
            pruefe(count($positionen) === count(array_unique($ids)) && count($ids) === count(array_unique($ids)), 'Einige Leistungen gibt es nicht mehr. Bitte Seite neu laden.');
            // campus a und campus a college bekommen getrennte Prämienabrechnungen
            $medium = medium_oder($positionen[0]['medium']);
            foreach ($positionen as $p) pruefe(medium_oder($p['medium']) === $medium, 'Leistungen für campus a und campus a college bitte getrennt abschicken.');
            $nr = naechste_nummer($db, $n);
            $e = einstellungen_laden($db);
            $noteId = neue_id();
            q($db, "insert into noten (id, nummer, jahr, laufende_nummer, monat, medium, autor_id, status, eingereicht_am,
                    autor_json, zahlung_json, empfaenger_json) values (?, ?, ?, ?, ?, ?, ?, 'eingereicht', ?, ?, ?, ?)", [
                $noteId, $nr['nummer'], $nr['jahr'], $nr['laufendeNummer'], substr(heute_iso(), 0, 7), $medium, $n['id'], jetzt(),
                json_text(['vorname' => $n['vorname'], 'nachname' => $n['nachname'], 'email' => $n['email'], 'strasse' => $n['profil']['strasse'], 'plz_ort' => $n['profil']['plz_ort']]),
                json_text(['kontoinhaber' => $n['profil']['kontoinhaber'], 'iban' => $n['profil']['iban'], 'bic' => $n['profil']['bic']]),
                json_text($e['empfaenger']),
            ]);
            $einf = $db->prepare('insert into note_positionen (id, note_id, reihenfolge, kategorie, art, kolumnenart, titel, veroeffentlichung,
                    ausgabe, vereinbart_mit, notiz, betrag_cent, betrag_eingereicht_cent, artikel_url, medium, anzahl)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            foreach ($positionen as $i => $p) {
                $einf->execute([$p['id'], $noteId, $i, $p['kategorie'], $p['art'], $p['kolumnenart'], $p['titel'], $p['veroeffentlichung'], $p['ausgabe'],
                    $p['vereinbart_mit'], $p['notiz'], $p['betrag_cent'], $p['betrag_cent'], $p['artikel_url'], $medium, (int) ($p['anzahl'] ?? 0)]);
            }
            q($db, "delete from positionen where autor_id = ? and id in ($platz)", [$n['id'], ...$ids]);
            $summe = array_sum(array_column($positionen, 'betrag_cent'));
            verlauf_eintragen($db, $noteId, $n, 'eingereicht', ['betrag' => euro((int) $summe), 'positionen' => count($positionen), 'medium' => medium_name($medium)]);
            $this->log('info', 'abrechnungen', "Eingereicht: {$nr['nummer']} (" . eur(euro((int) $summe)) . ')');
            $note = note_holen($db, $noteId);
            benachrichtigen($db, 'neue_note', mail_eingereicht_redaktion($db, $note), $n['id']);
            autor_benachrichtigen($db, $note, 'eingang', mail_eingereicht_autor($db, $note));
            return sicht($n, $note);
        });
    }

    public function meineNoten(): array
    {
        $n = brauche($this->ctx, 'autor');
        return noten_liste($this->db(), $n, 'where autor_id = ?', [$n['id']]);
    }

    /** Ältere abgelehnte Noten (vor der automatischen Rückgabe): Leistungen selbst zurückholen */
    public function leistungenZurueckholen(mixed $noteId = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        return transaktion($db, function () use ($db, $n, $noteId) {
            $note = note_holen($db, $noteId);
            pruefe($note['autor_id'] === $n['id'], 'Dafür fehlt dir die Berechtigung.', 403);
            pruefe($note['status'] === 'abgelehnt', 'Nur abgelehnte Prämienabrechnungen können überarbeitet werden.');
            pruefe(!$note['zurueckgeholt_am'], 'Die Leistungen wurden bereits zurückgeholt.');
            zurueck_an_autor($db, $note, $n);
            return true;
        });
    }

    /**
     * Abgeschickte Prämienabrechnung zurückziehen, solange die Redaktion sie noch nicht angenommen hat: die Leistungen
     * kommen zurück zu den gespeicherten Leistungen, die Abrechnung verschwindet (Vermerk im Löschprotokoll).
     */
    public function abrechnungZurueckziehen(mixed $noteId = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'autor');
        return transaktion($db, function () use ($db, $n, $noteId) {
            $note = note_holen($db, $noteId);
            pruefe($note['autor_id'] === $n['id'], 'Dafür fehlt dir die Berechtigung.', 403);
            pruefe($note['status'] === 'eingereicht', 'Diese Prämienabrechnung wurde schon geprüft und kann nicht mehr zurückgezogen werden. Bitte schreib der Redaktion.');
            zurueck_an_autor($db, ['ablehnungsgrund' => ''] + $note, $n);
            q($db, 'delete from noten where id = ?', [$note['id']]);
            nachweise_aufraeumen($db);
            q($db, 'insert into loeschprotokoll (id, nummer, geloescht_von, am) values (?, ?, ?, ?)',
                [neue_id(), $note['nummer'], anzeigename($n) . ' (zurückgezogen)', jetzt()]);
            $this->log('info', 'abrechnungen', "Zurückgezogen: {$note['nummer']}");
            return true;
        });
    }

    // ---------------------------------------------------------------- Redaktion
    public function alleNoten(): array
    {
        return noten_liste($this->db(), brauche($this->ctx, 'redaktion'));
    }

    /**
     * Liste für Redaktion und Admin: am Server gefiltert und seitenweise (auch bei vielen tausend Abrechnungen schnell).
     * $filter: status, medium, monat, suche, sortierung, limit (bis 200), offset
     */
    public function redaktionListe(mixed $filter = []): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        $f = is_array($filter) ? $filter : [];
        $wo = [];
        $p = [];
        if (isset(STATUS_LABEL[$f['status'] ?? ''])) { $wo[] = 'status = ?'; $p[] = $f['status']; }
        if (ist_medium($f['medium'] ?? '')) { $wo[] = 'medium = ?'; $p[] = $f['medium']; }
        if (preg_match('/^\d{4}-\d{2}$/', s($f['monat'] ?? ''))) { $wo[] = 'monat = ?'; $p[] = $f['monat']; }
        if (!empty($f['rueckfrage'])) $wo[] = 'rueckfrage is not null';
        $suche = mb_strtolower(kuerze(tr($f['suche'] ?? ''), 100));
        if ($suche !== '') {
            $wo[] = '(lower(nummer) like ? or lower(autor_json) like ?)';
            array_push($p, "%$suche%", "%$suche%");
        }
        $where = $wo ? 'where ' . implode(' and ', $wo) : '';
        $limit = max(1, min(200, (int) ($f['limit'] ?? 100)));
        $offset = max(0, (int) ($f['offset'] ?? 0));
        // Zähler je Status für das gewählte Medium, dazu „zu prüfen“ je Medium für den Umschalter
        $medium = ist_medium($f['medium'] ?? '') ? $f['medium'] : null;
        $zaehler = array_fill_keys(array_keys(STATUS_LABEL), 0);
        foreach (zeilen($db, 'select status, count(*) anzahl from noten' . ($medium ? ' where medium = ?' : '') . ' group by status', $medium ? [$medium] : []) as $z) {
            $zaehler[$z['status']] = (int) $z['anzahl'];
        }
        $zuPruefen = array_fill_keys(MEDIUM_KEYS, 0);
        foreach (zeilen($db, "select medium, count(*) anzahl from noten where status = 'eingereicht' group by medium") as $z) {
            $zuPruefen[medium_oder($z['medium'])] += (int) $z['anzahl'];
        }
        return [
            'noten' => noten_liste($db, $n, $where, $p, REDAKTION_SORTIERUNG[$f['sortierung'] ?? ''] ?? 'eingereicht_am asc', "limit $limit offset $offset"),
            'anzahl' => (int) wert($db, "select count(*) from noten $where", $p),
            'summe' => euro((int) wert($db, "select coalesce(sum(np.betrag_cent), 0) from note_positionen np where np.note_id in (select id from noten $where)", $p)),
            'zaehler' => $zaehler,
            'zu_pruefen_medium' => $zuPruefen,
            'rueckfragen' => [
                'offen' => (int) wert($db, "select count(*) from noten where rueckfrage = 'offen'" . ($medium ? ' and medium = ?' : ''), $medium ? [$medium] : []),
                'beantwortet' => (int) wert($db, "select count(*) from noten where rueckfrage = 'beantwortet'" . ($medium ? ' and medium = ?' : ''), $medium ? [$medium] : []),
            ],
            'monate' => array_column(zeilen($db, 'select distinct monat from noten order by monat desc limit 36'), 'monat'),
        ];
    }

    /** Zusatzinfos für die Prüfansicht: Jahressumme der Person, Artikel, die schon anderswo abgerechnet sind */
    public function pruefInfo(mixed $noteId = null): array
    {
        $db = $this->db();
        brauche($this->ctx, 'redaktion');
        $x = note_holen($db, $noteId);
        $jahr = substr($x['monat'], 0, 4);
        $imJahr = $x['autor_id'] ? zeile($db, "select count(*) anzahl, coalesce(sum((select sum(betrag_cent) from note_positionen np where np.note_id = n.id)), 0) summe
            from noten n where n.autor_id = ? and n.monat like ? and n.status <> 'abgelehnt'", [$x['autor_id'], "$jahr-%"]) : null;
        $urls = array_values(array_unique(array_filter(array_column($x['positionen'], 'artikel_url'))));
        $doppelt = [];
        if ($urls) {
            $platz = implode(',', array_fill(0, count($urls), '?'));
            foreach (zeilen($db, "select np.artikel_url, n.nummer from note_positionen np join noten n on n.id = np.note_id
                    where np.artikel_url in ($platz) and n.id <> ? and n.status <> 'abgelehnt'", [...$urls, $x['id']]) as $z) {
                $doppelt[$z['artikel_url']] ??= $z['nummer'];
            }
        }
        return [
            'jahr' => $jahr, 'jahr_anzahl' => (int) ($imJahr['anzahl'] ?? 0), 'jahr_summe' => euro((int) ($imJahr['summe'] ?? 0)),
            'doppelt' => (object) $doppelt,
        ];
    }

    public function note(mixed $noteId = null): array
    {
        $n = ich($this->ctx);
        $note = note_holen($this->db(), $noteId);
        pruefe(darf_sehen($n, $note), 'Dafür fehlt dir die Berechtigung.', 403);
        return sicht($n, $note);
    }

    public function annehmen(mixed $noteId = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        return transaktion($db, function () use ($db, $n, $noteId) {
            $x = note_holen($db, $noteId);
            pruefe(in_array($x['status'], ['eingereicht', 'abgelehnt'], true), 'Diese Prämienabrechnung kann nicht angenommen werden.');
            pruefe(!$x['zurueckgeholt_am'], 'Die Autor:in überarbeitet diese Leistungen bereits in einer neuen Prämienabrechnung.');
            q($db, "update noten set status = 'angenommen', ablehnungsgrund = '', entschieden_am = ?, rueckfrage = null where id = ?", [jetzt(), $x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'angenommen', ['vorher' => $x['status']]);
            $this->log('info', 'abrechnungen', "Angenommen: {$x['nummer']}");
            $note = note_holen($db, $x['id']);
            autor_benachrichtigen($db, $note, 'angenommen', mail_angenommen_autor($db, $note));
            benachrichtigen($db, 'zur_zahlung', mail_angenommen_buchhaltung($db, $note));
            return true;
        });
    }

    public function ablehnen(mixed $noteId = null, mixed $grund = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        pruefe(!leer($grund), 'Bitte eine Begründung für die Ablehnung angeben.');
        $g = kuerze(tr($grund), 1000);
        return transaktion($db, function () use ($db, $n, $noteId, $g) {
            $x = note_holen($db, $noteId);
            pruefe(in_array($x['status'], ['eingereicht', 'angenommen'], true), 'Diese Prämienabrechnung kann nicht abgelehnt werden.');
            q($db, "update noten set status = 'abgelehnt', ablehnungsgrund = ?, entschieden_am = ?, rueckfrage = null where id = ?", [$g, jetzt(), $x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'abgelehnt', ['vorher' => $x['status'], 'grund' => $g]);
            $this->log('info', 'abrechnungen', "Zurückgegeben: {$x['nummer']} ($g)");
            // die Leistungen gehen sofort zurück an die Autor:in zum Überarbeiten
            zurueck_an_autor($db, ['ablehnungsgrund' => $g] + $x, $n);
            autor_benachrichtigen($db, $x, 'abgelehnt', mail_abgelehnt_autor($db, $x, $g));
            return true;
        });
    }

    public function betragKorrigieren(mixed $noteId = null, mixed $positionId = null, mixed $betrag = null, mixed $vermerk = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        pruefe(!leer($vermerk), 'Ein Vermerk zur Betragskorrektur ist Pflicht.');
        $neuCent = cent($betrag);
        $v = kuerze(tr($vermerk), 500);
        return transaktion($db, function () use ($db, $n, $noteId, $positionId, $neuCent, $v) {
            $x = note_holen($db, $noteId);
            pruefe($x['status'] !== 'bezahlt', 'Bezahlte Prämienabrechnungen können nicht mehr geändert werden.');
            $p = null;
            foreach ($x['positionen'] as $y) if ($y['id'] === $positionId) $p = $y;
            pruefe($p, 'Diese Position gibt es nicht.', 404);
            pruefe(cent($p['betrag']) !== $neuCent, 'Der Betrag ist unverändert.');
            q($db, 'update note_positionen set betrag_cent = ?, betrag_vermerk = ? where note_id = ? and id = ?', [$neuCent, $v, $x['id'], $p['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'betrag_korrigiert', ['position' => $p['titel'], 'alt' => $p['betrag'], 'neu' => euro($neuCent), 'vermerk' => $v]);
            $this->log('info', 'abrechnungen', "Betrag geändert in {$x['nummer']}: " . eur($p['betrag']) . ' → ' . eur(euro($neuCent)));
            return true;
        });
    }

    /** Haken „geprüft“ der Redaktion an einer Leistung setzen oder entfernen */
    public function positionPruefen(mixed $noteId = null, mixed $positionId = null, mixed $geprueft = true): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        $x = note_holen($db, $noteId);
        pruefe($x['status'] !== 'bezahlt', 'Bezahlte Prämienabrechnungen können nicht mehr geändert werden.');
        $r = q($db, 'update note_positionen set geprueft_von = ?, geprueft_am = ? where note_id = ? and id = ?',
            $geprueft === true ? [anzeigename($n), jetzt(), $x['id'], s($positionId)] : [null, null, $x['id'], s($positionId)]);
        pruefe($r->rowCount() === 1 || wert($db, 'select 1 from note_positionen where note_id = ? and id = ?', [$x['id'], s($positionId)]),
            'Diese Leistung gibt es nicht (mehr).', 404);
        return true;
    }

    public function kommentieren(mixed $noteId = null, mixed $text = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        pruefe(!leer($text), 'Der Kommentar ist leer.');
        $x = note_holen($db, $noteId);
        transaktion($db, function () use ($db, $n, $x, $text) {
            q($db, 'insert into kommentare (id, note_id, verfasser_id, verfasser_name, text, am) values (?, ?, ?, ?, ?, ?)',
                [neue_id(), $x['id'], $n['id'], anzeigename($n), kuerze(tr($text), 2000), jetzt()]);
            verlauf_eintragen($db, $x['id'], $n, 'kommentar');
        });
        return true;
    }

    // ---------------------------------------------------------------- Rückfragen (Chat Redaktion ↔ Autor:in)
    /** Nachrichten zu einer Abrechnung: für die Autor:in und alle, die die Abrechnung sehen dürfen */
    public function nachrichten(mixed $noteId = null): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        $x = note_holen($db, $noteId);
        pruefe(darf_sehen($n, $x), 'Dafür fehlt dir die Berechtigung.', 403);
        return array_map(fn ($z) => [
            'id' => $z['id'], 'von_name' => $z['von_name'], 'von_redaktion' => (bool) $z['von_redaktion'], 'text' => $z['text'],
            'am' => $z['am'], 'ich' => $z['von_id'] === $n['id'],
        ], zeilen($db, 'select * from nachrichten where note_id = ? order by am, id', [$x['id']]));
    }

    /** Redaktion fragt nach, statt gleich zurückzugeben; die Abrechnung bleibt, wie sie ist */
    public function nachfragen(mixed $noteId = null, mixed $text = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        $t = rueckfrage_text($text);
        return transaktion($db, function () use ($db, $n, $noteId, $t) {
            $x = note_holen($db, $noteId);
            pruefe(in_array($x['status'], ['eingereicht', 'angenommen'], true), 'Rückfragen gehen nur, solange die Abrechnung noch nicht bezahlt oder zurückgegeben ist.');
            nachricht_speichern($db, $x['id'], $n, true, $t);
            q($db, "update noten set rueckfrage = 'offen' where id = ?", [$x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'rueckfrage');
            autor_benachrichtigen($db, $x, 'rueckfrage', mail_rueckfrage_autor($db, $x, $t, anzeigename($n)));
            return true;
        });
    }

    /** Autor:in antwortet; die Redaktion, die gefragt hat, bekommt eine E-Mail */
    public function rueckfrageBeantworten(mixed $noteId = null, mixed $text = null): bool
    {
        $db = $this->db();
        $n = ich($this->ctx);
        $t = rueckfrage_text($text);
        return transaktion($db, function () use ($db, $n, $noteId, $t) {
            $x = note_holen($db, $noteId);
            pruefe($x['autor_id'] === $n['id'], 'Dafür fehlt dir die Berechtigung.', 403);
            pruefe(in_array($x['status'], ['eingereicht', 'angenommen'], true), 'Diese Abrechnung ist schon erledigt.');
            pruefe((int) wert($db, 'select count(*) from nachrichten where note_id = ?', [$x['id']]) > 0, 'Zu dieser Abrechnung gibt es keine Rückfrage.');
            nachricht_speichern($db, $x['id'], $n, false, $t);
            q($db, "update noten set rueckfrage = 'beantwortet' where id = ?", [$x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'antwort');
            $mail = mail_rueckfrage_antwort($db, $x, $t);
            foreach (zeilen($db, 'select distinct von_id from nachrichten where note_id = ? and von_redaktion = 1', [$x['id']]) as $z) {
                $r = $z['von_id'] ? nutzer_laden($db, $z['von_id']) : null;
                if ($r && $r['aktiv']) mail_einreihen($db, $r['email'], $mail);
            }
            return true;
        });
    }

    /** Redaktion: Rückfrage ist geklärt (ohne Annehmen oder Zurückgeben) */
    public function rueckfrageErledigt(mixed $noteId = null): bool
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'redaktion');
        $x = note_holen($db, $noteId);
        q($db, 'update noten set rueckfrage = null where id = ?', [$x['id']]);
        verlauf_eintragen($db, $x['id'], $n, 'rueckfrage_erledigt');
        return true;
    }

    // ---------------------------------------------------------------- Kommandozentrale (Admin → Server)
    public function serverStatus(): array
    {
        brauche($this->ctx, 'admin');
        return server_status($this->db(), function_exists('https') && https());
    }

    public function leistungstest(): array
    {
        brauche($this->ctx, 'admin');
        $r = leistungstest($this->db());
        $this->log('info', 'system', 'Leistungstest: ' . implode(', ', array_map(fn ($e) => $e['titel'] . ' ' . ($e['ms'] ?? '–') . ' ms', $r['ergebnisse'])));
        return $r;
    }

    /** Der ganze Ablauf mit Testkonten – wird danach vollständig zurückgenommen */
    public function funktionstest(): array
    {
        brauche($this->ctx, 'admin');
        $r = funktionstest($this->db());
        $fehler = array_values(array_filter($r['schritte'], fn ($s) => $s['stufe'] === 'fehler'));
        $this->log($r['ok'] ? 'info' : 'fehler', 'system', $r['ok'] ? 'Funktionstest: alles in Ordnung'
            : 'Funktionstest fehlgeschlagen bei „' . $fehler[0]['titel'] . '“: ' . $fehler[0]['text']);
        return $r;
    }

    /** Sicherung zurückspielen (vorher wird der jetzige Stand gesichert); danach müssen sich alle neu anmelden */
    public function sicherungZurueckspielen(mixed $name = null, mixed $bestaetigung = null): array
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        pruefe(s($bestaetigung) === 'WIEDERHERSTELLEN', 'Zur Bestätigung bitte WIEDERHERSTELLEN eintippen.');
        $datei = sicherung_pfad(s($name));
        pruefe($datei, 'Diese Sicherung gibt es nicht (mehr).', 404);
        pruefe(str_ends_with($datei, ist_mysql($db) ? '.sql' : '.sqlite'), 'Diese Sicherung passt nicht zur Datenbank (SQLite und MySQL lassen sich nicht mischen).');
        $vorher = sichern($db, daten_ordner() . '/backups/honorarnoten-' . date('Y-m-d-His') . '.sqlite');
        try {
            sicherung_einspielen($db, $datei);
        } catch (Throwable $e) {
            protokoll(datenbank(true), 'fehler', 'sicherung', 'Zurückspielen von ' . basename($datei) . ' fehlgeschlagen: ' . $e->getMessage()
                . ' – der Stand davor liegt in ' . basename($vorher), $admin);
            throw new Fehler('Das Zurückspielen ist fehlgeschlagen: ' . $e->getMessage() . ' Der Stand davor ist gesichert (' . basename($vorher) . ').', 500);
        }
        protokoll(datenbank(true), 'warnung', 'sicherung', 'Sicherung zurückgespielt: ' . basename($datei) . ' (Stand davor gesichert als ' . basename($vorher) . ')', $admin);
        return ['vorher' => basename($vorher)];
    }

    /** Wartungsaktionen der Kommandozentrale; liefert eine kurze Meldung */
    public function serverAktion(mixed $aktion = null): string
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        $meldung = match (s($aktion)) {
            'mails_senden' => mails_verschicken($db, 50) . ' E-Mails verschickt.',
            'mails_wiederholen' => q($db, 'update mails set versuche = 0, gesperrt_bis = 0 where gesendet_am is null and versuche >= 5')->rowCount()
                . ' fehlgeschlagene E-Mails werden neu versucht.',
            'aufraeumen' => (function () use ($db) { aufraeumen($db); return 'Abgelaufene Sitzungen, alte Protokolleinträge und Messwerte entfernt.'; })(),
            'artikel_neu' => q($db, 'delete from artikel_listen')->rowCount() . ' gespeicherte Artikellisten verworfen – sie werden beim nächsten Öffnen neu geholt.',
            'sitzungen_beenden' => q($db, 'delete from sitzungen where token_hash <> ?', [token_hash((string) $this->ctx->token)])->rowCount()
                . ' Sitzungen beendet – alle außer dir müssen sich neu anmelden.',
            default => throw new Fehler('Unbekannte Aktion.'),
        };
        $this->log('warnung', 'system', 'Kommandozentrale: ' . $meldung, $admin);
        return $meldung;
    }

    /**
     * Wie lange dauert es meistens? Mittelwert (Median) in Tagen aus den bezahlten Abrechnungen der letzten 12 Monate:
     * Einreichen bis Entscheidung und Entscheidung bis Zahlung. null, solange es zu wenige gibt.
     */
    public function ablaufZeiten(): array
    {
        ich($this->ctx);
        $zeilen = zeilen($this->db(), "select eingereicht_am, entschieden_am, bezahlt_am from noten
            where status = 'bezahlt' and entschieden_am is not null and bezahlt_am >= ?", [date('Y-m-d', time() - 365 * 86400)]);
        $median = function (array $werte): ?int {
            if (count($werte) < 3) return null;
            sort($werte);
            return (int) ceil($werte[intdiv(count($werte), 2)]);
        };
        $tage = fn ($von, $bis) => max(0, (strtotime($bis) - strtotime($von)) / 86400);
        return [
            'pruefung_tage' => $median(array_map(fn ($z) => $tage($z['eingereicht_am'], $z['entschieden_am']), $zeilen)),
            'zahlung_tage' => $median(array_map(fn ($z) => $tage(substr($z['entschieden_am'], 0, 10), $z['bezahlt_am']), $zeilen)),
            'anzahl' => count($zeilen),
        ];
    }

    /** „Was ist neu?“ bis zu diesem Eintrag gesehen */
    public function neuigkeitenGesehen(mixed $id = null): bool
    {
        $n = ich($this->ctx);
        pruefe(preg_match('/^\d{4}-\d{2}-\d{2}[a-z]?$/', s($id)) === 1, 'Ungültiger Eintrag.');
        q($this->db(), 'update nutzer set neuigkeiten_gesehen = ? where id = ?', [s($id), $n['id']]);
        return true;
    }

    /** Zahlen für die Navigation: offene Zugangsanfragen (Admin), Rückfragen an mich, Antworten an die Redaktion */
    public function navZaehler(): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        return [
            'anfragen' => hat($n, 'admin') ? (int) wert($db, "select count(*) from anfragen where status = 'offen'") : 0,
            // nur noch offene Abrechnungen zählen (ältere bezahlte können die Rückfrage noch tragen)
            'rueckfragen' => (int) wert($db, "select count(*) from noten where autor_id = ? and rueckfrage = 'offen' and status in ('eingereicht', 'angenommen')", [$n['id']]),
            'antworten' => hat($n, 'redaktion') ? (int) wert($db, "select count(*) from noten where rueckfrage = 'beantwortet' and status in ('eingereicht', 'angenommen')") : 0,
        ];
    }

    public function kommentare(mixed $noteId = null): array
    {
        brauche($this->ctx, 'redaktion');
        return zeilen($this->db(), 'select * from kommentare where note_id = ? order by am', [s($noteId)]);
    }

    public function verlaufVon(mixed $noteId = null): array
    {
        brauche($this->ctx, 'redaktion');
        return array_map(fn ($v) => ['details' => json_decode($v['details']) ?? new stdClass()] + $v,
            zeilen($this->db(), 'select * from verlauf where note_id = ? order by am desc', [s($noteId)]));
    }

    // ---------------------------------------------------------------- Buchhaltung
    /** Summe und Anzahl der im laufenden Jahr bezahlten Prämienabrechnungen (ohne die ganzen Abrechnungen zu laden) */
    public function ausgezahltImJahr(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'buchhaltung');
        $seit = substr(heute_iso(), 0, 4) . '-01-01';
        return [
            'anzahl' => (int) wert($db, "select count(*) from noten where status = 'bezahlt' and bezahlt_am >= ?", [$seit]),
            'summe' => euro((int) wert($db, "select coalesce(sum(np.betrag_cent), 0) from note_positionen np join noten n on n.id = np.note_id
                where n.status = 'bezahlt' and n.bezahlt_am >= ?", [$seit])),
        ];
    }

    public function offeneZahlungen(): array
    {
        return noten_liste($this->db(), brauche($this->ctx, 'buchhaltung'), "where status = 'angenommen'", [], 'entschieden_am');
    }

    public function bezahlteNoten(mixed $monat = null): array
    {
        $n = brauche($this->ctx, 'buchhaltung');
        pruefe(preg_match('/^\d{4}-\d{2}$/', s($monat)), 'Ungültiger Monat.');
        return noten_liste($this->db(), $n, "where status = 'bezahlt' and bezahlt_am like ?", [s($monat) . '-%'], 'bezahlt_am, nummer');
    }

    /** Bezahlte Noten ab einem Zahlungsdatum ("JJJJ-MM-TT"), z. B. für die letzten Wochen */
    public function bezahlteNotenSeit(mixed $datum = null): array
    {
        $n = brauche($this->ctx, 'buchhaltung');
        pruefe(preg_match('/^\d{4}-\d{2}-\d{2}$/', s($datum)), 'Ungültiges Datum.');
        return noten_liste($this->db(), $n, "where status = 'bezahlt' and bezahlt_am >= ?", [s($datum)], 'bezahlt_am, nummer');
    }

    public function alsBezahltMarkieren(mixed $noteId = null, mixed $datum = null): array
    {
        return $this->alleAlsBezahltMarkieren([$noteId], $datum)[0];
    }

    /** Mehrere Noten auf einmal als bezahlt markieren (z. B. eine ganze Woche): alle oder keine */
    public function alleAlsBezahltMarkieren(mixed $noteIds = null, mixed $datum = null): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'buchhaltung');
        $d = s($datum);
        pruefe(ist_datum($d) && $d <= heute_iso(), 'Bitte ein gültiges Zahlungsdatum angeben (nicht in der Zukunft).');
        pruefe(is_array($noteIds) && $noteIds && count($noteIds) <= 500, 'Bitte mindestens eine Prämienabrechnung auswählen.');
        return transaktion($db, fn () => array_map(function ($noteId) use ($db, $n, $d) {
            $x = note_holen($db, $noteId);
            pruefe($x['status'] === 'angenommen', $x['nummer'] . ': Nur angenommene Prämienabrechnungen können als bezahlt markiert werden.');
            // eine offene Rückfrage ist mit der Zahlung erledigt (wie bei Annehmen/Zurückgeben)
            q($db, "update noten set status = 'bezahlt', bezahlt_am = ?, rueckfrage = null where id = ?", [$d, $x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'bezahlt', ['datum' => $d]);
            $this->log('info', 'zahlung', "Als bezahlt markiert: {$x['nummer']} ($d)");
            $note = note_holen($db, $x['id']);
            autor_benachrichtigen($db, $note, 'bezahlt', mail_bezahlt_autor($db, $note, $d));
            return sicht($n, $note);
        }, array_values($noteIds)));
    }

    // ---------------------------------------------------------------- Admin: Anfragen & Konten
    public function anfragen(): array
    {
        brauche($this->ctx, 'admin');
        return zeilen($this->db(), 'select * from anfragen order by am desc limit 300');
    }

    public function offeneAnfragenAnzahl(): int
    {
        $n = ich($this->ctx);
        if (!hat($n, 'admin')) return 0;
        return (int) wert($this->db(), "select count(*) from anfragen where status = 'offen'");
    }

    public function anfrageFreischalten(mixed $anfrageId = null, mixed $rollen = ['autor']): array
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        $r = rollen_normalisieren($rollen);
        pruefe($r, 'Bitte mindestens eine Rolle wählen.');
        $passwort = startpasswort();
        $hash = passwort_hash($passwort);
        return zugang_senden($db, transaktion($db, function () use ($db, $admin, $anfrageId, $r, $passwort, $hash) {
            $a = zeile($db, 'select * from anfragen where id = ?', [s($anfrageId)]);
            pruefe($a, 'Diese Anfrage gibt es nicht (mehr).', 404);
            pruefe($a['status'] === 'offen', 'Diese Anfrage wurde bereits bearbeitet.');
            pruefe(!wert($db, 'select 1 from nutzer where email = ?', [$a['email']]), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
            $id = konto_einfuegen($db, $a['vorname'], $a['nachname'], $a['email'], $r, $hash);
            q($db, "update anfragen set status = 'freigeschaltet', bearbeitet_am = ?, bearbeitet_von = ? where id = ?", [jetzt(), anzeigename($admin), $a['id']]);
            $this->log('info', 'konten', "Zugangsanfrage freigeschaltet: {$a['vorname']} {$a['nachname']} ({$a['email']})");
            return zugang_melden($db, ['id' => $id, 'email' => $a['email'], 'vorname' => $a['vorname'], 'passwort' => $passwort]);
        }));
    }

    public function anfrageAblehnen(mixed $anfrageId = null): bool
    {
        $admin = brauche($this->ctx, 'admin');
        $r = q($this->db(), "update anfragen set status = 'abgelehnt', bearbeitet_am = ?, bearbeitet_von = ? where id = ? and status = 'offen'",
            [jetzt(), anzeigename($admin), s($anfrageId)]);
        pruefe($r->rowCount() === 1, 'Diese Anfrage wurde bereits bearbeitet.');
        $this->log('info', 'konten', 'Zugangsanfrage abgelehnt');
        return true;
    }

    public function nutzerAnlegen(mixed $daten = []): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $d = is_array($daten) ? $daten : [];
        $email = strtolower(tr($d['email'] ?? ''));
        pruefe(!leer($d['vorname'] ?? '') && !leer($d['nachname'] ?? ''), 'Bitte Vor- und Nachnamen angeben.');
        pruefe(ist_email($email), 'Bitte eine gültige E-Mail-Adresse angeben.');
        $r = rollen_normalisieren($d['rollen'] ?? []);
        pruefe($r, 'Bitte mindestens eine Rolle wählen.');
        $passwort = startpasswort();
        $hash = passwort_hash($passwort);
        return zugang_senden($db, transaktion($db, function () use ($db, $d, $email, $r, $passwort, $hash) {
            pruefe(!wert($db, 'select 1 from nutzer where email = ?', [$email]), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
            $id = konto_einfuegen($db, s($d['vorname']), s($d['nachname']), $email, $r, $hash);
            q($db, "update anfragen set status = 'freigeschaltet', bearbeitet_am = ? where email = ? and status = 'offen'", [jetzt(), $email]);
            $this->log('info', 'konten', 'Konto angelegt: ' . tr($d['vorname']) . ' ' . tr($d['nachname']) . " ($email), Rollen: " . implode(', ', $r));
            return zugang_melden($db, ['id' => $id, 'email' => $email, 'vorname' => tr($d['vorname']), 'passwort' => $passwort]);
        }));
    }

    public function nutzerListe(): array
    {
        brauche($this->ctx, 'admin');
        return array_map('nutzer_aus_zeile', zeilen($this->db(), 'select * from nutzer order by lower(nachname), lower(vorname)'));
    }

    public function rollenSetzen(mixed $uid = null, mixed $rollen = []): bool
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $r = rollen_normalisieren($rollen);
        return transaktion($db, function () use ($db, $uid, $r) {
            $n = nutzer_laden($db, s($uid));
            pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
            if (!in_array('admin', $r, true)) pruefe(noch_ein_admin($db, $n['id']), 'Es muss mindestens ein aktives Admin-Konto geben.');
            q($db, 'update nutzer set rollen = ? where id = ?', [json_text($r), $n['id']]);
            $this->log('info', 'konten', 'Rollen von ' . anzeigename($n) . ': ' . (implode(', ', $r) ?: 'keine'));
            return true;
        });
    }

    public function nutzerAktivSetzen(mixed $uid = null, mixed $aktiv = false): bool
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        return transaktion($db, function () use ($db, $admin, $uid, $aktiv) {
            $n = nutzer_laden($db, s($uid));
            pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
            pruefe($aktiv || $n['id'] !== $admin['id'], 'Du kannst dein eigenes Konto nicht deaktivieren.');
            if (!$aktiv && in_array('admin', $n['rollen'], true)) pruefe(noch_ein_admin($db, $n['id']), 'Es muss mindestens ein aktives Admin-Konto geben.');
            q($db, 'update nutzer set aktiv = ? where id = ?', [$aktiv ? 1 : 0, $n['id']]);
            if (!$aktiv) alle_sitzungen_beenden($db, $n['id']);
            $this->log('info', 'konten', ($aktiv ? 'Konto aktiviert: ' : 'Konto deaktiviert: ') . anzeigename($n));
            return true;
        });
    }

    public function passwortZuruecksetzen(mixed $uid = null): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $n = nutzer_laden($db, s($uid));
        pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
        $passwort = startpasswort();
        q($db, 'update nutzer set passwort = ?, muss_passwort_aendern = 1 where id = ?', [passwort_hash($passwort), $n['id']]);
        alle_sitzungen_beenden($db, $n['id'], $n['id'] === $this->ctx->nutzer['id'] ? $this->ctx->token : null);
        $this->log('info', 'konten', 'Passwort zurückgesetzt: ' . anzeigename($n));
        return zugang_senden($db, zugang_melden($db, ['id' => $n['id'], 'email' => $n['email'], 'vorname' => $n['vorname'], 'passwort' => $passwort], false));
    }

    /** E-Mail-Adresse eines Kontos ändern (z. B. Tippfehler). Alte und neue Adresse bekommen eine Info-Mail. */
    public function emailAendern(mixed $uid = null, mixed $email = null): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $n = nutzer_laden($db, s($uid));
        pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
        $neu = strtolower(tr($email));
        pruefe(ist_email($neu) && strlen($neu) <= 200, 'Bitte eine gültige E-Mail-Adresse angeben.');
        pruefe($neu !== $n['email'], 'Das ist schon die E-Mail-Adresse dieses Kontos.');
        pruefe(!wert($db, 'select 1 from nutzer where email = ? and id <> ?', [$neu, $n['id']]), 'Diese E-Mail-Adresse wird schon verwendet.');
        q($db, 'update nutzer set email = ? where id = ?', [$neu, $n['id']]);
        $this->log('info', 'konten', 'E-Mail von ' . anzeigename($n) . " geändert: {$n['email']} → $neu");
        return ['email' => $neu, 'mail' => email_geaendert_melden($db, $n['vorname'], $n['email'], $neu)];
    }

    public function nutzerLoeschen(mixed $uid = null): bool
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        return transaktion($db, function () use ($db, $admin, $uid) {
            $n = nutzer_laden($db, s($uid));
            pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
            pruefe($n['id'] !== $admin['id'], 'Du kannst dein eigenes Konto nicht löschen.');
            if (in_array('admin', $n['rollen'], true)) pruefe(noch_ein_admin($db, $n['id']), 'Es muss mindestens ein aktives Admin-Konto geben.');
            // abgeschickte Prämienabrechnungen bleiben als Buchhaltungsbelege erhalten (autor_id wird leer)
            q($db, 'delete from nutzer where id = ?', [$n['id']]);
            nachweise_aufraeumen($db);
            $this->log('warnung', 'konten', 'Konto gelöscht: ' . anzeigename($n) . " ({$n['email']})");
            return true;
        });
    }

    // ---------------------------------------------------------------- Admin: Prämienabrechnungen & Einstellungen
    public function noteLoeschen(mixed $noteId = null): bool
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        return transaktion($db, function () use ($db, $admin, $noteId) {
            $x = note_holen($db, $noteId);
            q($db, 'delete from noten where id = ?', [$x['id']]);
            nachweise_aufraeumen($db);
            q($db, 'insert into loeschprotokoll (id, nummer, geloescht_von, am) values (?, ?, ?, ?)', [neue_id(), $x['nummer'], anzeigename($admin), jetzt()]);
            $this->log('warnung', 'abrechnungen', "Prämienabrechnung gelöscht: {$x['nummer']}");
            return true;
        });
    }

    public function loeschprotokoll(): array
    {
        brauche($this->ctx, 'admin');
        return zeilen($this->db(), 'select * from loeschprotokoll order by am desc');
    }

    public function einstellungenSpeichern(mixed $daten = []): bool
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $d = is_array($daten) ? $daten : [];
        $e = is_array($d['empfaenger'] ?? null) ? $d['empfaenger'] : [];
        pruefe(!leer($e['name'] ?? ''), 'Bitte den Namen des Rechnungsempfängers angeben.');
        $kontakt = tr($d['datenschutzKontakt'] ?? '');
        pruefe($kontakt === '' || ist_email($kontakt), 'Bitte eine gültige E-Mail-Adresse für Datenschutzanfragen angeben.');
        $saetze = saetze_normalisieren($d['honorarsaetze'] ?? einstellungen_laden($db)['honorarsaetze']);
        $betreiber = betreiber_pruefen(einstellungen_laden($db)['betreiber'], $d['betreiber'] ?? null);
        $vorlagen = array_key_exists('rueckgabe_vorlagen', $d) ? vorlagen_normalisieren($d['rueckgabe_vorlagen']) : einstellungen_laden($db)['rueckgabe_vorlagen'];
        $erinnerung = einstellungen_laden($db)['erinnerung_tage'];
        if (array_key_exists('erinnerung_tage', $d)) {
            $erinnerung = filter_var($d['erinnerung_tage'], FILTER_VALIDATE_INT);
            pruefe($erinnerung !== false && $erinnerung >= 0 && $erinnerung <= 31, 'Erinnerung: bitte 0 bis 31 Tage vor Monatsende angeben (0 = aus).');
        }
        $speichere = fn ($schluessel, $wert) => upsert($db, 'einstellungen', ['schluessel' => $schluessel, 'wert' => json_text($wert)], ['schluessel']);
        transaktion($db, function () use ($speichere, $e, $kontakt, $saetze, $betreiber, $vorlagen, $erinnerung) {
            $speichere('erinnerung_tage', $erinnerung);
            $speichere('betreiber', $betreiber);
            $speichere('rueckgabe_vorlagen', $vorlagen);
            $speichere('empfaenger', [
                'name' => kuerze(tr($e['name']), 150), 'strasse' => kuerze(tr($e['strasse'] ?? ''), 150),
                'plz_ort' => kuerze(tr($e['plz_ort'] ?? ''), 100), 'uid' => kuerze(tr($e['uid'] ?? ''), 30),
            ]);
            $speichere('datenschutzKontakt', $kontakt);
            $speichere('honorarsaetze', $saetze);
        });
        $this->log('info', 'einstellungen', 'Einstellungen gespeichert');
        return true;
    }

    public function statistik(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $zaehle = fn ($s) => (int) wert($db, 'select count(*) from noten where status = ?', [$s]);
        return [
            'nutzer' => (int) wert($db, 'select count(*) from nutzer'),
            'anfragen' => (int) wert($db, "select count(*) from anfragen where status = 'offen'"),
            'entwuerfe' => (int) wert($db, 'select count(*) from positionen'),
            'eingereicht' => $zaehle('eingereicht'),
            'angenommen' => $zaehle('angenommen'),
            'abgelehnt' => $zaehle('abgelehnt'),
            'bezahlt' => $zaehle('bezahlt'),
        ];
    }

    /** Datenexport als JSON (ohne Passwörter, Sitzungen und Mail-Zugangsdaten) – enthält IBANs, vertraulich! */
    public function exportieren(): string
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $alle = fn ($t) => zeilen($db, "select * from $t");
        return json_text([
            'exportiert_am' => jetzt(),
            'nutzer' => array_map(function ($n) { unset($n['passwort'], $n['zwei_faktor'], $n['zwei_faktor_neu'], $n['zwei_faktor_codes'], $n['zwei_faktor_schritt']); return $n; }, $alle('nutzer')),
            'anfragen' => $alle('anfragen'),
            'positionen' => $alle('positionen'),
            'noten' => $alle('noten'),
            'note_positionen' => $alle('note_positionen'),
            'kommentare' => $alle('kommentare'),
            'verlauf' => $alle('verlauf'),
            'loeschprotokoll' => $alle('loeschprotokoll'),
            'einstellungen' => zeilen($db, "select * from einstellungen where schluessel <> 'mail'"),
        ], JSON_PRETTY_PRINT);
    }

    // ---------------------------------------------------------------- Admin: E-Mail
    public function mailEinstellungen(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $e = mail_einstellungen_sicht($db);
        if ($e['adresse'] === '') $e['adresse_vorschlag'] = aktuelle_adresse();
        $e['warteschlange'] = [
            'offen' => (int) wert($db, 'select count(*) from mails where gesendet_am is null and versuche < 5'),
            'fehlgeschlagen' => (int) wert($db, 'select count(*) from mails where gesendet_am is null and versuche >= 5'),
            'gesendet' => (int) wert($db, 'select count(*) from mails where gesendet_am is not null'),
            'letzter_fehler' => (string) (wert($db, "select fehler from mails where fehler <> '' order by erstellt_am desc limit 1") ?: ''),
        ];
        return $e;
    }

    public function mailEinstellungenSpeichern(mixed $daten = []): bool
    {
        brauche($this->ctx, 'admin');
        mail_einstellungen_speichern($this->db(), is_array($daten) ? $daten : []);
        $this->log('info', 'einstellungen', 'E-Mail-Einstellungen gespeichert');
        return true;
    }

    /** Test-E-Mail sofort an die eigene Adresse (oder die angegebene) – mit verständlicher Fehlermeldung */
    // ---------------------------------------------------------------- Admin: Übersicht, Protokoll, Sicherungen
    public function dashboard(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $zaehle = fn ($s) => (int) wert($db, 'select count(*) from noten where status = ?', [$s]);
        $summe = fn ($where, $p = []) => euro((int) wert($db, "select coalesce(sum(np.betrag_cent), 0) from note_positionen np join noten n on n.id = np.note_id where $where", $p));
        $seit = zeit_iso(time() - 7 * 86400);
        $stufe = fn ($s) => (int) wert($db, 'select count(*) from protokoll where stufe = ? and zeit >= ?', [$s, $seit]);
        $sicherungen = sicherungen_liste();
        $mysql = ist_mysql($db);
        $e = mail_einstellungen($db);
        $version = @file_get_contents(__DIR__ . '/../version.txt');
        return [
            'zahlen' => [
                'zu_pruefen' => $zaehle('eingereicht'), 'zur_zahlung' => $zaehle('angenommen'), 'zur_zahlung_summe' => $summe("n.status = 'angenommen'"),
                'bezahlt_jahr' => $summe("n.status = 'bezahlt' and n.bezahlt_am >= ?", [substr(heute_iso(), 0, 4) . '-01-01']),
                'anfragen' => (int) wert($db, "select count(*) from anfragen where status = 'offen'"),
                'konten' => (int) wert($db, 'select count(*) from nutzer where aktiv = 1'),
                'entwuerfe' => (int) wert($db, 'select count(*) from positionen'),
                'warnungen' => $stufe('warnung'), 'fehler' => $stufe('fehler'),
            ],
            'system' => [
                'datenbank' => ($mysql ? 'MySQL/MariaDB ' : 'SQLite ') . $db->getAttribute(PDO::ATTR_SERVER_VERSION),
                'php' => PHP_VERSION,
                'version' => $version !== false ? trim($version) : '',
                'mail' => [
                    'aktiv' => $e['aktiv'],
                    'offen' => (int) wert($db, 'select count(*) from mails where gesendet_am is null and versuche < 5'),
                    'fehlgeschlagen' => (int) wert($db, 'select count(*) from mails where gesendet_am is null and versuche >= 5'),
                ],
                'sicherungen' => count($sicherungen),
                'letzte_sicherung' => $sicherungen[0] ?? null,
            ],
            'aktivitaet' => array_map('protokoll_aus_zeile', zeilen($db, 'select * from protokoll order by zeit desc, id desc limit 12')),
        ];
    }

    /** Protokoll mit Filtern; „vor“: Zeitpunkt des letzten geladenen Eintrags (zum Weiterblättern) */
    public function protokoll(mixed $filter = []): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $f = is_array($filter) ? $filter : [];
        $wo = [];
        $p = [];
        if (in_array($f['stufe'] ?? '', PROTOKOLL_STUFEN, true)) { $wo[] = 'stufe = ?'; $p[] = $f['stufe']; }
        if (isset(PROTOKOLL_BEREICHE[$f['bereich'] ?? ''])) { $wo[] = 'bereich = ?'; $p[] = $f['bereich']; }
        $suche = kuerze(tr($f['suche'] ?? ''), 100);
        if ($suche !== '') {
            $wo[] = '(lower(text) like ? or lower(wer) like ?)';
            $like = '%' . mb_strtolower($suche) . '%';
            array_push($p, $like, $like);
        }
        $filterWo = $wo;
        $filterP = $p;
        if (is_string($f['vor'] ?? null) && $f['vor'] !== '') { $wo[] = 'zeit < ?'; $p[] = $f['vor']; }
        $where = $wo ? 'where ' . implode(' and ', $wo) : '';
        $zeilen = zeilen($db, "select * from protokoll $where order by zeit desc, id desc limit 101", $p);
        // Anzahl je Stufe (mit Bereich und Suche, ohne Stufe)
        $ohneStufe = array_values(array_filter($filterWo, fn ($w) => $w !== 'stufe = ?'));
        $ohneStufeP = in_array('stufe = ?', $filterWo, true) ? array_slice($filterP, 1) : $filterP;
        $zaehler = ['alle' => 0] + array_fill_keys(PROTOKOLL_STUFEN, 0);
        foreach (zeilen($db, 'select stufe, count(*) anzahl from protokoll ' . ($ohneStufe ? 'where ' . implode(' and ', $ohneStufe) : '') . ' group by stufe', $ohneStufeP) as $z) {
            $zaehler[$z['stufe']] = (int) $z['anzahl'];
            $zaehler['alle'] += (int) $z['anzahl'];
        }
        return [
            'eintraege' => array_map('protokoll_aus_zeile', array_slice($zeilen, 0, 100)),
            'mehr' => count($zeilen) > 100,
            'zaehler' => $zaehler,
            'bereiche' => PROTOKOLL_BEREICHE,
        ];
    }

    public function sicherungen(): array
    {
        brauche($this->ctx, 'admin');
        return ['liste' => sicherungen_liste(), 'tage' => (int) konfiguration()['backup_tage']];
    }

    public function jetztSichern(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        pruefe(konfiguration()['datenbank'] !== ':memory:', 'Sicherungen sind hier nicht möglich.');
        try {
            $ziel = sichern($db, daten_ordner() . '/backups/honorarnoten-' . date('Y-m-d-His') . '.sqlite');
        } catch (Throwable $e) {
            $this->log('fehler', 'sicherung', 'Sicherung fehlgeschlagen: ' . $e->getMessage());
            throw new Fehler('Die Sicherung ist fehlgeschlagen: ' . $e->getMessage(), 500);
        }
        $this->log('info', 'sicherung', 'Sicherung von Hand erstellt: ' . basename($ziel) . ' (' . groesse_text((int) filesize($ziel)) . ')');
        return sicherungen_liste()[0];
    }

    /** Sicherung als base64 (zum Herunterladen im Browser) – enthält alle Daten, auch IBANs */
    public function sicherungHerunterladen(mixed $name = null): array
    {
        brauche($this->ctx, 'admin');
        $datei = sicherung_pfad(s($name));
        pruefe($datei, 'Diese Sicherung gibt es nicht (mehr).', 404);
        pruefe(filesize($datei) <= 30 * 1024 * 1024, 'Die Sicherung ist zu groß zum Herunterladen über die App. Bitte per SSH oder FTP holen (Ordner app/daten/backups).', 413);
        $this->log('warnung', 'sicherung', 'Sicherung heruntergeladen: ' . basename($datei));
        return ['name' => basename($datei), 'inhalt' => base64_encode((string) file_get_contents($datei))];
    }

    // ---------------------------------------------------------------- Links (Anmelden, Registrieren)
    /** Link aus der Zugangs-Mail: meldet direkt an (einmal, 7 Tage); danach eigenes Passwort festlegen */
    public function linkAnmelden(mixed $token = null): array
    {
        $db = $this->db();
        return transaktion($db, function () use ($db, $token) {
            $l = link_pruefen($db, $token, 'anmelden');
            pruefe($l['notiz'] !== PASSWORT_LINK, 'Dieser Link ist ungültig. Bitte prüfe, ob er vollständig kopiert wurde.', 404);
            $n = nutzer_laden($db, (string) $l['nutzer_id']);
            pruefe($n && $n['aktiv'], 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.', 403);
            pruefe(!$n['zwei_faktor'], 'Für dieses Konto ist die Zwei-Faktor-Anmeldung eingeschaltet. Bitte mit E-Mail, Passwort und Code anmelden.', 403);
            q($db, 'update links set nutzungen = nutzungen + 1 where id = ?', [$l['id']]);
            if ($this->ctx->token) sitzung_beenden($db, $this->ctx->token);
            $this->ctx->neueSitzung = sitzung_erstellen($db, $n['id']);
            q($db, 'update nutzer set letzter_login = ? where id = ?', [jetzt(), $n['id']]);
            $this->log('info', 'anmeldung', 'Mit Anmeldelink aus der Zugangs-Mail angemeldet', $n);
            return nutzer_laden($db, $n['id']);
        });
    }

    // ---------------------------------------------------------------- Zwei-Faktor-Anmeldung (freiwillig, im Profil)
    /** Einrichten beginnen: neues Geheimnis (noch nicht aktiv) für den QR-Code */
    public function zweiFaktorStarten(): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        pruefe(!$n['zwei_faktor'], 'Die Zwei-Faktor-Anmeldung ist schon eingeschaltet.');
        $g = totp_geheimnis();
        q($db, 'update nutzer set zwei_faktor_neu = ? where id = ?', [$g, $n['id']]);
        return ['geheimnis' => $g, 'uri' => totp_uri($g, $n['email'])];
    }

    /** Mit dem ersten Code aus der App bestätigen; liefert die Ersatz-Codes (nur jetzt sichtbar) */
    public function zweiFaktorEinschalten(mixed $code = null): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        $g = (string) wert($db, 'select zwei_faktor_neu from nutzer where id = ?', [$n['id']]);
        pruefe($g !== '', 'Bitte zuerst „Zwei-Faktor einrichten“ starten.');
        $schritt = totp_pruefen($g, s($code));
        pruefe($schritt !== null, 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben (die Uhr am Handy muss stimmen).');
        $codes = ersatzcodes();
        q($db, 'update nutzer set zwei_faktor = ?, zwei_faktor_neu = null, zwei_faktor_schritt = ?, zwei_faktor_codes = ? where id = ?',
            [$g, $schritt, json_text(array_map(fn ($c) => hash('sha256', $c), $codes)), $n['id']]);
        alle_sitzungen_beenden($db, $n['id'], $this->ctx->token);
        mail_einreihen($db, $n['email'], mail_zwei_faktor($db, $n['vorname'], true));
        $this->log('info', 'konten', 'Zwei-Faktor-Anmeldung eingeschaltet');
        return ['ersatzcodes' => $codes];
    }

    /** Ausschalten mit dem Passwort */
    public function zweiFaktorAusschalten(mixed $passwort = null): bool
    {
        $db = $this->db();
        $n = ich($this->ctx);
        pruefe(password_verify(s($passwort), (string) wert($db, 'select passwort from nutzer where id = ?', [$n['id']])), 'Das Passwort stimmt nicht.');
        q($db, 'update nutzer set zwei_faktor = null, zwei_faktor_neu = null, zwei_faktor_codes = null where id = ?', [$n['id']]);
        mail_einreihen($db, $n['email'], mail_zwei_faktor($db, $n['vorname'], false));
        $this->log('warnung', 'konten', 'Zwei-Faktor-Anmeldung ausgeschaltet');
        return true;
    }

    /** Admin: für jemanden, der Handy und Ersatz-Codes verloren hat */
    public function zweiFaktorZuruecksetzen(mixed $uid = null): bool
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $n = nutzer_laden($db, s($uid));
        pruefe($n, 'Dieses Konto gibt es nicht (mehr).', 404);
        q($db, 'update nutzer set zwei_faktor = null, zwei_faktor_neu = null, zwei_faktor_codes = null where id = ?', [$n['id']]);
        mail_einreihen($db, $n['email'], mail_zwei_faktor($db, $n['vorname'], false));
        $this->log('warnung', 'konten', 'Zwei-Faktor-Anmeldung zurückgesetzt: ' . anzeigename($n));
        return true;
    }

    /**
     * Passwort vergessen: Link zum Festlegen eines neuen Passworts per E-Mail (1 Stunde, einmal).
     * Die Antwort ist immer gleich – man kann so nicht herausfinden, ob es eine Adresse gibt.
     */
    public function passwortVergessen(mixed $email = null): bool
    {
        $db = $this->db();
        $adresse = strtolower(tr($email));
        pruefe(ist_email($adresse), 'Bitte eine gültige E-Mail-Adresse angeben.');
        $z = zeile($db, 'select * from nutzer where email = ? and aktiv = 1', [$adresse]);
        if (!$z) {
            protokoll($db, 'warnung', 'anmeldung', "Passwort vergessen für unbekannte oder deaktivierte Adresse: $adresse");
            return true;
        }
        $n = nutzer_aus_zeile($z);
        // ältere Links „Passwort vergessen“ gelten nicht mehr
        q($db, "update links set widerrufen_am = ? where nutzer_id = ? and art = 'anmelden' and notiz = ? and widerrufen_am is null", [jetzt(), $n['id'], PASSWORT_LINK]);
        $link = app_link($db, 'passwort/' . link_erstellen($db, 'anmelden', ['nutzer_id' => $n['id'], 'max' => 1, 'sekunden' => 3600, 'notiz' => PASSWORT_LINK]));
        $id = mail_einreihen($db, $n['email'], mail_passwort_vergessen($db, $n['vorname'], $link));
        $fehler = $id ? mail_jetzt_senden($db, $id) : 'E-Mail-Versand ist ausgeschaltet';
        protokoll($db, $fehler ? 'warnung' : 'info', 'anmeldung', 'Passwort vergessen: Link angefordert' . ($fehler ? " (E-Mail nicht verschickt: $fehler)" : ''), $n);
        return true;
    }

    /** Neues Passwort mit dem Link aus „Passwort vergessen“; meldet danach an (außer mit Zwei-Faktor) */
    public function passwortNeuSetzen(mixed $token = null, mixed $neu = null): array
    {
        $db = $this->db();
        pruefe(mb_strlen(s($neu)) >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
        $hash = passwort_hash(s($neu));
        $n = transaktion($db, function () use ($db, $token, $hash) {
            $l = link_pruefen($db, $token, 'anmelden');
            pruefe($l['notiz'] === PASSWORT_LINK, 'Dieser Link ist ungültig. Bitte fordere unter „Passwort vergessen“ einen neuen an.', 404);
            $n = nutzer_laden($db, (string) $l['nutzer_id']);
            pruefe($n && $n['aktiv'], 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.', 403);
            q($db, 'update links set nutzungen = nutzungen + 1 where id = ?', [$l['id']]);
            q($db, 'update nutzer set passwort = ?, muss_passwort_aendern = 0 where id = ?', [$hash, $n['id']]);
            alle_sitzungen_beenden($db, $n['id']);
            anmeldelinks_widerrufen($db, $n['id']);
            return $n;
        });
        mail_einreihen($db, $n['email'], mail_passwort_geaendert($db, $n['vorname']));
        $this->log('info', 'anmeldung', 'Neues Passwort über „Passwort vergessen“ festgelegt', $n);
        if (zwei_faktor_aktiv($db, $n['id'])) return ['angemeldet' => false];
        if ($this->ctx->token) sitzung_beenden($db, $this->ctx->token);
        $this->ctx->neueSitzung = sitzung_erstellen($db, $n['id']);
        return ['angemeldet' => true];
    }

    /** Gilt der Registrierungslink? (für die Seite „Registrieren“) */
    public function einladungPruefen(mixed $token = null): array
    {
        $l = link_pruefen($this->db(), $token, 'registrieren');
        return ['rollen' => json_decode($l['rollen'], true) ?: [], 'gueltig_bis' => $l['gueltig_bis']];
    }

    /** Mit Registrierungslink selbst ein Konto anlegen – ohne Freischalten durch den Admin */
    public function mitLinkRegistrieren(mixed $token = null, mixed $daten = []): array
    {
        $db = $this->db();
        $d = is_array($daten) ? $daten : [];
        $email = strtolower(tr($d['email'] ?? ''));
        pruefe(!leer($d['vorname'] ?? '') && !leer($d['nachname'] ?? ''), 'Bitte Vor- und Nachnamen angeben.');
        pruefe(ist_email($email) && strlen($email) <= 200, 'Bitte eine gültige E-Mail-Adresse angeben.');
        pruefe(mb_strlen(s($d['passwort'] ?? '')) >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
        pruefe(($d['zustimmung'] ?? null) === true, ZUSTIMMUNG_FEHLT);
        $hash = passwort_hash(s($d['passwort']));
        $n = transaktion($db, function () use ($db, $d, $token, $email, $hash) {
            $l = link_pruefen($db, $token, 'registrieren');
            pruefe(!wert($db, 'select 1 from nutzer where email = ?', [$email]), 'Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte melde dich an.');
            $rollen = rollen_normalisieren(json_decode($l['rollen'], true)) ?: ['autor'];
            $id = konto_einfuegen($db, s($d['vorname']), s($d['nachname']), $email, $rollen, $hash);
            q($db, 'update nutzer set muss_passwort_aendern = 0, hinweis_bestaetigt_am = ? where id = ?', [jetzt(), $id]);
            q($db, 'update links set nutzungen = nutzungen + 1 where id = ?', [$l['id']]);
            q($db, "update anfragen set status = 'freigeschaltet', bearbeitet_am = ?, bearbeitet_von = ? where email = ? and status = 'offen'",
                [jetzt(), 'Registrierungslink', $email]);
            if ($this->ctx->token) sitzung_beenden($db, $this->ctx->token);
            $this->ctx->neueSitzung = sitzung_erstellen($db, $id);
            return nutzer_laden($db, $id);
        });
        benachrichtigen($db, 'anfrage', mail_registriert_admin($db, $n));
        $this->log('info', 'konten', "Über Registrierungslink registriert: {$n['vorname']} {$n['nachname']} ({$n['email']})", $n);
        return $n;
    }

    public function registrierungslinkErstellen(mixed $daten = []): array
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        $d = is_array($daten) ? $daten : [];
        $tage = (int) ($d['tage'] ?? 7);
        pruefe(in_array($tage, LINK_TAGE, true), 'Bitte eine Gültigkeit wählen.');
        $max = ($d['max'] ?? null) === null || $d['max'] === '' ? null : (int) $d['max'];
        pruefe($max === null || ($max >= 1 && $max <= 500), 'Bitte angeben, wie oft der Link verwendet werden darf (1 bis 500 oder unbegrenzt).');
        $rollen = array_values(array_intersect(rollen_normalisieren($d['rollen'] ?? ['autor']), LINK_ROLLEN));
        pruefe($rollen, 'Bitte mindestens eine Rolle wählen.');
        $an = strtolower(tr($d['email'] ?? ''));
        pruefe($an === '' || ist_email($an), 'Bitte eine gültige E-Mail-Adresse angeben oder das Feld leer lassen.');
        $link = app_link($db, 'registrieren/' . link_erstellen($db, 'registrieren', [
            'rollen' => $rollen, 'max' => $max, 'tage' => $tage, 'notiz' => kuerze(tr($d['notiz'] ?? '') ?: $an, 200), 'von' => anzeigename($admin),
        ]));
        $mail = $an !== '' && mail_einstellungen($db)['aktiv'];
        // gleich verschicken, damit der Admin sieht, ob es geklappt hat
        $mailFehler = $mail ? (mail_jetzt_senden($db, (string) mail_einreihen($db, $an, mail_einladung($db, $link, $tage, $admin))) ?? '') : '';
        $this->log('info', 'konten', "Registrierungslink erstellt: $tage Tage, " . ($max === null ? 'beliebig oft' : "{$max}×") . ($an !== '' ? ", an $an" : ''));
        return ['link' => $link, 'mail' => $mail, 'mail_fehler' => $mailFehler, 'tage' => $tage, 'max' => $max];
    }

    public function registrierungslinks(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        return array_map(fn ($l) => [
            'id' => $l['id'], 'rollen' => json_decode($l['rollen'], true) ?: [], 'max' => $l['max_nutzungen'] === null ? null : (int) $l['max_nutzungen'],
            'nutzungen' => (int) $l['nutzungen'], 'gueltig_bis' => $l['gueltig_bis'], 'notiz' => $l['notiz'], 'erstellt_von' => $l['erstellt_von'],
            'erstellt_am' => $l['erstellt_am'], 'widerrufen_am' => $l['widerrufen_am'],
            'aktiv' => !$l['widerrufen_am'] && strtotime($l['gueltig_bis']) >= time()
                && ($l['max_nutzungen'] === null || (int) $l['nutzungen'] < (int) $l['max_nutzungen']),
        ], zeilen($db, "select * from links where art = 'registrieren' order by erstellt_am desc limit 50"));
    }

    public function registrierungslinkWiderrufen(mixed $id = null): bool
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $r = q($db, "update links set widerrufen_am = ? where id = ? and art = 'registrieren' and widerrufen_am is null", [jetzt(), s($id)]);
        pruefe($r->rowCount() === 1, 'Diesen Link gibt es nicht (mehr) oder er ist schon zurückgezogen.', 404);
        $this->log('info', 'konten', 'Registrierungslink zurückgezogen');
        return true;
    }

    /** Zahlungsavis (PDF, base64) einer bezahlten Abrechnung – für die Autor:in selbst und die Buchhaltung */
    public function zahlungsavis(mixed $noteId = null): array
    {
        $db = $this->db();
        $n = ich($this->ctx);
        $note = note_holen($db, $noteId);
        pruefe($note['autor_id'] === $n['id'] || hat($n, 'buchhaltung'), 'Dafür fehlt dir die Berechtigung.', 403);
        pruefe($note['status'] === 'bezahlt', 'Ein Zahlungsavis gibt es erst, wenn die Prämienabrechnung bezahlt ist.');
        return ['name' => zahlungsavis_name($note), 'inhalt' => base64_encode(zahlungsavis_pdf($note, (string) $note['bezahlt_am']))];
    }

    /** Konto, von dem die Sammelüberweisung (SEPA) abgeht – nur Buchhaltung und Admin */
    public function zahlungskonto(): array
    {
        $db = $this->db();
        brauche($this->ctx, 'buchhaltung');
        return zahlungskonto_laden($db);
    }

    public function zahlungskontoSpeichern(mixed $daten = []): array
    {
        $db = $this->db();
        brauche($this->ctx, 'admin');
        $d = is_array($daten) ? $daten : [];
        $konto = ['name' => kuerze(tr($d['name'] ?? ''), 70), 'iban' => iban_normalisieren($d['iban'] ?? ''), 'bic' => bic_normalisieren($d['bic'] ?? '')];
        // ganz leer = Konto entfernen
        if ($konto['iban'] !== '' || $konto['name'] !== '' || $konto['bic'] !== '') {
            pruefe($konto['name'] !== '', 'Bitte den Namen des Kontoinhabers angeben.');
            pruefe(iban_fehler($konto['iban']) === null, 'IBAN des Zahlungskontos: ' . iban_fehler($konto['iban']));
            pruefe(bic_gueltig($konto['bic']), 'Der BIC des Zahlungskontos ist ungültig.');
        }
        upsert($db, 'einstellungen', ['schluessel' => 'zahlungskonto', 'wert' => json_text($konto)], ['schluessel']);
        $this->log('warnung', 'einstellungen', 'Zahlungskonto geändert: ' . ($konto['iban'] !== '' ? $konto['name'] . ', IBAN …' . substr($konto['iban'], -4) : 'entfernt'));
        return zahlungskonto_laden($db);
    }

    /** PDF (im Browser erstellt) als Anhang an die eigene E-Mail-Adresse schicken */
    public function pdfMailen(mixed $dateiname = null, mixed $inhalt = null, mixed $titel = null): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'buchhaltung');
        $e = mail_einstellungen($db);
        pruefe($e['aktiv'], 'Der E-Mail-Versand ist nicht eingerichtet (Admin → E-Mail).');
        $name = s($dateiname);
        pruefe(preg_match('/^[\w.-]{1,100}\.pdf$/', $name) === 1, 'Ungültiger Dateiname.');
        $pdf = base64_decode(s($inhalt), true);
        pruefe($pdf !== false && str_starts_with($pdf, '%PDF-'), 'Die Datei ist kein PDF.');
        pruefe(strlen($pdf) <= PDF_MAX, 'Das PDF ist zu groß zum Verschicken. Bitte herunterladen.', 413);
        try {
            mail_sofort($e, $n['email'], mail_pdf($db, $n['vorname'], kuerze(tr($titel), 200) ?: $name, $name), [[$name, 'application/pdf', $pdf]]);
        } catch (Throwable $f) {
            $this->log('fehler', 'mail', 'PDF-Mail nicht verschickt: ' . $f->getMessage());
            throw new Fehler('E-Mail konnte nicht verschickt werden: ' . $f->getMessage(), 502);
        }
        $this->log('info', 'zahlung', "PDF per E-Mail an sich geschickt: $name");
        return ['an' => $n['email']];
    }

    public function testMail(mixed $an = null): array
    {
        $db = $this->db();
        $n = brauche($this->ctx, 'admin');
        $e = mail_einstellungen($db);
        pruefe($e['host'] !== '' && $e['absender'] !== '', 'Bitte zuerst SMTP-Server und Absender-Adresse speichern.');
        $ziel = strtolower(tr($an)) ?: $n['email'];
        pruefe(ist_email($ziel), 'Bitte eine gültige E-Mail-Adresse angeben.');
        try {
            mail_sofort($e, $ziel, mail_test($db, $ziel));
        } catch (Throwable $f) {
            $this->log('fehler', 'mail', 'Test-E-Mail nicht verschickt: ' . $f->getMessage());
            throw new Fehler('Test-E-Mail konnte nicht verschickt werden: ' . $f->getMessage(), 502);
        }
        return ['an' => $ziel];
    }
}

// ------------------------------------------------------------------ interne Helfer

/**
 * Angaben zum Betreiber prüfen. Ändern sich Name, Anschrift, Hoster oder „nicht angestellt“, gilt ein neuer
 * Stand – dann müssen alle den Hinweis noch einmal zur Kenntnis nehmen.
 */
function betreiber_pruefen(array $alt, mixed $neu): array
{
    if (!is_array($neu)) return $alt;
    $b = [
        'name' => kuerze(tr($neu['name'] ?? ''), 150),
        'anschrift' => kuerze(trim(str_replace("\r", '', s($neu['anschrift'] ?? ''))), 300),
        'email' => strtolower(tr($neu['email'] ?? '')),
        'telefon' => kuerze(tr($neu['telefon'] ?? ''), 50),
        'extern' => (bool) ($neu['extern'] ?? true),
        'hoster' => kuerze(tr($neu['hoster'] ?? '') ?: STANDARD_HOSTER, 300),
        'zusatz_impressum' => kuerze(trim(str_replace("\r", '', s($neu['zusatz_impressum'] ?? ''))), 5000),
        'zusatz_datenschutz' => kuerze(trim(str_replace("\r", '', s($neu['zusatz_datenschutz'] ?? ''))), 5000),
    ];
    pruefe($b['email'] === '' || ist_email($b['email']), 'Bitte eine gültige E-Mail-Adresse des Betreibers angeben.');
    $wichtig = ['name', 'anschrift', 'extern', 'hoster'];
    $geaendert = array_filter($wichtig, fn ($k) => $b[$k] !== $alt[$k]);
    $b['stand'] = $geaendert || $alt['stand'] === '' ? jetzt() : $alt['stand'];
    return $b;
}

/** Zwei-Faktor für dieses Konto eingeschaltet? */
function zwei_faktor_aktiv(PDO $db, string $nutzerId): bool
{
    return (string) wert($db, 'select zwei_faktor from nutzer where id = ?', [$nutzerId]) !== '';
}

/** Code aus der App (jeder nur einmal) oder ein Ersatz-Code (wird danach gestrichen) */
function zwei_faktor_code_ok(PDO $db, array $z, string $code): bool
{
    $schritt = totp_pruefen((string) $z['zwei_faktor'], $code);
    if ($schritt !== null && $schritt > (int) $z['zwei_faktor_schritt']) {
        q($db, 'update nutzer set zwei_faktor_schritt = ? where id = ?', [$schritt, $z['id']]);
        return true;
    }
    $codes = json_decode((string) $z['zwei_faktor_codes'], true) ?: [];
    $h = hash('sha256', strtolower(trim($code)));
    if (!in_array($h, $codes, true)) return false;
    q($db, 'update nutzer set zwei_faktor_codes = ? where id = ?', [json_text(array_values(array_diff($codes, [$h]))), $z['id']]);
    protokoll($db, 'warnung', 'anmeldung', 'Mit Ersatz-Code angemeldet (' . (count($codes) - 1) . ' übrig)', nutzer_aus_zeile($z));
    return true;
}

function zahlungskonto_laden(PDO $db): array
{
    $k = json_decode((string) wert($db, "select wert from einstellungen where schluessel = 'zahlungskonto'"), true);
    $leer = ['name' => '', 'iban' => '', 'bic' => ''];
    return array_merge($leer, is_array($k) ? array_intersect_key($k, $leer) : []);
}

function protokoll_aus_zeile(array $z): array
{
    return ['id' => (int) $z['id'], 'zeit' => $z['zeit'], 'stufe' => $z['stufe'], 'bereich' => $z['bereich'], 'text' => $z['text'], 'wer' => $z['wer'], 'ip' => $z['ip']];
}

/** Sicherungen im Ordner daten/backups, neueste zuerst */
function sicherungen_liste(): array
{
    $liste = [];
    foreach (glob(daten_ordner() . '/backups/honorarnoten-*.sql*') ?: [] as $f) {
        $liste[] = ['name' => basename($f), 'groesse' => (int) filesize($f), 'zeit' => zeit_iso((int) filemtime($f))];
    }
    usort($liste, fn ($a, $b) => strcmp($b['zeit'], $a['zeit']) ?: strcmp($b['name'], $a['name']));
    return $liste;
}

function sicherung_pfad(string $name): ?string
{
    if (!preg_match('/^honorarnoten-[\d-]+\.(sqlite|sql)$/', $name)) return null;
    $pfad = daten_ordner() . '/backups/' . $name;
    return is_file($pfad) ? $pfad : null;
}

const LINK_ANMELDEN_TAGE = 7;
const PASSWORT_LINK = 'passwort-vergessen'; // Merkmal der Links aus „Passwort vergessen“
const LINK_TAGE = [1, 3, 7, 14, 30]; // wählbare Gültigkeit der Registrierungslinks
const LINK_ROLLEN = ['autor', 'redigieren', 'redaktion', 'buchhaltung']; // Admin nie per Link

/** Neuer Link; gespeichert wird nur der Hash, der Token steht danach nirgends mehr */
function link_erstellen(PDO $db, string $art, array $w): string
{
    $token = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    q($db, 'insert into links (id, token_hash, art, nutzer_id, rollen, max_nutzungen, gueltig_bis, notiz, erstellt_von, erstellt_am)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        neue_id(), token_hash($token), $art, $w['nutzer_id'] ?? null, json_text($w['rollen'] ?? []), $w['max'] ?? null,
        zeit_iso(time() + ($w['sekunden'] ?? $w['tage'] * 86400)), $w['notiz'] ?? '', $w['von'] ?? '', jetzt(),
    ]);
    return $token;
}

/** Der Link, wenn er (noch) gilt – sonst eine verständliche Meldung */
function link_pruefen(PDO $db, mixed $token, string $art): array
{
    $t = s($token);
    $l = $t !== '' && strlen($t) <= 100 ? zeile($db, 'select * from links where token_hash = ? and art = ?', [token_hash($t), $art]) : null;
    pruefe($l, 'Dieser Link ist ungültig. Bitte prüfe, ob er vollständig kopiert wurde.', 404);
    $verbraucht = $l['max_nutzungen'] !== null && (int) $l['nutzungen'] >= (int) $l['max_nutzungen'];
    if ($art === 'anmelden') {
        pruefe(!$l['widerrufen_am'] && !$verbraucht, 'Dieser Anmeldelink wurde schon verwendet. Bitte melde dich mit E-Mail und Passwort an.', 410);
        pruefe(strtotime($l['gueltig_bis']) >= time(), 'Dieser Anmeldelink ist abgelaufen. Bitte melde dich mit E-Mail und Startpasswort an.', 410);
    } else {
        pruefe(!$l['widerrufen_am'], 'Dieser Registrierungslink wurde zurückgezogen. Bitte frag nach einem neuen.', 410);
        pruefe(strtotime($l['gueltig_bis']) >= time(), 'Dieser Registrierungslink ist abgelaufen. Bitte frag nach einem neuen.', 410);
        pruefe(!$verbraucht, 'Dieser Registrierungslink wurde schon so oft verwendet wie erlaubt. Bitte frag nach einem neuen.', 410);
    }
    return $l;
}

function anmeldelinks_widerrufen(PDO $db, string $nutzerId): void
{
    q($db, "update links set widerrufen_am = ? where nutzer_id = ? and art = 'anmelden' and widerrufen_am is null", [jetzt(), $nutzerId]);
}

/** Info an alte und neue Adresse, dass die E-Mail-Adresse geändert wurde (Schutz vor unbemerkter Übernahme) */
function email_geaendert_melden(PDO $db, string $vorname, string $alt, string $neu): bool
{
    if (!mail_einstellungen($db)['aktiv']) return false;
    foreach ([$alt, $neu] as $an) mail_einreihen($db, $an, mail_email_geaendert($db, $vorname, $alt, $neu));
    return true;
}

function zugang_melden(PDO $db, array $z, bool $neu = true): array
{
    // Link zum direkten Anmelden (einmal, 7 Tage); ältere Links dieses Kontos gelten nicht mehr
    anmeldelinks_widerrufen($db, $z['id']);
    $z['link'] = app_link($db, 'link/' . link_erstellen($db, 'anmelden', ['nutzer_id' => $z['id'], 'max' => 1, 'tage' => LINK_ANMELDEN_TAGE]));
    $e = mail_einstellungen($db);
    $z['mail'] = $e['aktiv'] && $e['zugangsdaten'];
    if ($z['mail']) $z['mail_id'] = mail_einreihen($db, $z['email'], mail_zugang($db, $z, $neu));
    return $z;
}

/**
 * Zugangs-Mail sofort verschicken (nach dem Speichern, außerhalb der Transaktion), damit der Admin das Ergebnis
 * sieht: mail_fehler leer = verschickt, sonst die Meldung des Mailservers (weitere Versuche folgen automatisch).
 */
function zugang_senden(PDO $db, array $z): array
{
    $id = $z['mail_id'] ?? null;
    unset($z['mail_id']);
    if (!$id) return $z;
    $z['mail_fehler'] = mail_jetzt_senden($db, $id) ?? '';
    if ($z['mail_fehler'] === '') protokoll($db, 'info', 'mail', "Zugangs-Mail an {$z['email']} verschickt");
    return $z;
}

/**
 * Leistungen einer abgelehnten Note zurück in „Mein Monat“ der Autor:in (mit eingereichtem Betrag,
 * Medium, Artikel-Link und der Begründung als Hinweis). Die Note gilt danach als zurückgeholt.
 */
function zurueck_an_autor(PDO $db, array $note, array $akteur): void
{
    if ($note['autor_id'] && wert($db, 'select 1 from nutzer where id = ?', [$note['autor_id']])) {
        $einf = $db->prepare('insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe,
                vereinbart_mit, notiz, betrag_cent, artikel_url, medium, anzahl, zurueck_nummer, zurueck_grund, erstellt_am)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($note['positionen'] as $p) {
            $neu = neue_id();
            if ($p['kategorie'] === 'redigieren') nachweise_kopieren($db, $p['id'], $neu);
            $einf->execute([$neu, $note['autor_id'], $p['kategorie'], $p['art'], $p['kolumnenart'], $p['titel'], $p['veroeffentlichung'],
                $p['ausgabe'], $p['vereinbart_mit'], $p['notiz'], cent($p['betrag_eingereicht']), $p['artikel_url'], $note['medium'],
                (int) ($p['anzahl'] ?? 0), $note['nummer'], $note['ablehnungsgrund'] ?? '', jetzt()]);
        }
    }
    q($db, 'update noten set zurueckgeholt_am = ? where id = ?', [jetzt(), $note['id']]);
    verlauf_eintragen($db, $note['id'], $akteur, 'zurueckgeholt');
}

/**
 * Artikel-Adressen, die schon erfasst sind: gespeicherte Leistungen und abgeschickte Prämienabrechnungen.
 * Ausgenommen sind abgelehnte Noten, deren Leistungen zurückgeholt wurden (die stehen wieder in den Leistungen).
 */
function verwendete_artikel(PDO $db, string $autorId, ?string $ohnePosition = null): array
{
    $urls = q($db, "select artikel_url u from positionen where autor_id = ? and artikel_url <> '' and (? is null or id <> ?)
        union select np.artikel_url from note_positionen np join noten n on n.id = np.note_id
        where n.autor_id = ? and np.artikel_url <> '' and not (n.status = 'abgelehnt' and n.zurueckgeholt_am is not null)",
        [$autorId, $ohnePosition, $ohnePosition, $autorId])->fetchAll(PDO::FETCH_COLUMN);
    return array_flip($urls);
}

function naechste_nummer(PDO $db, array $n, ?int $jahr = null): array
{
    $jahr ??= (int) substr(heute_iso(), 0, 4);
    $m = (int) wert($db, 'select coalesce(max(laufende_nummer), 0) from noten where autor_id = ? and jahr = ?', [$n['id'], $jahr]);
    // selbst gesetzte Nummer gilt nur im Jahr, für das sie eingetragen wurde
    [$basisJahr, $basis] = array_map('intval', explode(':', ($n['nummer_basis'] ?? '') ?: '0:0') + [1 => 0]);
    $bisher = max($m, $basisJahr === $jahr ? $basis : 0);
    $laufend = $bisher + 1;
    return ['jahr' => $jahr, 'laufendeNummer' => $laufend, 'bisher' => $bisher, 'in_app' => $m,
        'nummer' => honorarnote_nummer($n['vorname'], $n['nachname'], $jahr, $laufend)];
}

function noch_ein_admin(PDO $db, string $ohne): bool
{
    foreach (zeilen($db, 'select rollen from nutzer where id <> ? and aktiv = 1', [$ohne]) as $z) {
        if (in_array('admin', json_decode($z['rollen'], true) ?: [], true)) return true;
    }
    return false;
}

function konto_einfuegen(PDO $db, string $vorname, string $nachname, string $email, array $rollen, string $hash): string
{
    $id = neue_id();
    q($db, 'insert into nutzer (id, email, vorname, nachname, rollen, aktiv, muss_passwort_aendern, passwort, kontoinhaber, erstellt_am)
            values (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)',
        [$id, $email, kuerze(tr($vorname), 100), kuerze(tr($nachname), 100), json_text($rollen), $hash,
            kuerze(tr(tr($vorname) . ' ' . tr($nachname)), 70), jetzt()]);
    return $id;
}

/** Für Kommandozeile und Einrichtung: erstes Admin-Konto anlegen */
function admin_anlegen(PDO $db, string $email, string $vorname = '', string $nachname = ''): array
{
    $email = strtolower(tr($email));
    pruefe(ist_email($email), 'Bitte eine gültige E-Mail-Adresse angeben.');
    pruefe(!wert($db, 'select 1 from nutzer where email = ?', [$email]), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
    $passwort = startpasswort();
    konto_einfuegen($db, $vorname ?: 'Admin', $nachname, $email, ['admin'], passwort_hash($passwort));
    return ['email' => $email, 'passwort' => $passwort];
}
