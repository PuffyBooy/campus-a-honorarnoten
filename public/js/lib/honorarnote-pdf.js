// Honorarnoten als PDF – gleicher Inhalt und Aufbau wie die offizielle Word-Vorlage
// (public/vorlage/honorarnote-vorlage.docx). Mehrere Noten landen in einer Datei,
// jede Note beginnt auf einer neuen Seite.
import { ausserordentlichePositionen, formatBetragDokument, formatDatum, summe } from './format.js';
import { formatIban } from './iban.js';
import { ortAusPlzOrt } from './honorarnote-docx.js';
import { mediumName } from './campus.js';

const A4 = [595.28, 841.89];
const RAND = 56.7; // 2 cm
const BREITE = A4[0] - 2 * RAND;
const UNTEN = RAND;
const HINWEIS_UST = 'Der angeführte Rechnungsbetrag ist laut § 6 Abs 1 Z 27 UStG umsatzsteuerfrei.';

class Dokument {
  constructor(pdf, PDFLib, schrift, fett) {
    this.pdf = pdf;
    this.rgb = PDFLib.rgb;
    this.schrift = schrift;
    this.fett = fett;
    // Standardschriften kennen nur den Windows-Zeichensatz; alles andere wird ersetzt
    this.zeichen = new Set(schrift.getCharacterSet());
    this.seite = null;
    this.y = 0;
  }

  neueSeite() {
    this.seite = this.pdf.addPage(A4);
    this.y = A4[1] - RAND;
    this.seitenDerNote?.push(this.seite);
  }

  /** Fußzeile „Nummer · Seite x von y“ auf allen Seiten der zuletzt geschriebenen Note */
  fusszeilen(nummer) {
    const seiten = this.seitenDerNote;
    seiten.forEach((seite, i) => {
      const text = this.sauber(`${nummer} · Seite ${i + 1} von ${seiten.length}`);
      seite.drawText(text, {
        x: A4[0] - RAND - this.breite(text, { groesse: 8 }), y: RAND / 2, size: 8, font: this.schrift, color: this.rgb(0.45, 0.45, 0.45),
      });
    });
  }

  /** Platz für `hoehe` Punkte sicherstellen, sonst neue Seite */
  platz(hoehe) {
    if (this.y - hoehe < UNTEN) this.neueSeite();
  }

  sauber(text) {
    return Array.from(String(text ?? '').replace(/\s+/g, ' ').trim(), (c) => (this.zeichen.has(c.codePointAt(0)) ? c : '?')).join('');
  }

  breite(text, { fett = false, groesse = 10 } = {}) {
    return (fett ? this.fett : this.schrift).widthOfTextAtSize(text, groesse);
  }

  /** Text in Zeilen umbrechen, die höchstens `max` Punkte breit sind */
  umbrechen(text, max, stil = {}) {
    const zeilen = [];
    let zeile = '';
    for (const wort of this.sauber(text).split(' ')) {
      const neu = zeile ? `${zeile} ${wort}` : wort;
      if (this.breite(neu, stil) <= max || !zeile) {
        zeile = neu;
      } else {
        zeilen.push(zeile);
        zeile = wort;
      }
      // einzelnes überlanges Wort hart kürzen
      while (this.breite(zeile, stil) > max && zeile.length > 1) {
        let teil = zeile;
        while (this.breite(teil, stil) > max && teil.length > 1) teil = teil.slice(0, -1);
        zeilen.push(teil);
        zeile = zeile.slice(teil.length);
      }
    }
    if (zeile || !zeilen.length) zeilen.push(zeile);
    return zeilen;
  }

  schreiben(text, x, y, { fett = false, groesse = 10, grau = false } = {}) {
    this.seite.drawText(this.sauber(text), {
      x, y, size: groesse, font: fett ? this.fett : this.schrift, color: grau ? this.rgb(0.35, 0.35, 0.35) : this.rgb(0, 0, 0),
    });
  }

