<?php
// Artikel einer Autor:in von campus-a-college.at bzw. campus-a.at holen.
//
// Die Seiten laufen mit TYPO3 und haben keine Schnittstelle für Artikeldaten. Deshalb werden die
// normalen Seiten ausgelesen:
//   /profil/<ID>?fetchNews=1   Liste der veröffentlichten Artikel (12 pro Seite, mit Seiten-Links)
//   /news/detail/<name>        Artikelseite mit Datum, Ressort und Kategorie (z. B. „Meinung“);
//                              auf campus-a.at heißt der Pfad /news/news-detail/<name>
// Artikeldaten ändern sich kaum und werden in der Datenbank zwischengespeichert, die Liste pro
// Profil für einige Minuten.
declare(strict_types=1);

const ARTIKEL_MAX_SEITEN = 50;
const ARTIKEL_MAX = 600;
const ARTIKEL_GLEICHZEITIG = 6;
const ARTIKEL_LISTE_GUELTIG = 600;   // Sekunden
const ARTIKEL_TIMEOUT = 15;          // Sekunden pro Seite
const ARTIKEL_ZEITBUDGET = 20;       // Sekunden für Artikelseiten pro Aufruf (Rest beim nächsten Mal)

/** HTML -> Text: Tags weg, Entitäten auflösen, Leerraum zusammenfassen */
function html_text(?string $html): string
{
    $t = preg_replace('/<[^>]*>/', ' ', (string) $html) ?? '';
    $t = preg_replace_callback('/&(#x[0-9a-f]+|#\d+);/i', function ($m) {
        $e = $m[1];
        $code = ($e[1] === 'x' || $e[1] === 'X') ? hexdec(substr($e, 2)) : (int) substr($e, 1);
        return $code > 0 && $code < 0x110000 ? mb_chr((int) $code, 'UTF-8') : ' ';
    }, $t) ?? $t;
    $t = html_entity_decode($t, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = str_replace("\u{00AD}", '', $t);
    return tr(preg_replace('/[\s\p{Z}]+/u', ' ', $t) ?? '');
}

function absolut(string $basis, string $pfad): string
{
    return $basis . str_replace('&amp;', '&', $pfad);
}

/** Artikelliste einer Profilseite: ['artikel' => [{url, titel, ressort}], 'seiten' => [url]] */
function liste_parsen(string $html, string $medium = STANDARD_MEDIUM): array
{
    $basis = MEDIEN[$medium]['basis'];
    $start = strpos($html, 'id="newsSection"');
    $bereich = $start !== false ? substr($html, $start) : $html;
    $artikel = [];
    $gesehen = [];
    $karte = '~news-card-kicker">([\s\S]*?)</span>\s*</span>[\s\S]*?<a class="news-card-title-link"[^>]*href="(/news/(?:news-)?detail/[^"?#]+)"[^>]*>([\s\S]*?)</a>~';
    preg_match_all($karte, $bereich, $treffer, PREG_SET_ORDER);
    foreach ($treffer as $m) {
        $url = absolut($basis, $m[2]);
        if (medium_von_artikel($url) !== $medium || isset($gesehen[$url])) continue;
        $gesehen[$url] = true;
        $artikel[] = ['url' => $url, 'titel' => kuerze(html_text($m[3]), 200), 'ressort' => kuerze(html_text($m[1]), 100)];
    }
    preg_match_all('~href="(/profil/[0-9a-f]+\?fetchNews=1&amp;[^"]*currentPage[^"]*)"~', $bereich, $s);
    $seiten = array_values(array_unique(array_map(fn ($p) => absolut($basis, $p), $s[1])));
    return ['artikel' => $artikel, 'seiten' => $seiten];
}

/** Artikelseite: Titel, Datum (JJJJ-MM-TT), Ressort, Region und Kategorie – oder null */
function artikel_parsen(string $html): ?array
{
    $start = strpos($html, '<article');
    if ($start === false) return null;
    $h1 = strpos($html, '<h1', $start);
    if ($h1 === false) return null;
    $kopfHtml = substr($html, $start, $h1 - $start);
    preg_match_all('~<span class="after:[^"]*">([\s\S]*?)</span>~', $kopfHtml, $k);
    $kopf = array_values(array_filter(array_map('html_text', $k[1]), fn ($x) => $x !== ''));
    $kategorie = preg_match('~<a[^>]*href="/kategorien/[^"]*"[^>]*>([\s\S]*?)</a>~', $kopfHtml, $km) ? html_text($km[1]) : '';
    $titel = preg_match('~<h1[^>]*>([\s\S]*?)</h1>~', substr($html, $h1), $tm) ? html_text($tm[1]) : '';
    $d = preg_match('~>\s*(\d{2})\.(\d{2})\.(\d{4})\s*<~', substr($html, $h1, 20000), $dm);
    $region = implode(', ', array_filter(array_slice($kopf, 1), fn ($x) => $x !== $kategorie));
    return [
        'titel' => kuerze($titel, 200),
        'datum' => $d ? "{$dm[3]}-{$dm[2]}-{$dm[1]}" : '',
        'ressort' => kuerze($kopf[0] ?? '', 100),
        'region' => kuerze($region, 100),
        'kategorie' => kuerze($kategorie, 100),
    ];
}

/**
 * Seiten abrufen (mehrere gleichzeitig). Liefert [url => html] und für nicht erreichbare Seiten [url => Exception].
 * Für Tests: Umgebungsvariable HONORARE_CAMPUS_TEST = Adresse eines Ersatzservers (bekommt ?url=…).
 */
function standard_holen(array $urls, ?float $bis = null): array
{
    $ersatz = getenv('HONORARE_CAMPUS_TEST') ?: '';
    $ergebnis = [];
    $offen = array_values(array_unique($urls));
    $multi = curl_multi_init();
    $laufend = [];
    $starten = function () use (&$offen, &$laufend, $multi, $ersatz, $bis) {
        while ($offen && count($laufend) < ARTIKEL_GLEICHZEITIG && ($bis === null || microtime(true) < $bis)) {
            $url = array_shift($offen);
            $ziel = $ersatz ? $ersatz . '?url=' . rawurlencode($url) : $url;
            $c = curl_init($ziel);
            curl_setopt_array($c, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_TIMEOUT => ARTIKEL_TIMEOUT,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_USERAGENT => 'campus-a-honorarnoten (Anerkennungsprämien-App)',
                CURLOPT_HTTPHEADER => ['Accept: text/html'],
                CURLOPT_ENCODING => '',
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            ]);
            curl_multi_add_handle($multi, $c);
            $laufend[(int) $c] = [$c, $url];
        }
    };
    $starten();
    while ($laufend) {
        curl_multi_exec($multi, $aktiv);
        curl_multi_select($multi, 0.5);
        while ($info = curl_multi_info_read($multi)) {
            $c = $info['handle'];
            [, $url] = $laufend[(int) $c];
            $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
            if ($info['result'] !== CURLE_OK) {
                $ergebnis[$url] = new RuntimeException(curl_error($c) ?: "nicht erreichbar: $url");
            } elseif ($status !== 200) {
                $ergebnis[$url] = new RuntimeException("HTTP $status für $url");
            } else {
                $ergebnis[$url] = (string) curl_multi_getcontent($c);
            }
            curl_multi_remove_handle($multi, $c);
            curl_close($c);
            unset($laufend[(int) $c]);
            $starten();
        }
    }
    curl_multi_close($multi);
    return $ergebnis;
}

