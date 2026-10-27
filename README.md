# campus a college – Anerkennungsprämien

Web-App für die Prämienabrechnungen von **campus a college** (Schüler*innenzeitung) und **campus a**
(Studentenmagazin). Beide Medien werden getrennt abgerechnet:
Autor:innen speichern ihre Beiträge laufend und schicken sie **einmal im Monat gesammelt
als Prämienabrechnung** ab. Die Redaktion prüft, die Buchhaltung lädt jede Woche alle angenommenen
Prämienabrechnungen als **ein PDF** herunter, überweist und markiert die Woche als bezahlt.

Die App läuft in zwei Betriebsarten – derselbe Code, nur die Datenhaltung ist anders:

| | **Demo** (GitHub Pages) | **Server** (World4You-Webspace) |
|---|---|---|
| Wofür | Herzeigen, Ausprobieren | echter Betrieb |
| Daten | nur im jeweiligen Browser | gemeinsame Datenbank (MySQL oder SQLite) auf dem Webspace |
| Rechte | nur im Browser geprüft | auf dem Server geprüft, nicht umgehbar |
| E-Mails | keine | automatisch (neue Prämienabrechnungen, Bestätigungen, Zugangsdaten …) |
| Anleitung | [Ausprobieren](#ausprobieren-demo) | [Auf World4You installieren](#auf-world4you-installieren-echter-betrieb) |

Welche Betriebsart aktiv ist, steht in `public/js/modus.js`. Das Paket für World4You stellt diese
Datei automatisch auf `MODUS = 'server'` – man muss nichts umstellen.

## Ausprobieren (Demo)

Auf der Startseite gibt es **Demo-Zugänge** für jede Rolle (Passwort jeweils `demo1234`):

| Rolle | Konto | Was man sieht |
|---|---|---|
| Erstes Anmelden | `neu@demo.at` | „Konto einrichten“ wie mit einem Startpasswort – startet bei jedem Klick frisch |
| Autor:in | `maria@demo.at` | Mein Monat (mit Rolle Redigieren), Meine Abrechnungen, Profil |
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
   „Anfragen“ frei, wählt die Rollen und bekommt ein **Startpasswort**. Auf dem Server geht es
   automatisch per E-Mail an die neue Person (abschaltbar unter Admin → E-Mail); sonst gibt der
   Admin es per „E-Mail vorbereiten“ oder „Text kopieren“ weiter.

   **Konto einrichten (Pflicht beim ersten Anmelden):** Mit dem Startpasswort kommt man nur auf die
   Seite „Konto einrichten“ und muss dort alles auf einmal anlegen: eigenes Passwort, Name, Adresse,
   Bankverbindung (Kontoinhaber:in, IBAN, BIC optional) und **mindestens einen Profil-Link** – auf
   campus-a-college.at und/oder campus-a.at, je nachdem, wofür man schreibt. Vorher geht nichts
   anderes, auch nicht über die API (der Server prüft es). Redaktion, Buchhaltung und Admin ohne
   Autor:innen-Rolle legen nur das Passwort fest. Fehlt einer bestehenden Autor:in etwas (z. B. nach
   dem Update der Profil-Link), erscheint die Seite beim nächsten Anmelden ebenfalls, mit den
   vorhandenen Daten vorausgefüllt. Die Daten werden für jede Prämienabrechnung automatisch übernommen.
2. **Mein Monat:** Jeden Beitrag speichern, sobald er erschienen ist – **für campus a college
   oder campus a**. Wählen kann man nur, wenn beide Profil-Links hinterlegt sind; sonst gilt immer das
   verbundene Medium (das prüft auch der Server). Als *Kolumne* oder
   *außerordentliche Anerkennungsprämie* (mit „Vereinbart mit“), jeweils mit Titel, Veröffentlichungsdatum
   und Betrag. Bei Kolumnen kann man die **Art der Kolumne** als freien Text dazuschreiben (optional),
   bei außerordentlichen Anerkennungsprämien die **Art der Anerkennungsprämie** (freier Text, Pflicht). Der Betrag ist mit dem **Prämiensatz** vorausgefüllt (z. B. Kolumne 15 €, vom Admin
   **pro Medium** einstellbar). Gespeicherte Leistungen kann man bearbeiten oder löschen.
   **Artikel übernehmen:** Unter „Mein Monat“ stehen **alle eigenen Artikel** von
   campus-a-college.at und campus-a.at (je nach hinterlegten Profil-Links) mit Medium, Datum, Ressort
   und Kategorie (z. B. „Meinung“). „Übernehmen“ füllt Medium, Titel und Veröffentlichungsdatum aus
   und verknüpft die Leistung mit dem Artikel.
   Jeder Artikel lässt sich nur einmal abrechnen, schon erfasste sind markiert. Die Redaktion sieht in
   der Prämienabrechnung bei jeder Leistung den Link zum Artikel.
3. **Monatsabrechnung:** Einmal im Monat die gesammelten Leistungen auswählen und als
   Prämienabrechnung abschicken – **getrennt pro Medium**: Es gibt eine Karte für campus a college und eine
   für campus a, jede mit eigenem Knopf. Die Prämienabrechnung heißt dann „Prämienabrechnung campus a college“
   bzw. „Prämienabrechnung campus a“ (Word und PDF). Die Nummer folgt der Vorlage: `NACHNAME-VO-JAHR-NN`
   (z. B. `MUSTERFRAU-MA-2026-01`). Einreichen geht jederzeit, aber mit deutlichem Hinweis „Bitte nur
   einmal am Monatsende“ und einem Bestätigungsschritt mit allen Leistungen und der Summe. Wurde im Monat
   schon eine eingereicht, kommt ein Hinweis.
   **Verlauf und Zurückziehen:** Jede Abrechnung zeigt ihren Weg (Eingereicht → In Prüfung → Angenommen →
   Auszahlung KW → Bezahlt, mit Datum). Solange die Redaktion noch nicht angenommen hat, kann die
   Autor:in sie **zurückziehen und bearbeiten**: Die Leistungen kommen zurück in „Mein Monat“, die
   Abrechnung verschwindet (Vermerk im Löschprotokoll). War es die letzte Nummer, bekommt die neue
   Abrechnung wieder dieselbe. „Meine Abrechnungen“ zeigt pro Jahr die ausgezahlte Summe und was noch
   unterwegs ist.
4. **Redaktion:** Reiter nach Status mit Zählern (Zu prüfen, Angenommen, Zurückgegeben, Bezahlt, Alle),
   Filter nach Medium und Abrechnungsmonat, Suche nach Name oder Nummer, Sortierung. Links der
   Posteingang, rechts die **große Prüfansicht**: jede Leistung mit Haken **„geprüft“** (am Server
   gespeichert, alle in der Redaktion sehen ihn), Artikel-Link und **Hinweisen** (Betrag über/unter dem
   Satz, ohne Artikel-Link, Artikel schon in einer anderen Abrechnung), Betrag ändern (Vermerk Pflicht),
   Jahressumme der Person, interne Kommentare und Verlauf. Annehmen fragt nach, wenn noch nicht alles
   geprüft ist; danach geht es automatisch zur nächsten Abrechnung (oder mit „Vorige/Nächste“).
   Mehrere Abrechnungen lassen sich auf einmal annehmen. Am Handy erst die Liste, dann die Prüfansicht.
   **IBAN und Adresse sind ausgeblendet.**
5. **Abgelehnt?** Beim Ablehnen (Begründung Pflicht) gehen die Leistungen **sofort zurück an die
   Autor:in**: Sie stehen wieder unter „Mein Monat“, mit dem Hinweis „Zurück aus <Nummer> zum
   Überarbeiten“ und der Begründung. Die Autor:in korrigiert sie und schickt sie als neue Prämienabrechnung
   ab; die abgelehnte Note bleibt mit ihrer Nummer als „Abgelehnt“ stehen und kann nicht mehr
   angenommen werden (damit nichts doppelt abgerechnet wird).
   **Redigieren (campus a college):** Neben *Kolumne* und *außerordentlicher Anerkennungsprämie* gibt es die
   Kategorie *Redigieren* – auswählbar nur für Konten, denen der Admin die Rolle **„Redigieren“**
   gegeben hat (Admin → Nutzer:innen; die Rolle bringt „Autor:in“ automatisch mit). Redigieren
   erscheint nicht auf der Webseite, es wird nur verrechnet und zählt immer zu campus a college: Man
   gibt die **Anzahl der Texte** ein (Beschreibung optional), der Betrag wird berechnet: Anzahl × Satz
   pro Text (Standard **2 €**, im Admin unter „Prämiensätze“ einstellbar); der Server rechnet selbst
   nach. Auf der Prämienabrechnung (Word und PDF) steht es unter **„2. Außerordentliche Anerkennungsprämien“**, z. B.
   „Redigieren (7 Texte): September“.
6. **Buchhaltung:** Das Bezahl-Terminal zeigt die angenommenen Prämienabrechnungen **nach Kalenderwoche**
   (der Woche, in der die Redaktion sie angenommen hat), mit Summe pro Woche. Pro Woche gibt es zwei
   Knöpfe:
   - **„PDF herunterladen“:** alle Prämienabrechnungen der Woche in einer PDF-Datei, jede Note ab einer
     neuen Seite, im Aufbau der offiziellen Vorlage (mit Adresse und IBAN zum Überweisen).
   - **„Woche als bezahlt markieren“:** markiert alle Prämienabrechnungen der Woche mit heutigem Datum als
     bezahlt (alle oder keine).

   Im Reiter „Bezahlt“ stehen die bezahlten Wochen der letzten 12 Wochen, das PDF lässt sich dort
   erneut herunterladen.
7. **Admin-Terminal:** Zugangsanfragen freischalten oder ablehnen (offene Anfragen werden in der
   Navigation gezählt), Personen direkt anlegen, Rollen vergeben (Checkboxen), Konten
   deaktivieren oder löschen, Passwort zurücksetzen (neues Startpasswort), **E-Mail-Adresse ändern**
   (alte und neue Adresse bekommen eine Info-Mail). Prämienabrechnungen löschen
   (mit Löschprotokoll), Rechnungsempfänger, **Prämiensätze** und Datenschutzkontakt einstellen,
   Sicherung herunterladen/einspielen, Demo zurücksetzen. Weicht ein eingereichter Betrag vom
   Standardsatz ab, sieht die Redaktion in der Detailansicht einen Hinweis.

8. **Externe Honorarnote (Generator):** Für bezahlte Aufträge von **anderen Firmen** (dort ist es weiterhin ein Honorar) erstellt man unter
   „Externe Honorarnote“ eine allgemeine Honorarnote: Empfänger und Leistungen eingeben, die
   eigenen Daten kommen aus dem Profil. Sie ist immer umsatzsteuerfrei
   (Kleinunternehmerregelung, § 6 Abs 1 Z 27 UStG). Ergebnis als Word-Datei oder über
   „Drucken / als PDF speichern“. Die Nummer wird als eigene Serie vorgeschlagen
   (z. B. `MUSTERFRAU-MA-2026-E01`). Der Entwurf bleibt nur im eigenen Browser gespeichert und wird
   nicht an campus a college geschickt.

Status: **Eingereicht → Angenommen / Abgelehnt → Bezahlt**

## Prämienabrechnung aus der Vorlage

[`public/js/lib/honorarnote-docx.js`](public/js/lib/honorarnote-docx.js) öffnet die Vorlage im
Browser (JSZip), ersetzt die Beispielwerte (Maria Musterfrau, Musterstraße …, Nummer, Ort und
Datum), befüllt die Tabellen *Kolumnen* und *Außerordentliche Anerkennungsprämien* mit beliebig vielen
Zeilen, rechnet Zwischensummen und Gesamtbetrag und entfernt die grauen Ausfüllhinweise.
Layout und Formatierung der Vorlage bleiben erhalten.

**Neue Vorlage verwenden:** Datei unter gleichem Namen ersetzen. Die Beispieltexte
(`Maria Musterfrau`, `Musterstraße 1/2`, `1010 Wien`, `AT00 0000 0000 0000 0000`,
`Wien, 17.07.2026`, `MUSTERFRAU-MA-2026-01`) und die Tabellenüberschriften müssen gleich
bleiben, weil sie als Platzhalter erkannt werden.

**PDF für die Buchhaltung:** [`public/js/lib/honorarnote-pdf.js`](public/js/lib/honorarnote-pdf.js)
baut dieselben Inhalte mit [pdf-lib](https://pdf-lib.js.org) direkt im Browser als PDF nach
(Word-Dateien lassen sich im Browser nicht in PDF umwandeln). Ändert sich die Vorlage, muss das
PDF-Layout dort mit angepasst werden.

## Artikel von campus-a-college.at und campus-a.at

Beide Seiten laufen mit TYPO3 (gleiches System, aber **eigene Profile**: dieselbe Person hat auf jeder
Seite eine andere Profil-ID) und haben keine Schnittstelle für Artikeldaten. Der Server liest deshalb
die normalen Seiten aus ([`server/lib/artikel.php`](server/lib/artikel.php)):

- `/profil/<ID>?fetchNews=1` – Artikelliste der Profilseite (12 pro Seite, der Server blättert alle Seiten durch)
- `/news/detail/<name>` (campus-a-college.at) bzw. `/news/news-detail/<name>` (campus-a.at) –
  Artikelseite mit Datum, Ressort, Region und Kategorie

Die Adressen beider Seiten stehen in [`public/js/lib/campus.js`](public/js/lib/campus.js).

Beim ersten Aufruf pro Person werden die Artikelseiten gelesen (6 gleichzeitig, höchstens 20 Sekunden
pro Aufruf – bei sehr vielen Artikeln kommen die restlichen Daten beim nächsten Mal dazu).
Die Artikeldaten landen in der Datenbank, danach wird nur noch die Liste auf neue Artikel geprüft
(höchstens alle 10 Minuten oder über „Liste aktualisieren“). Der Abruf läuft über den Server, weil der
Browser fremde Seiten nicht auslesen darf. **In der Demo** (GitHub Pages) gibt es deshalb nur Beispielartikel.

Baut campus-a-college.at seine Seiten um, muss das Auslesen angepasst werden. Leistungen lassen sich
dann weiterhin von Hand eintragen.

## Auf World4You installieren (echter Betrieb)

Der Server-Teil ist in **PHP** geschrieben und läuft auf normalem Webspace mit Apache und PHP 8.1+
– also auch auf dem **Webhosting von World4You**. Als Datenbank nimmt er **MySQL** (bei World4You
dabei) oder – wo verfügbar – eine einzelne SQLite-Datei. Keine Zusatzpakete, kein Cronjob.

### 1. Im World4You-Kundenbereich ([my.world4you.com](https://my.world4you.com))

- **SSL-Zertifikat** für die Domain aktivieren (kostenlos) – die App läuft nur über `https://`.
- **PHP-Version** auf 8.1 oder neuer stellen (*Webspace → Einstellungen*; am besten die neueste).
- Ein **E-Mail-Postfach** für den Versand anlegen: `office@deine-domain.at`. Eine zweite Adresse
  (z. B. `kontakt@deine-domain.at`) bekommt die Antworten auf die automatischen E-Mails und steht im
  Impressum und in der Datenschutzerklärung.

### 2. Paket hochladen

Das fertige Paket baut GitHub bei jedem Update auf `main` automatisch: unter **Actions → „Tests, Demo
und Paket“ → letzter Lauf → Artifacts → `honorarnoten-world4you`** herunterladen und entpacken.
(Selbst bauen: `npm run paket` → `dist/world4you/` bzw. `dist/honorarnoten-world4you.zip`.)

Den **gesamten Inhalt** per FTP (z. B. [FileZilla](https://filezilla-project.org), Zugangsdaten im
Kundenbereich unter *FTP*) in den Hauptordner der Domain hochladen – **auch die versteckten Dateien
`.htaccess`** (FileZilla: *Server → Versteckte Dateien anzeigen*).

```
.htaccess            HTTPS erzwingen, api/… weiterleiten, Sicherheits-Header
index.html, css/, js/, vendor/, img/, vorlage/   die App
api.php              Schnittstelle (ruft app/api.php auf)
einrichten.php       Einrichtung nach dem Hochladen
app/                 PHP-Code – per .htaccess gesperrt, nie über das Web erreichbar
app/daten/           Datenbank und tägliche Sicherungen (entsteht automatisch)
```

### 3. Einrichten

`https://deine-domain.at/einrichten.php` öffnen. Die Seite prüft den Webspace (PHP-Version, Datenbank,
HTTPS, Schreibrechte) und fragt dann nach:

- den **MySQL-Zugangsdaten** (Server, Name der Datenbank, Benutzer, Passwort) – stehen im
  World4You-Kundenbereich unter **Datenbanken**; gibt es noch keine, dort zuerst eine anlegen. Die
  Tabellen legt die App selbst an. (Fehlt nur, wenn der Webspace SQLite kann – dann braucht es nichts.)
- **deinem Admin-Konto** (Name, E-Mail) – danach wird das **Startpasswort** angezeigt,
- den **Zugangsdaten des E-Mail-Postfachs** (Adresse und Passwort; Server `smtp.world4you.com`,
  Port 587, STARTTLS sind schon eingetragen) und der **Antwortadresse** (optional).

Welche Adressen? **`office@deine-domain.at`** ist der Absender – die App verschickt damit alle
E-Mails. Ein eigenes Postfach für die Redaktion braucht es nicht: Die Mails gehen direkt an die Konten
(an die E-Mail-Adresse, mit der sich jemand anmeldet). Die **zweite Adresse** (z. B.
`kontakt@deine-domain.at`) als Antwortadresse eintragen – wer auf eine automatische Mail antwortet,
landet dort – und unter Admin → Einstellungen als Kontakt für Datenschutz und im Impressum.

Zum Schluss geht eine **Test-E-Mail** hinaus. Die Einrichtung funktioniert nur, solange es noch kein
Konto gibt – deshalb direkt nach dem Hochladen erledigen. Danach unter `https://deine-domain.at`
mit dem Startpasswort anmelden und ein eigenes Passwort festlegen.

### Impressum, Datenschutz und Hinweis zum Betreiber

Unter **Admin → Einstellungen → Betreiber der App** Name, Anschrift und E-Mail der Person eintragen, die
die App betreibt. Daraus entstehen automatisch das **Impressum** (`#/impressum`) und die
**Datenschutzerklärung** (`#/datenschutz`). Beide sind ohne Anmeldung erreichbar und unten auf jeder Seite
verlinkt. Eigene Ergänzungen sind möglich. Die Texte sind eine Vorlage und **keine Rechtsberatung** –
am besten einmal prüfen lassen.

Ist der Haken **„Der Betreiber ist nicht bei der campus a Medien GmbH angestellt“** gesetzt (Standard),
sehen alle einen **Hinweis**: Wer die App betreibt, ist nicht bei campus a angestellt, hat aber als
Admin Zugriff auf alle Daten (auch Adressen und IBANs), und die Daten liegen bei World4You.
- auf der Anmeldeseite und in der Datenschutzerklärung,
- beim **Zugang anfragen** mit Pflicht-Häkchen „Datenschutzerklärung gelesen und Hinweis zur Kenntnis
  genommen“ (ohne Häkchen lehnt auch der Server ab; der Zeitpunkt steht bei der Anfrage im Admin),
- beim **Konto einrichten** (erstes Anmelden) mit demselben Pflicht-Häkchen,
- bei allen anderen als Banner, bis sie „Gelesen und zur Kenntnis genommen“ klicken (Zeitpunkt wird gespeichert).

Die Bestätigung der Datenschutzerklärung fragt die App bei **allen Konten** ab, auch wenn kein Hinweis
zum Betreiber nötig ist. Ändern sich Name, Anschrift, Hosting oder der Haken, müssen alle neu bestätigen.

### Cookies

Beim ersten Besuch erscheint unten die **Cookie-Auswahl** („Nur notwendige“ oder „Alle erlauben“, mit
Details). Notwendig sind nur das Anmelde-Cookie und das Merken der Auswahl. Optional ist **„Komfort“**:
Dabei merkt sich der Browser den Entwurf der Externen Honorarnote; ohne Zustimmung bleibt er nur, bis die
Seite geschlossen wird. Unten auf jeder Seite kann man über **„Cookie-Einstellungen“** jederzeit ändern;
beim Widerruf wird das Gespeicherte sofort gelöscht. Werbung, Tracking oder Analyse gibt es nicht.

### Automatische E-Mails

Alle Mails kommen von `office@…`, haben das campus-a-Design (Kopf in der Markenfarbe, Übersicht,
Knopf zur App) und eine reine Textfassung. Versand einstellen und testen unter **Admin → E-Mail**.

Die Mails gehen an die **Konten selbst**. Jede:r wählt im **Profil → E-Mail-Benachrichtigungen**, was
sie bekommen will (ohne eigene Wahl ist alles für die eigenen Rollen an):

| Wann | an wen |
|---|---|
| Prämienabrechnung eingereicht | alle mit der Rolle Redaktion (mit Leistungen und Summe) + Eingangsbestätigung an die Autor:in |
| angenommen | Autor:in (inkl. geänderter Beträge mit Vermerk) + alle mit der Rolle Buchhaltung |
| abgelehnt | Autor:in mit Begründung („Leistungen überarbeiten“) |
| als bezahlt markiert | Autor:in mit Betrag und Zahlungsdatum |
| neue Zugangsanfrage | alle Admins |
| Konto angelegt / Passwort zurückgesetzt | die Person, mit Startpasswort (unter Admin → E-Mail abschaltbar) |

Admins können sich zusätzlich die Mails von Redaktion und Buchhaltung einschalten.

Die Mails gehen über das World4You-Postfach (SMTP) hinaus, nachdem die App dem Browser schon
geantwortet hat – niemand wartet darauf. Klappt der Versand nicht (Passwort falsch, Server kurz
weg), wird es bis zu 5-mal erneut versucht; den letzten Fehler zeigt **Admin → E-Mail**.

### Automatisch veröffentlichen (empfohlen)

Einmal eingerichtet, kommt **jede Änderung von selbst auf den Webspace**: Sobald etwas auf `main`
landet (z. B. ein gemergter Pull Request), testet GitHub die App und spielt sie per SSH auf
World4You ein ([`scripts/world4you-deploy.sh`](scripts/world4you-deploy.sh)). Vorher wird die
Datenbank gesichert, `app/daten` bleibt unangetastet. Nichts mehr von Hand hochladen.

**Einmalig einrichten:**

1. **Schlüssel erzeugen** – am eigenen Rechner im Terminal (Windows: PowerShell), zweimal Enter
   drücken (ohne Passphrase):
   ```bash
   ssh-keygen -t ed25519 -C github-world4you -f world4you-github
   ```
   Das ergibt zwei Dateien: `world4you-github` (privat, geheim) und `world4you-github.pub` (öffentlich).
2. **Öffentlichen Schlüssel bei World4You hinterlegen:** Kundenbereich → *Dein Paket → Webspace → SSH*
   → *Public-Key hinzufügen* → den Inhalt von `world4you-github.pub` hineinkopieren. Dort stehen auch
   **SSH-Server** und **Benutzername**.
3. **Hauptordner herausfinden:** per SSH anmelden, in den Ordner der Domain wechseln und `pwd`
   eingeben – das ist der Pfad (z. B. `/home/…/html`).
4. **In GitHub eintragen:** Repository → *Settings → Secrets and variables → Actions →
   New repository secret*:

   | Name | Inhalt |
   |---|---|
   | `W4Y_HOST` | SSH-Server aus dem Kundenbereich |
   | `W4Y_BENUTZER` | SSH-Benutzername |
   | `W4Y_SSH_KEY` | kompletter Inhalt der Datei `world4you-github` (privater Schlüssel) |
   | `W4Y_ZIEL` | Pfad des Hauptordners aus Schritt 3 |
   | `W4Y_ADRESSE` | optional: `https://deine-domain.at` – danach wird geprüft, ob die Seite antwortet |

5. Fertig. Ab jetzt: **Änderung mergen → nach 2–3 Minuten ist sie online.** Den Stand sieht man unter
   *Actions → „Tests, Demo und Paket“* (Schritt „Auf World4You veröffentlichen“). Von Hand neu
   veröffentlichen: dort *Run workflow*. Schlagen die Tests fehl, wird **nichts** veröffentlicht.

Die private Schlüsseldatei danach sicher aufbewahren oder löschen – GitHub speichert sie verschlüsselt.
Wird der Schlüssel nicht mehr gebraucht, im World4You-Kundenbereich wieder entfernen.

### Hochladen und Updates per SSH (statt FTP)

SSH gibt es bei World4You in allen Webhosting-Paketen (im Kundenbereich aktivieren; Server, Benutzer
und Passwort stehen dort). Am eigenen Rechner im Terminal (Windows: PowerShell):

```bash
# 1. Paket auf den Webspace kopieren (landet im Home-Ordner)
scp anerkennungspraemien-world4you.zip BENUTZER@SERVER:

# 2. Anmelden und zum Hauptordner der Domain wechseln (mit ls nachsehen, wie er heißt)
ssh BENUTZER@SERVER
ls
cd HAUPTORDNER

# 3a. Erstes Mal: auspacken, dann im Browser /einrichten.php öffnen
unzip -o ~/anerkennungspraemien-world4you.zip -d .

# 3b. Jedes Update danach: sichert zuerst die Datenbank, lässt app/daten unangetastet
bash app/aktualisieren.sh ~/anerkennungspraemien-world4you.zip
```

### Updates per FTP

Neues Paket herunterladen und einfach drüber hochladen (alte Dateien überschreiben). **Den Ordner
`app/daten/` nie löschen** – dort liegen Datenbank und Sicherungen. Die Datenbank wird beim ersten
Aufruf nach einem Update automatisch angepasst.

### Backups

- Jeden Tag legt die App beim ersten Aufruf eine Sicherung in `app/daten/backups/` an und hebt sie
  30 Tage auf – bei MySQL als `.sql`-Datei, bei SQLite als Kopie der Datenbank-Datei. **Ab und zu per
  FTP/scp auf den eigenen Rechner kopieren!** World4You sichert MySQL-Datenbanken zusätzlich selbst.
- Zusätzlich: **Admin → Daten → Datenexport** (JSON, enthält IBANs – vertraulich).
- Wiederherstellen (MySQL): im World4You-Kundenbereich **phpMyAdmin** öffnen, die Datenbank wählen,
  *Importieren* und die `.sql`-Datei hochladen (sie ersetzt alle Tabellen).
  SQLite: `app/daten/honorarnoten.sqlite` durch eine Sicherung ersetzen.
- Die MySQL-Zugangsdaten stehen in `app/daten/konfig.php` (per `.htaccess` gesperrt). Ändert sich das
  Passwort der Datenbank, dort eintragen – oder die Datei löschen und `/einrichten.php` erneut öffnen.

### Passwort vergessen

Andere Konten setzt der Admin unter **Admin → Benutzer → Passwort zurücksetzen** zurück. Für das
Admin-Konto selbst per SSH (im Hauptordner der Domain):

```bash
php app/cli.php passwort deine@email.at      # neues Startpasswort
php app/cli.php backup                       # Sicherung sofort
php app/cli.php testmail an@beispiel.at      # Test-E-Mail
php app/cli.php mails                        # wartende E-Mails sofort verschicken
```

Auf der Kommandozeile ist `php` bei World4You oft eine alte Version – mit `php -v` prüfen und sonst
`php84` bzw. `php83` statt `php` schreiben. Sicherungen holen: `scp -r BENUTZER@SERVER:HAUPTORDNER/app/daten/backups .`

### Andere Webspaces

Das Paket läuft auf jedem Webspace mit **Apache, PHP 8.1+ und der Erweiterung pdo_sqlite**. Bei
nginx statt Apache müssen die Regeln aus `.htaccess` in die Server-Konfiguration übernommen werden
(`app/` sperren, `api/<Funktion>` → `api.php?f=<Funktion>`).

### Lokal ausprobieren

```bash
npm run dev:server                 # http://127.0.0.1:3000 (PHP-Entwicklungsserver, ohne HTTPS)
npm run admin -- deine@email.at    # erstes Admin-Konto, zeigt das Startpasswort
```

### Sicherheit im Server-Modus

- Alle Rechte (Rollen, Statuswechsel, wer IBAN und Adresse sehen darf) prüft der Server
  ([`server/lib/honorare.php`](server/lib/honorare.php)); die Redaktion bekommt IBAN und Adresse gar
  nicht erst ausgeliefert – auch nicht in den E-Mails.
- Passwörter mit bcrypt gehasht, Startpasswörter müssen beim ersten Login geändert werden.
- Anmeldung über ein Sitzungs-Cookie (`HttpOnly`, `Secure`, `SameSite=Strict`), in der Datenbank
  nur als Hash gespeichert; Abmelden, Deaktivieren und Passwort-Reset beenden Sitzungen.
- Schutz vor gefälschten Anfragen fremder Seiten (CSRF), Begrenzung von Anmeldeversuchen,
  strenge Content-Security-Policy, HTTPS mit HSTS.
- Programmcode, Datenbank und Sicherungen liegen in `app/` und sind per `.htaccess` gesperrt.
- Das Passwort des E-Mail-Postfachs wird nie an den Browser geschickt und ist nicht im Datenexport.

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
npm run dev:server   # Server-Modus lokal auf Port 3000 (braucht PHP 8.1+)
npm test             # alle Tests: Hilfsfunktionen, Server (Rechte, Abläufe, Schutz, E-Mails)
HONORARE_PHP=php8.1 npm test   # dieselben Tests mit einer anderen PHP-Version
HONORARE_TEST_MYSQL='{"host":"127.0.0.1","benutzer":"…","passwort":"…"}' npm test   # Server-Tests mit MySQL
npm run paket        # Paket für World4You bauen
bash scripts/vendor.sh   # JSZip und pdf-lib aktualisieren
```

Aufbau: `public/` ist die Oberfläche (ohne Framework, ohne Build-Schritt), `server/` der Server in
PHP (`api.php` Schnittstelle und Schutz, `lib/honorare.php` Geschäftslogik, `lib/db.php` Datenbank,
`lib/auth.php` Passwörter und Sitzungen, `lib/artikel.php` Artikel von campus-a-college.at,
`lib/mail.php` und `lib/mail-vorlagen.php` E-Mails, `einrichten.php` Einrichtung, `cli.php`
Verwaltung, `router.php` nur für die Entwicklung), `deploy/world4you/` die Dateien fürs Paket.
Die Regeln, die Browser und Server beide kennen (IBAN, Nummer, Medien, Prämiensätze …), gibt es in
JavaScript (`public/js/lib/`) und PHP (`server/lib/regeln.php`); `tests/php-gleich.test.mjs` prüft,
dass beide gleich rechnen.
