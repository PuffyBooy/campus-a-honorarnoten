# campus a college – Honorarnoten

Web-App für die Honorarnoten der Jugendzeitung **campus a college**:
Autor:innen speichern ihre Beiträge laufend und schicken sie **einmal im Monat gesammelt
als Honorarnote** ab. Die Redaktion prüft, die Buchhaltung überweist. Beim Bezahlen wird die
Honorarnote automatisch als Word-Datei **aus der offiziellen Vorlage** erzeugt.

Die App läuft in zwei Betriebsarten – derselbe Code, nur die Datenhaltung ist anders:

| | **Demo** (GitHub Pages) | **Server** (eigener VPS) |
|---|---|---|
| Wofür | Herzeigen, Ausprobieren | echter Betrieb |
| Daten | nur im jeweiligen Browser | gemeinsame Datenbank (SQLite) auf dem Server |
| Rechte | nur im Browser geprüft | auf dem Server geprüft, nicht umgehbar |
| Kosten | gratis | Software gratis, nur der Server (VPS) kostet |
| Anleitung | [Ausprobieren](#ausprobieren-demo) | [Auf einem VPS installieren](#auf-einem-vps-installieren-echter-betrieb) |

Welche Betriebsart aktiv ist, steht in `public/js/modus.js`. Der Server liefert diese Datei
automatisch mit `MODUS = 'server'` aus – man muss nichts umstellen.

## Ausprobieren (Demo)

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
   und Betrag. Bei Kolumnen kann man die **Art der Kolumne** als freien Text dazuschreiben (optional),
   bei außerordentlichen Honoraren die **Art des Honorars** (freier Text, Pflicht). Der Betrag ist mit dem **Honorarsatz** vorausgefüllt (z. B. Kolumne 15 €, vom Admin
   einstellbar). Gespeicherte Leistungen kann man bearbeiten oder löschen.
   **Artikel von campus-a-college.at übernehmen:** Wer im **Profil** den Link zur eigenen Profilseite
   auf campus-a-college.at einträgt (z. B. `https://www.campus-a-college.at/profil/ae10…`), sieht unter
   „Meine Leistungen“ **alle eigenen Artikel** mit Datum, Ressort und Kategorie (z. B. „Meinung“).
   „Übernehmen“ füllt Titel und Veröffentlichungsdatum aus und verknüpft die Leistung mit dem Artikel.
   Jeder Artikel lässt sich nur einmal abrechnen, schon erfasste sind markiert. Die Redaktion sieht in
   der Honorarnote bei jeder Leistung den Link zum Artikel.
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

   **SEPA-Sammelüberweisung:** Oben im Reiter „Offen“ die Zahlungen auswählen und eine Datei im
   Format `pain.001` herunterladen. Die lädt man im Online-Banking beim Import von Sammelaufträgen
   hoch und gibt alle Überweisungen auf einmal frei. Danach ein Klick auf „… als bezahlt markieren“,
   dann sind alle erledigt und die Honorarnoten kommen gesammelt als ZIP. Beim ersten Mal fragt die
   App nach dem Konto, von dem überwiesen wird (nur für Buchhaltung und Admin sichtbar).
   Zwei Formate stehen zur Wahl: `pain.001.001.03` (Standard, von praktisch allen Banken angenommen)
   und `pain.001.001.09` (neueres Format). Falls die Bank eine Datei ablehnt, das andere Format
   probieren. Umlaute werden für die Bank umgeschrieben (ö → oe), weil SEPA nur einen
   eingeschränkten Zeichensatz erlaubt. Beide Formate werden in den Tests gegen die offiziellen
   ISO-20022-Schemas geprüft (`tests/schemas/`).
7. **Admin-Terminal:** Zugangsanfragen freischalten oder ablehnen (offene Anfragen werden in der
   Navigation gezählt), Personen direkt anlegen, Rollen vergeben (Checkboxen), Konten
   deaktivieren oder löschen, Passwort zurücksetzen (neues Startpasswort). Honorarnoten löschen
   (mit Löschprotokoll), Rechnungsempfänger, **Honorarsätze** und Datenschutzkontakt einstellen,
   Sicherung herunterladen/einspielen, Demo zurücksetzen. Weicht ein eingereichter Betrag vom
   Standardsatz ab, sieht die Redaktion in der Detailansicht einen Hinweis.

8. **Externe Honorarnote (Generator):** Für Aufträge von **anderen Firmen** erstellt man unter
   „Externe Honorarnote“ eine allgemeine Honorarnote: Empfänger und Leistungen eingeben, die
   eigenen Daten kommen aus dem Profil. Die Honorarnote ist immer umsatzsteuerfrei
   (Kleinunternehmerregelung, § 6 Abs 1 Z 27 UStG). Ergebnis als Word-Datei oder über
   „Drucken / als PDF speichern“. Die Nummer wird als eigene Serie vorgeschlagen
   (z. B. `MUSTERFRAU-MA-2026-E01`). Der Entwurf bleibt nur im eigenen Browser gespeichert und wird
   nicht an campus a college geschickt.

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

## Artikel von campus-a-college.at

campus-a-college.at läuft mit TYPO3 und hat keine Schnittstelle für Artikeldaten. Der Server liest deshalb
die normalen Seiten aus ([`server/campus-artikel.js`](server/campus-artikel.js)):

- `/profil/<ID>?fetchNews=1` – Artikelliste der Profilseite (12 pro Seite, der Server blättert alle Seiten durch)
- `/news/detail/<name>` – Artikelseite mit Datum, Ressort, Region und Kategorie

Beim ersten Aufruf pro Person werden alle Artikelseiten gelesen (bei 150 Artikeln ca. 20 Sekunden).
Die Artikeldaten landen in der Datenbank, danach wird nur noch die Liste auf neue Artikel geprüft
(höchstens alle 10 Minuten oder über „Liste aktualisieren“). Der Abruf läuft über den Server, weil der
Browser fremde Seiten nicht auslesen darf. **In der Demo** (GitHub Pages) gibt es deshalb nur Beispielartikel.

Baut campus-a-college.at seine Seiten um, muss das Auslesen angepasst werden. Leistungen lassen sich
dann weiterhin von Hand eintragen.

## Auf einem VPS installieren (echter Betrieb)

Die Server-Variante braucht **keine npm-Pakete und keinen Datenbankserver**: nur Node.js (ab 22.13).
Die Datenbank ist eine einzelne Datei (SQLite). Davor läuft [Caddy](https://caddyserver.com), das
automatisch ein kostenloses HTTPS-Zertifikat (Let's Encrypt) holt und erneuert.

**Du brauchst:**
- einen VPS mit **Debian 12 oder Ubuntu 22.04/24.04** – z. B. Hetzner (ab ca. 4 € im Monat) oder den
  „Always Free“-Tarif von Oracle Cloud; 1 CPU und 1 GB RAM reichen
- eine **(Sub-)Domain**, z. B. `honorare.campus-a-college.at`, deren DNS-Eintrag (A-Record) auf die
  IP-Adresse des Servers zeigt
- offene Ports **80 und 443**

**Installation** (auf dem Server, als Benutzer mit sudo-Rechten):

```bash
sudo git clone https://github.com/PuffyBooy/campus-a-honorarnoten.git /opt/honorarnoten
sudo bash /opt/honorarnoten/deploy/install.sh honorare.campus-a-college.at deine@email.at
```

Das Skript installiert Node.js und Caddy, richtet den Dienst mit Autostart ein
([`deploy/honorarnoten.service`](deploy/honorarnoten.service)), plant eine tägliche Sicherung und
legt das **erste Admin-Konto** an. Am Ende steht das **Startpasswort** im Terminal. Damit unter
`https://honorare.campus-a-college.at` anmelden und ein eigenes Passwort festlegen. Alle weiteren
Personen fragen auf der Startseite einen Zugang an und werden im Admin-Terminal freigeschaltet.

**Wichtige Befehle:**

| Was | Befehl |
|---|---|
| Status | `systemctl status honorarnoten` |
| Protokoll ansehen | `journalctl -u honorarnoten -f` |
| Neu starten | `sudo systemctl restart honorarnoten` |
| Update auf neueste Version | `sudo bash /opt/honorarnoten/deploy/update.sh` |
| Passwort vergessen (auch Admin) | `sudo bash /opt/honorarnoten/deploy/passwort.sh email@beispiel.at` |
| Sicherung sofort | `sudo systemctl start honorarnoten-backup` |

### Backups

- Jede Nacht um 3:15 Uhr landet eine Kopie der Datenbank in `/var/lib/honorarnoten/backups/`,
  30 Tage lang (änderbar über `BACKUP_TAGE` in `/etc/honorarnoten.env`). `update.sh` sichert vor
  jedem Update zusätzlich.
- **Zusätzlich außer Haus sichern!** Liegt nur auf dem Server eine Kopie, ist bei einem Serverausfall
  alles weg. Einfachste Lösung: regelmäßig vom eigenen Rechner holen, z. B.
  `scp -r benutzer@server:/var/lib/honorarnoten/backups ./honorar-backups`, oder die Backup-Funktion
  des VPS-Anbieters einschalten.
- **Wiederherstellen:**
  ```bash
  sudo systemctl stop honorarnoten
  sudo cp /var/lib/honorarnoten/backups/honorarnoten-DATUM.sqlite /var/lib/honorarnoten/honorarnoten.sqlite
  sudo rm -f /var/lib/honorarnoten/honorarnoten.sqlite-wal /var/lib/honorarnoten/honorarnoten.sqlite-shm
  sudo chown honorarnoten:honorarnoten /var/lib/honorarnoten/honorarnoten.sqlite
  sudo systemctl start honorarnoten
  ```

### Ohne Installationsskript starten

Zum Ausprobieren auf dem eigenen Rechner (Node.js 22.13 oder neuer):

```bash
npm run dev:server             # http://127.0.0.1:3000, ohne HTTPS
npm run admin -- deine@email.at  # erstes Admin-Konto, zeigt das Startpasswort
```

Oder mit Einstellungen aus einer `.env`-Datei: `./start.sh` (siehe Kommentare in [`start.sh`](start.sh)).

### Sicherheit im Server-Modus

- Alle Rechte (Rollen, Statuswechsel, wer IBAN und Adresse sehen darf) prüft der Server
  ([`server/honorare.js`](server/honorare.js)); die Redaktion bekommt IBAN und Adresse gar nicht
  erst ausgeliefert.
- Passwörter mit scrypt gehasht, Startpasswörter müssen beim ersten Login geändert werden.
- Anmeldung über ein Sitzungs-Cookie (`HttpOnly`, `Secure`, `SameSite=Strict`), in der Datenbank
  nur als Hash gespeichert; Abmelden, Deaktivieren und Passwort-Reset beenden Sitzungen.
- Schutz vor gefälschten Anfragen fremder Seiten (CSRF), Begrenzung von Anmeldeversuchen,
  strenge Content-Security-Policy, HTTPS mit HSTS.
- Der Dienst läuft als eigener Benutzer ohne Rechte und darf nur in `/var/lib/honorarnoten` schreiben.
- E-Mails verschickt der Server nicht (damit er gratis bleibt): Startpasswörter gibt der Admin über
  „E-Mail vorbereiten“ weiter.

## Demo auf GitHub Pages veröffentlichen

1. In GitHub: **Settings → Pages → Source: „GitHub Actions“**.
2. Auf `main` pushen (oder den Branch nach `main` mergen). Der Workflow
   [`.github/workflows/pages.yml`](.github/workflows/pages.yml) testet und veröffentlicht `public/`.
3. Adresse: `https://<benutzername>.github.io/campus-a-honorarnoten/`

GitHub Pages ist bei **privaten Repositories** nur mit einem kostenpflichtigen GitHub-Plan
verfügbar. Bei einem Gratis-Konto muss das Repo öffentlich sein.

## Datenschutz und Grenzen der Demo

Gilt nur für die Demo auf GitHub Pages – für den echten Betrieb den Server-Modus verwenden.

- Alles bleibt im Browser des jeweiligen Geräts. Nichts wird an einen Server geschickt.
  Keine externen Schriftarten oder CDNs, die Bibliotheken liegen in `public/vendor/`.
- Passwörter werden gehasht gespeichert (PBKDF2). **Die Rollenrechte werden aber nur im
  Browser geprüft.** Wer Zugriff auf das Gerät hat, kann die Daten im Browser-Speicher lesen.
  Für echte IBANs und Adressen deshalb nur mit Server-Backend einsetzen.
- Jeder Browser hat seine eigenen Daten: Was Maria auf ihrem Handy speichert, sieht die
  Redaktion auf ihrem Laptop **nicht**. Das geht erst mit einem Server.
- Die Datenhaltung der Demo steckt in [`public/js/store.js`](public/js/store.js), die des
  Server-Modus in [`public/js/api.js`](public/js/api.js) (gleiche Funktionen, Aufrufe an den Server).

## Design anpassen

Farben stehen oben in [`public/css/style.css`](public/css/style.css) (`--marke`, `--akzent` …).
Das Logo in [`public/index.html`](public/index.html) an der markierten Stelle einsetzen und
`public/img/favicon.svg` ersetzen.

## Entwicklung

```bash
npm run dev          # Demo lokal auf Port 5173
npm run dev:server   # Server-Modus lokal auf Port 3000
npm test             # alle Tests: Hilfsfunktionen und Server (Rechte, Abläufe, Schutz)
bash scripts/vendor.sh   # JSZip und QR-Generator aktualisieren
```

Aufbau: `public/` ist die Oberfläche (ohne Framework, ohne Build-Schritt), `server/` der Server
(`server.js` HTTP und Schutz, `honorare.js` Geschäftslogik, `db.js` Datenbank, `auth.js`
Passwörter und Sitzungen, `cli.js` Verwaltung), `deploy/` die Installationsskripte.
