# campus a college – Honorarnoten

Web-App für die Honorarnoten der Jugendzeitung **campus a college**:
Autor:innen speichern ihre Beiträge laufend und schicken sie **einmal im Monat gesammelt
als Honorarnote** ab. Die Redaktion prüft, die Buchhaltung überweist. Beim Bezahlen wird die
Honorarnote automatisch als Word-Datei **aus der offiziellen Vorlage** erzeugt.

> **Demo-Version:** Alle Daten werden **lokal im Browser** (localStorage) gespeichert – ohne
> Server. Ideal zum Herzeigen über GitHub Pages. Für den echten Betrieb mit mehreren Personen
> auf verschiedenen Geräten braucht es später einen Server (siehe unten).

## Ausprobieren

Auf der Startseite gibt es **Demo-Zugänge** für jede Rolle (Passwort jeweils `demo1234`):

| Rolle | Konto | Was man sieht |
|---|---|---|
| Autor:in | `maria@demo.at` | Meine Leistungen, Meine Honorarnoten, Profil |
| Redaktion | `redaktion@demo.at` | Bearbeiter-Terminal |
| Buchhaltung | `buchhaltung@demo.at` | Bezahl-Terminal |
| Admin | `admin@demo.at` | Admin-Terminal + alles andere |

In den Demo-Daten warten zwei offene Zugangsanfragen (Sophie Neumann, Emil Huber) darauf,
vom Admin freigeschaltet zu werden.

**Tipp zum Vorführen:** Die Anmeldung gilt pro Browser-Tab. In einem Tab als Autor:in, im
zweiten als Redaktion anmelden. Änderungen erscheinen im anderen Tab automatisch.

Lokal starten: `npm run dev` → http://localhost:5173
(Nicht per Doppelklick auf `index.html` öffnen – das blockiert der Browser.)

## Ablauf

1. **Zugang anfragen:** Selbst registrieren geht nicht. Neue Personen schicken auf der Startseite
   eine Anfrage (Name, E-Mail, optional eine Nachricht). Ein Admin schaltet sie im Reiter
   „Anfragen“ frei, wählt die Rollen und bekommt ein **Startpasswort**. Das gibt er weiter, per
   „E-Mail vorbereiten“ oder „Text kopieren“. Beim ersten Anmelden legt die Person ein eigenes
   Passwort fest und trägt einmal im **Profil** Adresse und IBAN ein. Diese Daten werden für jede
   Honorarnote automatisch übernommen.
2. **Meine Leistungen:** Jeden Beitrag speichern, sobald er erschienen ist – als *Kolumne* oder
   *außerordentliches Honorar* (mit „Vereinbart mit“), jeweils mit Titel, Veröffentlichungsdatum
   und Betrag. Gespeicherte Leistungen kann man bearbeiten oder löschen.
3. **Monatsabrechnung:** Einmal im Monat die gesammelten Leistungen auswählen und als
   Honorarnote abschicken. Die Nummer folgt der Vorlage: `NACHNAME-VO-JAHR-NN`
   (z. B. `MUSTERFRAU-MA-2026-01`). Wurde im Monat schon eine abgeschickt, kommt ein Hinweis.
4. **Redaktion:** Filter nach Status, Suche nach Name oder Nummer, Sortierung nach Datum und
   Betrag. Annehmen, Ablehnen (Begründung Pflicht), Betrag pro Leistung korrigieren (Vermerk
   Pflicht), interne Kommentare, Verlauf. **IBAN und Adresse sind ausgeblendet.**
5. **Abgelehnt?** Die Autor:in holt die Leistungen mit einem Klick zurück, korrigiert sie und
   schickt sie neu ab.
6. **Buchhaltung:** Nur angenommene Noten. Kopier-Buttons für Empfänger, IBAN, BIC, Betrag und
   Verwendungszweck, „Alles kopieren“, GiroCode (QR-Code) für die Banking-App.
   **„Als bezahlt markieren“ erzeugt automatisch die Honorarnote als Word-Datei** aus
   [`public/vorlage/honorarnote-vorlage.docx`](public/vorlage/honorarnote-vorlage.docx).
   Im Reiter „Bezahlt“ gibt es pro Monat den CSV-Export und alle Honorarnoten als ZIP.
