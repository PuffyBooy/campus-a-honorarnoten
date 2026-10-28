<?php
// Kleines PDF ohne Zusatzpakete: eine A4-Seite mit Text und Linien in Helvetica (für das Zahlungsavis).
// Umlaute und € über WinAnsi (Windows-1252), wie es die Standardschriften jedes PDF-Programms können.
declare(strict_types=1);

final class EinfachesPdf
{
    private string $inhalt = '';

    /** Text an Position (x, y) in Punkt, y von oben gemessen */
    public function text(float $x, float $y, string $text, float $groesse = 10, bool $fett = false, string $ausrichtung = 'links'): void
    {
        $t = self::winansi($text);
        if ($ausrichtung === 'rechts') $x -= self::breite($t, $groesse, $fett);
        $this->inhalt .= sprintf("BT /%s %.1F Tf %.2F %.2F Td (%s) Tj ET\n", $fett ? 'F2' : 'F1', $groesse, $x, 842 - $y, self::maskiert($t));
    }

    public function linie(float $x1, float $y1, float $x2, float $y2, float $staerke = 0.5): void
    {
        $this->inhalt .= sprintf("%.2F w %.2F %.2F m %.2F %.2F l S\n", $staerke, $x1, 842 - $y1, $x2, 842 - $y2);
    }

    /** Text kürzen, damit er in die Breite passt (mit …) */
    public static function kuerzen(string $text, float $max, float $groesse = 10): string
    {
        if (self::breite(self::winansi($text), $groesse, false) <= $max) return $text;
        while (mb_strlen($text) > 1 && self::breite(self::winansi($text . '…'), $groesse, false) > $max) $text = mb_substr($text, 0, -1);
        return rtrim($text) . '…';
    }

    public function ausgeben(string $titel): string
    {
        $objekte = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
            '<< /Length ' . strlen($this->inhalt) . " >>\nstream\n" . $this->inhalt . "endstream",
            '<< /Title (' . self::maskiert(self::winansi($titel)) . ') /Producer (Anerkennungspraemien) >>',
        ];
        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $stellen = [];
        foreach ($objekte as $i => $o) {
            $stellen[] = strlen($pdf);
            $pdf .= ($i + 1) . " 0 obj\n$o\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= 'xref' . "\n0 " . (count($objekte) + 1) . "\n0000000000 65535 f \n";
        foreach ($stellen as $s) $pdf .= sprintf("%010d 00000 n \n", $s);
        return $pdf . 'trailer << /Size ' . (count($objekte) + 1) . " /Root 1 0 R /Info 7 0 R >>\nstartxref\n$xref\n%%EOF\n";
    }

    private static function winansi(string $t): string
    {
        return (string) mb_convert_encoding(str_replace(["\r", "\n", "\t"], ' ', $t), 'Windows-1252', 'UTF-8');
    }

    private static function maskiert(string $t): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $t);
    }

    /** ungefähre Textbreite (Helvetica-Durchschnitt; reicht für rechtsbündige Beträge und Kürzen) */
    private static function breite(string $t, float $groesse, bool $fett): float
    {
        $b = 0.0;
        foreach (str_split($t) as $z) {
            $b += match (true) {
                str_contains('il.,:;\'|!', $z) => 0.25,
                str_contains('fjrtI ', $z) => 0.3,
                ctype_digit($z) => 0.556,
                ctype_upper($z) || str_contains('mwMW€', $z) => 0.68,
                default => 0.52,
            };
        }
        return $b * $groesse * ($fett ? 1.06 : 1);
    }
}

/** Zahlungsavis zu einer bezahlten Prämienabrechnung (an die Autor:in) */
function zahlungsavis_pdf(array $note, string $datum): string
{
    $pdf = new EinfachesPdf();
    $autor = $note['autor'] ?? [];
    $firma = $note['empfaenger'] ?? STANDARD_EMPFAENGER;
    $iban = (string) ($note['zahlung']['iban'] ?? '');
    $l = 56;
    $r = 539;
    $pdf->text($l, 60, medium_name($note['medium']), 18, true);
    $pdf->text($l, 76, 'Anerkennungsprämien', 9);
    $pdf->text($r, 60, $firma['name'] ?? '', 9, false, 'rechts');
    $pdf->text($r, 72, $firma['strasse'] ?? '', 9, false, 'rechts');
    $pdf->text($r, 84, $firma['plz_ort'] ?? '', 9, false, 'rechts');
    $pdf->linie($l, 96, $r, 96, 1);

    $y = 130;
    foreach ([trim(($autor['vorname'] ?? '') . ' ' . ($autor['nachname'] ?? '')), $autor['strasse'] ?? '', $autor['plz_ort'] ?? ''] as $zeile) {
        if ($zeile === '') continue;
        $pdf->text($l, $y, $zeile, 10);
        $y += 14;
    }
    $pdf->text($r, 130, 'Wien, ' . datum_text($datum), 10, false, 'rechts');

    $pdf->text($l, 200, 'Zahlungsavis', 16, true);
    $pdf->text($l, 222, 'Für deine Prämienabrechnung ' . $note['nummer'] . ' haben wir folgenden Betrag überwiesen:', 10);

    $y = 252;
    foreach ([
        ['Prämienabrechnung', $note['nummer']],
        ['Medium', medium_name($note['medium'])],
        ['Abrechnungsmonat', monat_text($note['monat'])],
        ['Überwiesen am', datum_text($datum)],
        ['Auf das Konto', ($note['zahlung']['kontoinhaber'] ?? '') . ($iban !== '' ? ', IBAN …' . substr($iban, -4) : '')],
    ] as [$a, $b]) {
        $pdf->text($l, $y, $a, 10);
        $pdf->text($l + 140, $y, $b, 10, true);
        $y += 16;
    }

    $y += 18;
    $pdf->text($l, $y, 'Leistung', 9, true);
    $pdf->text($l + 330, $y, 'Datum', 9, true);
    $pdf->text($r, $y, 'Betrag', 9, true, 'rechts');
    $pdf->linie($l, $y + 6, $r, $y + 6);
    $y += 22;
    foreach ($note['positionen'] as $i => $p) {
        if ($y > 760) {
            $pdf->text($l, $y, '… und ' . (count($note['positionen']) - $i) . ' weitere Leistungen', 9);
            $y += 16;
            break;
        }
        $pdf->text($l, $y, EinfachesPdf::kuerzen($p['titel'], 320), 10);
        $pdf->text($l + 330, $y, datum_text($p['veroeffentlichung']), 10);
        $pdf->text($r, $y, eur($p['betrag']), 10, false, 'rechts');
        $y += 16;
    }
    $pdf->linie($l, $y - 6, $r, $y - 6);
    $pdf->text($l, $y + 8, 'Gesamt überwiesen', 11, true);
    $pdf->text($r, $y + 8, eur(note_summe($note)), 11, true, 'rechts');

    $pdf->linie($l, 790, $r, 790);
    $pdf->text($l, 804, 'Automatisch erstellt von der Anerkennungsprämien-App von campus a college und campus a.', 8);
    return $pdf->ausgeben('Zahlungsavis ' . $note['nummer']);
}