  absatz(text, { fett = false, groesse = 10, vor = 0, nach = 6 } = {}) {
    const zeilen = this.umbrechen(text, BREITE, { fett, groesse });
    const zh = groesse * 1.35;
    this.y -= vor;
    for (const z of zeilen) {
      this.platz(zh);
      this.y -= zh;
      this.schreiben(z, RAND, this.y + 3, { fett, groesse });
    }
    this.y -= nach;
  }

  /**
   * Tabelle mit grauer Kopfzeile. spalten: [{ titel, anteil, rechts }], zeilen: [[text, …]],
   * fuss: optionale fette Summenzeile [text, …]. Die Kopfzeile wird nach einem Seitenumbruch wiederholt.
   */
  tabelle(spalten, zeilen, fuss = null) {
    const groesse = 9;
    const pad = 4;
    const zh = groesse * 1.3;
    const breiten = spalten.map((s) => s.anteil * BREITE);
    const zeileZeichnen = (werte, { fett = false, hintergrund = null } = {}) => {
      const umbrochen = werte.map((w, i) => this.umbrechen(w, breiten[i] - 2 * pad, { fett, groesse }));
      const hoehe = Math.max(...umbrochen.map((u) => u.length)) * zh + 2 * pad;
      return { umbrochen, hoehe, fett, hintergrund };
    };
    const zeichnen = ({ umbrochen, hoehe, fett, hintergrund }) => {
      let x = RAND;
      umbrochen.forEach((linien, i) => {
        this.seite.drawRectangle({
          x, y: this.y - hoehe, width: breiten[i], height: hoehe,
          borderColor: this.rgb(0.6, 0.6, 0.6), borderWidth: 0.5,
          ...(hintergrund ? { color: hintergrund } : {}),
        });
        linien.forEach((l, j) => {
          const tx = spalten[i].rechts ? x + breiten[i] - pad - this.breite(l, { fett, groesse }) : x + pad;
          this.schreiben(l, tx, this.y - pad - (j + 1) * zh + 3, { fett, groesse });
        });
        x += breiten[i];
      });
      this.y -= hoehe;
    };
    const kopf = zeileZeichnen(spalten.map((s) => s.titel), { fett: true, hintergrund: this.rgb(0.85, 0.85, 0.85) });
    this.platz(kopf.hoehe + 20);
    zeichnen(kopf);
    for (const werte of zeilen) {
      const z = zeileZeichnen(werte);
      if (this.y - z.hoehe < UNTEN) {
        this.neueSeite();
        zeichnen(kopf);
      }
      zeichnen(z);
    }
    if (fuss) {
      const f = zeileZeichnen(fuss, { fett: true, hintergrund: this.rgb(0.95, 0.95, 0.95) });
      this.platz(f.hoehe);
      zeichnen(f);
    }
  }

  /** Zwei Spalten mit Beschriftung links und Wert rechts: [[label, wert], …] */
  angaben(links, rechts, titelLinks, titelRechts) {
    const groesse = 10;
    const zh = groesse * 1.45;
    const spalte = BREITE / 2;
    this.platz((Math.max(links.length, rechts.length) + 1) * zh + 10);
    this.y -= zh;
    this.schreiben(titelLinks, RAND, this.y, { fett: true, groesse: 11 });
    this.schreiben(titelRechts, RAND + spalte + 10, this.y, { fett: true, groesse: 11 });
    this.y -= 4;
    for (let i = 0; i < Math.max(links.length, rechts.length); i++) {
      this.y -= zh;
      if (links[i]) {
        this.schreiben(links[i][0], RAND, this.y, { groesse: 8, grau: true });
        this.schreiben(links[i][1], RAND + 105, this.y, { groesse });
      }
      if (rechts[i]) this.schreiben(rechts[i], RAND + spalte + 10, this.y, { groesse });
    }
    this.y -= 12;
  }
}