/** Eine Seite holen oder Exception werfen */
function seite_holen(callable $holen, string $url): string
{
    $r = $holen([$url])[$url] ?? new RuntimeException("nicht erreichbar: $url");
    if ($r instanceof Throwable) throw $r;
    return $r;
}

/** Seitennummer einer Listen-Adresse: dieselbe Seite kann unter verschiedenen Links auftauchen */
function seiten_nr(string $url): string
{
    return preg_match('/tx_news_pi1\[currentPage\]=(\d+)/', rawurldecode($url), $m) ? $m[1] : '1';
}

/**
 * Artikelliste eines Profils über alle Seiten. Ist die Liste schon bekannt, wird nur so weit geblättert,
 * bis eine Seite nur noch bekannte Artikel enthält – neue Artikel stehen ganz vorne.
 */
function liste_holen(string $medium, string $profilId, callable $holen, ?array $bisherige): array
{
    $offen = [MEDIEN[$medium]['basis'] . "/profil/$profilId?fetchNews=1"];
    $bekannt = array_flip(array_column($bisherige ?? [], 'url'));
    $besucht = [];
    $artikel = [];
    while ($offen && count($besucht) < ARTIKEL_MAX_SEITEN && count($artikel) < ARTIKEL_MAX) {
        $url = array_shift($offen);
        if (isset($besucht[seiten_nr($url)])) continue;
        $besucht[seiten_nr($url)] = true;
        $l = liste_parsen(seite_holen($holen, $url), $medium);
        foreach ($l['artikel'] as $x) $artikel[$x['url']] ??= $x;
        if ($bisherige !== null && $l['artikel'] && !array_filter($l['artikel'], fn ($x) => !isset($bekannt[$x['url']]))) {
            foreach ($bisherige as $x) $artikel[$x['url']] ??= $x;
            break;
        }
        foreach ($l['seiten'] as $s) if (!isset($besucht[seiten_nr($s)])) $offen[] = $s;
    }
    return array_values($artikel);
}

