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
const ARTIKEL_DOPPELT = 'Dieser Artikel ist schon als Leistung gespeichert oder abgerechnet.';

/** Kontext einer Anfrage */
final class Ctx
{
    public ?string $neueSitzung = null;
    public bool $sitzungLoeschen = false;
    public bool $erlaubtMitStartpasswort = false;
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
        // „auftraggeber“: früheres SEPA-Konto, „mail“: eigene Einstellungen (mit Passwort, nie an den Browser)
        if (in_array($z['schluessel'], ['auftraggeber', 'mail'], true)) continue;
        $e[$z['schluessel']] = json_decode($z['wert'], true);
    }
    $e['honorarsaetze'] = saetze_normalisieren($e['honorarsaetze']); // ältere Sätze ohne Medium gelten für beide
    $e['betreiber'] = array_merge(BETREIBER_STANDARD, array_intersect_key(is_array($e['betreiber']) ? $e['betreiber'] : [], BETREIBER_STANDARD));
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
    ];
}

function note_aus_zeile(PDO $db, array $z): array
{
    $positionen = array_map('position_aus_zeile', zeilen($db, 'select * from note_positionen where note_id = ? order by reihenfolge', [$z['id']]));
    return [
        'id' => $z['id'], 'nummer' => $z['nummer'], 'jahr' => (int) $z['jahr'], 'laufende_nummer' => (int) $z['laufende_nummer'],
        'monat' => $z['monat'], 'medium' => medium_oder($z['medium']), 'autor_id' => $z['autor_id'], 'status' => $z['status'],
        'eingereicht_am' => $z['eingereicht_am'], 'entschieden_am' => $z['entschieden_am'], 'bezahlt_am' => $z['bezahlt_am'],
        'ablehnungsgrund' => $z['ablehnungsgrund'], 'zurueckgeholt_am' => $z['zurueckgeholt_am'],
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

function noten_liste(PDO $db, array $n, string $where = '', array $params = [], string $order = 'eingereicht_am desc'): array
{
    return array_map(fn ($z) => sicht($n, note_aus_zeile($db, $z)), zeilen($db, "select * from noten $where order by $order", $params));
}

function verlauf_eintragen(PDO $db, string $noteId, array $n, string $aktion, array $details = []): void
{
    q($db, 'insert into verlauf (id, note_id, akteur_id, akteur_name, aktion, details, am) values (?, ?, ?, ?, ?, ?, ?)',
        [neue_id(), $noteId, $n['id'], anzeigename($n), $aktion, json_text((object) $details), jetzt()]);
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
        'profilSpeichern', 'einstellungen', 'meineLeistungen', 'leistungSpeichern', 'leistungLoeschen', 'meineArtikel',
        'naechsteNummer', 'notenDiesenMonat', 'abrechnungAbschicken', 'meineNoten', 'leistungenZurueckholen',
        'alleNoten', 'note', 'annehmen', 'ablehnen', 'betragKorrigieren', 'kommentieren', 'kommentare', 'verlaufVon',
        'offeneZahlungen', 'bezahlteNoten', 'bezahlteNotenSeit', 'alsBezahltMarkieren', 'alleAlsBezahltMarkieren',
        'anfragen', 'offeneAnfragenAnzahl', 'anfrageFreischalten', 'anfrageAblehnen', 'nutzerAnlegen', 'nutzerListe',
        'rollenSetzen', 'nutzerAktivSetzen', 'passwortZuruecksetzen', 'nutzerLoeschen', 'alleNotenAdmin', 'noteLoeschen',
        'loeschprotokoll', 'einstellungenSpeichern', 'statistik', 'exportieren',
        'mailEinstellungen', 'mailEinstellungenSpeichern', 'testMail', 'rechtliches', 'hinweisBestaetigen', 'benachrichtigungenSpeichern',
    ];

    /** ohne Anmeldung erlaubt (Impressum und Datenschutz müssen für alle lesbar sein) */
    public const OEFFENTLICH = ['aktuellerNutzer', 'anmelden', 'abmelden', 'zugangAnfragen', 'rechtliches'];

    public function __construct(private Ctx $ctx)
    {
    }

    private function db(): PDO
    {
        return $this->ctx->db;
    }

    // ---------------------------------------------------------------- Sitzung
    public function aktuellerNutzer(): ?array
    {
        return $this->ctx->nutzer;
    }

    public function anmelden(mixed $email = null, mixed $passwort = null): array
    {
        $db = $this->db();
        $z = zeile($db, 'select * from nutzer where email = ?', [strtolower(tr($email))]);
        // auch bei unbekannter E-Mail rechnen, damit man Konten nicht an der Antwortzeit erkennt
        $ok = passwort_passt($z['passwort'] ?? null, s($passwort));
        pruefe($z && $ok, 'E-Mail oder Passwort ist falsch.', 401);
        pruefe($z['aktiv'], 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.', 403);
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
            q($db, 'insert into anfragen (id, vorname, nachname, email, nachricht, am) values (?, ?, ?, ?, ?, ?)',
                [neue_id(), $a['vorname'], $a['nachname'], $email, $a['nachricht'], jetzt()]);
            benachrichtigen($db, 'anfrage', mail_anfrage_admin($db, $a));
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
        return array_map(
            fn ($p) => position_aus_zeile($p + ['betrag_eingereicht_cent' => $p['betrag_cent'], 'betrag_vermerk' => '']),
            zeilen($this->db(), 'select * from positionen where autor_id = ? order by veroeffentlichung, erstellt_am', [$n['id']]),
        );
    }

    public function leistungSpeichern(mixed $daten = []): bool
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
        } else {
            pruefe((int) wert($db, 'select count(*) from positionen where autor_id = ?', [$n['id']]) < 500, 'Zu viele gespeicherte Leistungen.');
            q($db, 'insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe, vereinbart_mit,
                    notiz, betrag_cent, artikel_url, medium, anzahl, erstellt_am) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [neue_id(), $n['id'], ...$werte, jetzt()]);
        }
        return true;
    }

    public function leistungLoeschen(mixed $pid = null): bool
    {
        $n = brauche($this->ctx, 'autor');
        $r = q($this->db(), 'delete from positionen where id = ? and autor_id = ?', [s($pid), $n['id']]);
        pruefe($r->rowCount() === 1, 'Diese Leistung gibt es nicht (mehr).', 404);
        return true;
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

    // ---------------------------------------------------------------- Redaktion
    public function alleNoten(): array
    {
        return noten_liste($this->db(), brauche($this->ctx, 'redaktion'));
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
            q($db, "update noten set status = 'angenommen', ablehnungsgrund = '', entschieden_am = ? where id = ?", [jetzt(), $x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'angenommen', ['vorher' => $x['status']]);
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
            q($db, "update noten set status = 'abgelehnt', ablehnungsgrund = ?, entschieden_am = ? where id = ?", [$g, jetzt(), $x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'abgelehnt', ['vorher' => $x['status'], 'grund' => $g]);
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
            return true;
        });
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
            q($db, "update noten set status = 'bezahlt', bezahlt_am = ? where id = ?", [$d, $x['id']]);
            verlauf_eintragen($db, $x['id'], $n, 'bezahlt', ['datum' => $d]);
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
        return transaktion($db, function () use ($db, $admin, $anfrageId, $r, $passwort, $hash) {
            $a = zeile($db, 'select * from anfragen where id = ?', [s($anfrageId)]);
            pruefe($a, 'Diese Anfrage gibt es nicht (mehr).', 404);
            pruefe($a['status'] === 'offen', 'Diese Anfrage wurde bereits bearbeitet.');
            pruefe(!wert($db, 'select 1 from nutzer where email = ?', [$a['email']]), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
            konto_einfuegen($db, $a['vorname'], $a['nachname'], $a['email'], $r, $hash);
            q($db, "update anfragen set status = 'freigeschaltet', bearbeitet_am = ?, bearbeitet_von = ? where id = ?", [jetzt(), anzeigename($admin), $a['id']]);
            return zugang_melden($db, ['email' => $a['email'], 'vorname' => $a['vorname'], 'passwort' => $passwort]);
        });
    }

    public function anfrageAblehnen(mixed $anfrageId = null): bool
    {
        $admin = brauche($this->ctx, 'admin');
        $r = q($this->db(), "update anfragen set status = 'abgelehnt', bearbeitet_am = ?, bearbeitet_von = ? where id = ? and status = 'offen'",
            [jetzt(), anzeigename($admin), s($anfrageId)]);
        pruefe($r->rowCount() === 1, 'Diese Anfrage wurde bereits bearbeitet.');
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
        return transaktion($db, function () use ($db, $d, $email, $r, $passwort, $hash) {
            pruefe(!wert($db, 'select 1 from nutzer where email = ?', [$email]), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
            konto_einfuegen($db, s($d['vorname']), s($d['nachname']), $email, $r, $hash);
            q($db, "update anfragen set status = 'freigeschaltet', bearbeitet_am = ? where email = ? and status = 'offen'", [jetzt(), $email]);
            return zugang_melden($db, ['email' => $email, 'vorname' => tr($d['vorname']), 'passwort' => $passwort]);
        });
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
        return zugang_melden($db, ['email' => $n['email'], 'vorname' => $n['vorname'], 'passwort' => $passwort], false);
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
            return true;
        });
    }

    // ---------------------------------------------------------------- Admin: Prämienabrechnungen & Einstellungen
    public function alleNotenAdmin(): array
    {
        return noten_liste($this->db(), brauche($this->ctx, 'admin'));
    }

    public function noteLoeschen(mixed $noteId = null): bool
    {
        $db = $this->db();
        $admin = brauche($this->ctx, 'admin');
        return transaktion($db, function () use ($db, $admin, $noteId) {
            $x = note_holen($db, $noteId);
            q($db, 'delete from noten where id = ?', [$x['id']]);
            q($db, 'insert into loeschprotokoll (id, nummer, geloescht_von, am) values (?, ?, ?, ?)', [neue_id(), $x['nummer'], anzeigename($admin), jetzt()]);
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
        $speichere = fn ($schluessel, $wert) => upsert($db, 'einstellungen', ['schluessel' => $schluessel, 'wert' => json_text($wert)], ['schluessel']);
        transaktion($db, function () use ($speichere, $e, $kontakt, $saetze, $betreiber) {
            $speichere('betreiber', $betreiber);
            $speichere('empfaenger', [
                'name' => kuerze(tr($e['name']), 150), 'strasse' => kuerze(tr($e['strasse'] ?? ''), 150),
                'plz_ort' => kuerze(tr($e['plz_ort'] ?? ''), 100), 'uid' => kuerze(tr($e['uid'] ?? ''), 30),
            ]);
            $speichere('datenschutzKontakt', $kontakt);
            $speichere('honorarsaetze', $saetze);
        });
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
            'nutzer' => array_map(function ($n) { unset($n['passwort']); return $n; }, $alle('nutzer')),
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
        return true;
    }

    /** Test-E-Mail sofort an die eigene Adresse (oder die angegebene) – mit verständlicher Fehlermeldung */
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

/** Startpasswort an das neue Konto schicken (wenn eingeschaltet); die Antwort sagt, ob eine Mail unterwegs ist */
function zugang_melden(PDO $db, array $z, bool $neu = true): array
{
    $e = mail_einstellungen($db);
    $z['mail'] = $e['aktiv'] && $e['zugangsdaten'];
    if ($z['mail']) mail_einreihen($db, $z['email'], mail_zugang($db, $z, $neu));
    return $z;
}

/**
 * Leistungen einer abgelehnten Note zurück in „Meine Leistungen“ der Autor:in (mit eingereichtem Betrag,
 * Medium, Artikel-Link und der Begründung als Hinweis). Die Note gilt danach als zurückgeholt.
 */
function zurueck_an_autor(PDO $db, array $note, array $akteur): void
{
    if ($note['autor_id'] && wert($db, 'select 1 from nutzer where id = ?', [$note['autor_id']])) {
        $einf = $db->prepare('insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe,
                vereinbart_mit, notiz, betrag_cent, artikel_url, medium, anzahl, zurueck_nummer, zurueck_grund, erstellt_am)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($note['positionen'] as $p) {
            $einf->execute([neue_id(), $note['autor_id'], $p['kategorie'], $p['art'], $p['kolumnenart'], $p['titel'], $p['veroeffentlichung'],
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
    $laufend = $m + 1;
    return ['jahr' => $jahr, 'laufendeNummer' => $laufend, 'nummer' => honorarnote_nummer($n['vorname'], $n['nachname'], $jahr, $laufend)];
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