function noteSchreiben(d, note) {
  const a = note.autor;
  const e = note.empfaenger ?? {};
  const name = `${a.vorname} ${a.nachname}`.trim();
  d.seitenDerNote = [];
  d.neueSeite();
  d.absatz(`Honorarnote ${mediumName(note.medium)}`, { fett: true, groesse: 18, nach: 10 });
  d.angaben(
    [['Vor- und Nachname', name], ['Straße und Hausnummer', a.strasse], ['PLZ und Ort', a.plz_ort], ['IBAN', formatIban(note.zahlung?.iban)]],
    [e.name, e.strasse, e.plz_ort, e.uid].filter(Boolean),
    'Meine Daten', 'Rechnungsempfänger',
  );
  d.tabelle(
    [{ titel: 'Ort und Datum', anteil: 0.5 }, { titel: 'Honorarnote Nr.', anteil: 0.5 }],
    [[`${ortAusPlzOrt(a.plz_ort)}, ${formatDatum(note.eingereicht_am)}`, note.nummer]],
  );
  d.absatz('Sehr geehrte Damen und Herren, für folgende Leistungen berechne ich wie vereinbart:', { vor: 14, nach: 8 });

  const kolumnen = note.positionen.filter((p) => p.kategorie === 'kolumne');
  const ausserord = ausserordentlichePositionen(note.positionen);
  d.absatz('1. Kolumnen', { fett: true, groesse: 11, vor: 4, nach: 4 });
  d.tabelle(
    [{ titel: 'Titel des Beitrags', anteil: 0.6 }, { titel: 'Veröffentlichung', anteil: 0.2 }, { titel: 'Betrag in Euro', anteil: 0.2, rechts: true }],
    kolumnen.map((p) => [p.titel, formatDatum(p.veroeffentlichung), formatBetragDokument(p.betrag)]),
    ['Zwischensumme Kolumnen', '', formatBetragDokument(summe(kolumnen))],
  );
  d.absatz('2. Außerordentliche Honorare', { fett: true, groesse: 11, vor: 12, nach: 4 });
  d.tabelle(
    [{ titel: 'Titel des Beitrags', anteil: 0.4 }, { titel: 'Veröffentlichung', anteil: 0.18 },
      { titel: 'Vereinbart mit', anteil: 0.24 }, { titel: 'Betrag in Euro', anteil: 0.18, rechts: true }],
    ausserord.map((p) => [p.titel, formatDatum(p.veroeffentlichung), p.vereinbart_mit ?? '', formatBetragDokument(p.betrag)]),
    ['Zwischensumme außerordentliche Honorare', '', '', formatBetragDokument(summe(ausserord))],
  );
  d.y -= 12;
  d.tabelle(
    [{ titel: 'Gesamtbetrag in Euro', anteil: 0.8 }, { titel: formatBetragDokument(summe(note.positionen)), anteil: 0.2, rechts: true }],
    [],
  );
  d.absatz(HINWEIS_UST, { vor: 14, nach: 14 });
  d.absatz('Mit freundlichen Grüßen', { nach: 18 });
  d.absatz(name);
  d.fusszeilen(note.nummer);
}

/**
 * Erzeugt ein PDF mit allen Noten (jede ab einer neuen Seite) und liefert die Bytes.
 * PDFLib: das Modul public/vendor/pdf-lib.mjs
 */
export async function honorarnotenPdf(noten, PDFLib) {
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(noten.length === 1 ? `Honorarnote ${mediumName(noten[0].medium)} ${noten[0].nummer}` : `Honorarnoten (${noten.length})`);
  pdf.setCreator('campus a college – Honorarnoten');
  pdf.setProducer('campus a college – Honorarnoten');
  const d = new Dokument(
    pdf, PDFLib,
    await pdf.embedFont(PDFLib.StandardFonts.Helvetica),
    await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold),
  );
  for (const note of noten) noteSchreiben(d, note);
  return pdf.save();
}