/**
 * Alle Artikel eines Profils, neueste zuerst: [{url, medium, titel, datum, ressort, region, kategorie}].
 * Beim ersten Mal werden die Artikelseiten gelesen, danach kommen Datum und Kategorie aus der Datenbank.
 * $neu = true: Liste sofort auf neue Artikel prüfen. Wirft, wenn die Seite nicht erreichbar ist.
 */
function artikel_von_profil(PDO $db, string $profilId, string $medium = STANDARD_MEDIUM, ?callable $holen = null, bool $neu = false): array
{
    $holen ??= 'standard_holen';
    $schluessel = "$medium:$profilId";
    $cache = zeile($db, 'select zeit, artikel from artikel_listen where schluessel = ?', [$schluessel]);
    $bisher = $cache ? json_decode($cache['artikel'], true) : null;
    $liste = $bisher;
    if (!$cache || $neu || time() - (int) $cache['zeit'] >= ARTIKEL_LISTE_GUELTIG) {
        $liste = liste_holen($medium, $profilId, $holen, $bisher);
        upsert($db, 'artikel_listen', ['schluessel' => $schluessel, 'zeit' => time(), 'artikel' => json_text($liste)], ['schluessel']);
    }

    $details = [];
    $fehlend = [];
    foreach ($liste as $a) {
        $z = zeile($db, 'select * from artikel where url = ?', [$a['url']]);
        if ($z && $z['datum'] !== '') $details[$a['url']] = $z;
        else $fehlend[] = $a;
    }
    if ($fehlend) {
        // einzelne Artikelseite nicht erreichbar: Artikel trotzdem anzeigen, beim nächsten Mal erneut versuchen
        $seiten = $holen(array_column($fehlend, 'url'), microtime(true) + ARTIKEL_ZEITBUDGET);
        foreach ($fehlend as $a) {
            $html = $seiten[$a['url']] ?? null;
            if (!is_string($html)) continue;
            $d = artikel_parsen($html);
            if (!$d || $d['datum'] === '') continue;
            $d['titel'] = $d['titel'] ?: $a['titel'];
            $d['ressort'] = $d['ressort'] ?: $a['ressort'];
            upsert($db, 'artikel', ['url' => $a['url'], 'titel' => $d['titel'], 'datum' => $d['datum'], 'ressort' => $d['ressort'],
                'region' => $d['region'], 'kategorie' => $d['kategorie'], 'geholt_am' => jetzt()], ['url']);
            $details[$a['url']] = $d;
        }
    }

    $ergebnis = array_map(function ($a) use ($details, $medium) {
        $d = $details[$a['url']] ?? [];
        return [
            'url' => $a['url'],
            'medium' => $medium,
            'titel' => ($d['titel'] ?? '') ?: $a['titel'],
            'datum' => $d['datum'] ?? '',
            'ressort' => ($d['ressort'] ?? '') ?: $a['ressort'],
            'region' => $d['region'] ?? '',
            'kategorie' => $d['kategorie'] ?? '',
        ];
    }, $liste);
    usort($ergebnis, fn ($x, $y) => strcmp($y['datum'], $x['datum'])); // ohne Datum ans Ende
    return $ergebnis;
}
