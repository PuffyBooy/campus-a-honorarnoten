<?php
// Für die Tests: ruft PHP-Funktionen des Servers mit Argumenten aus JSON auf (stdin) und gibt die Ergebnisse als JSON aus.
//   [{"fn": "iban_fehler", "args": ["AT61…"]}, …]
// Sonderfall "artikel_von_profil": {"db": Datei, "seiten": {url: html}, "args": [profilId, medium, neu]}
//   liefert {"artikel": […], "abrufe": [url, …]}
declare(strict_types=1);

require_once __DIR__ . '/../../server/lib/app.php';

const ERLAUBT = [
    'iban_fehler', 'iban_formatieren', 'bic_gueltig', 'namensteil', 'initialen', 'honorarnote_nummer', 'profil_id_aus_link',
    'profil_link', 'medium_von_artikel', 'medium_oder', 'medium_name', 'konto_fehlt', 'rollen_normalisieren', 'darf_redigieren',
    'saetze_normalisieren', 'text_anzahl', 'art_normalisieren', 'liste_parsen', 'artikel_parsen', 'redigier_text', 'html_text',
    'verbundene_medien', 'betrag_text', 'datum_text',
];

$aufrufe = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$ergebnisse = [];
foreach ($aufrufe as $a) {
    try {
        if ($a['fn'] === 'artikel_von_profil') {
            $abrufe = [];
            $holen = function (array $urls) use ($a, &$abrufe) {
                $r = [];
                foreach ($urls as $u) {
                    $abrufe[] = $u;
                    $r[$u] = $a['seiten'][$u] ?? new RuntimeException("HTTP 404 für $u");
                }
                return $r;
            };
            [$profil, $medium, $neu] = $a['args'] + [1 => 'college', 2 => false];
            $artikel = artikel_von_profil(oeffne_datenbank($a['db']), $profil, $medium, $holen, (bool) $neu);
            $ergebnisse[] = ['ok' => ['artikel' => $artikel, 'abrufe' => $abrufe]];
            continue;
        }
        if (!in_array($a['fn'], ERLAUBT, true)) throw new RuntimeException('nicht erlaubt: ' . $a['fn']);
        $ergebnisse[] = ['ok' => ($a['fn'])(...$a['args'])];
    } catch (Throwable $e) {
        $ergebnisse[] = ['fehler' => $e->getMessage()];
    }
}
echo json_encode($ergebnisse, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