7. **Admin-Terminal:** Zugangsanfragen freischalten oder ablehnen (offene Anfragen werden in der
   Navigation gezählt), Personen direkt anlegen, Rollen vergeben (Checkboxen), Konten
   deaktivieren oder löschen, Passwort zurücksetzen (neues Startpasswort). Honorarnoten löschen (mit Löschprotokoll), Rechnungsempfänger und
   Datenschutzkontakt einstellen, Sicherung herunterladen/einspielen, Demo zurücksetzen.

Status: **Eingereicht → Angenommen / Abgelehnt → Bezahlt**

## Honorarnote aus der Vorlage

[`public/js/lib/honorarnote-docx.js`](public/js/lib/honorarnote-docx.js) öffnet die Vorlage im
Browser (JSZip), ersetzt die Beispielwerte (Maria Musterfrau, Musterstraße …, Nummer, Ort und
Datum), befüllt die Tabellen *Kolumnen* und *Außerordentliche Honorare* mit beliebig vielen
Zeilen, rechnet Zwischensummen und Gesamtbetrag und entfernt die grauen Ausfüllhinweise.
Layout und Formatierung der Vorlage bleiben erhalten.

**Neue Vorlage verwenden:** Datei unter gleichem Namen ersetzen. Die Beispieltexte
(`Maria Musterfrau`, `Musterstraße 1/2`, `1010 Wien`, `AT00 0000 0000 0000 0000`,
`Wien, 17.07.2026`, `MUSTERFRAU-MA-2026-01`) und die Tabellenüberschriften müssen gleich
bleiben, weil sie als Platzhalter erkannt werden.

## Auf GitHub Pages veröffentlichen

1. In GitHub: **Settings → Pages → Source: „GitHub Actions“**.
2. Auf `main` pushen (oder den Branch nach `main` mergen). Der Workflow
   [`.github/workflows/pages.yml`](.github/workflows/pages.yml) testet und veröffentlicht `public/`.
3. Adresse: `https://<benutzername>.github.io/campus-a-honorarnoten/`

GitHub Pages ist bei **privaten Repositories** nur mit einem kostenpflichtigen GitHub-Plan
verfügbar. Bei einem Gratis-Konto muss das Repo öffentlich sein.

## Datenschutz und Grenzen der Demo

- Alles bleibt im Browser des jeweiligen Geräts. Nichts wird an einen Server geschickt.
  Keine externen Schriftarten oder CDNs, die Bibliotheken liegen in `public/vendor/`.
- Passwörter werden gehasht gespeichert (PBKDF2). **Die Rollenrechte werden aber nur im
  Browser geprüft.** Wer Zugriff auf das Gerät hat, kann die Daten im Browser-Speicher lesen.
  Für echte IBANs und Adressen deshalb nur mit Server-Backend einsetzen.
- Jeder Browser hat seine eigenen Daten: Was Maria auf ihrem Handy speichert, sieht die
  Redaktion auf ihrem Laptop **nicht**. Das geht erst mit einem Server.
- Die Datenhaltung steckt komplett in [`public/js/store.js`](public/js/store.js). Jede Funktion
  prüft dort Rolle und erlaubte Statuswechsel. Für den Echtbetrieb werden nur diese Funktionen
  durch Server-Aufrufe ersetzt (z. B. Supabase mit Row Level Security; eine fertige
  Supabase-Variante liegt in der Git-History).

## Design anpassen

Farben stehen oben in [`public/css/style.css`](public/css/style.css) (`--marke`, `--akzent` …).
Das Logo in [`public/index.html`](public/index.html) an der markierten Stelle einsetzen und
`public/img/favicon.svg` ersetzen.

## Entwicklung

```bash
npm run dev    # lokaler Server auf Port 5173
npm test       # Unit-Tests (IBAN, Nummernformat, GiroCode, CSV, Beträge)
bash scripts/vendor.sh   # JSZip und QR-Generator aktualisieren
```
