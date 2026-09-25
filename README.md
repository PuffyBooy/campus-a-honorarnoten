# campus a college – Honorarnoten

Web-App, mit der freie Mitarbeiter:innen Honorarnoten einreichen, die Redaktion sie
prüft und die Buchhaltung sie überweist.

- **Backend:** Supabase (Auth per Magic Link, Postgres, Row Level Security, Storage)
- **Frontend:** statische Seite (HTML/CSS/Vanilla-JS, kein Build-Framework) auf Netlify
- **Sprache:** Deutsch, mobil optimiert

---

## 1. Datenbankschema

Datei: [`supabase/migrations/20260925000000_honorarnoten.sql`](supabase/migrations/20260925000000_honorarnoten.sql)

| Tabelle | Inhalt | Wer liest? |
|---|---|---|
| `profiles` | E-Mail und Anzeigename pro Login (automatisch angelegt) | eigene Zeile, Admin |
| `user_roles` | Rollen pro Person: `autor`, `redaktion`, `buchhaltung`, `admin` | eigene Rollen, Admin |
| `honorarnoten` | Nummer, Status, Name, E-Mail, Art, Titel, Ausgabe, Leistungsdatum, Betrag (+ ursprünglicher Betrag, Korrektur-Vermerk), Notiz, PDF-Pfad, Ablehnungsgrund, Zeitstempel | siehe unten |
| `honorarnoten_zahlung` | **Adresse, Kontoinhaber:in, IBAN, BIC** (1:1 zu einer Note) | Autor:in (eigene), Buchhaltung (nur angenommene/bezahlte), Admin – **nicht die Redaktion** |
| `interne_kommentare` | Kommentare der Redaktion | nur Redaktion/Admin |
| `note_verlauf` | wer hat wann was gemacht (eingereicht, angenommen, abgelehnt, Betrag korrigiert, kommentiert, bezahlt) | nur Redaktion/Admin |
| `note_counters` | letzte vergebene Nummer pro Jahr | niemand direkt |
| `loeschprotokoll` | welche Nummer wann von wem gelöscht wurde (ohne Personendaten) | nur Admin |

Warum eine eigene Tabelle für IBAN & Adresse? Row Level Security wirkt auf **Zeilen**, nicht
auf Spalten. Damit die Redaktion die IBAN wirklich nicht sehen kann (auch nicht per direkter
API-Abfrage), liegen die Zahlungsdaten in einer getrennten Tabelle, für die es schlicht keine
Lese-Policy für die Redaktion gibt.

**Nummern** (`CC-2026-0001`) vergibt die Datenbank beim Einreichen atomar über `note_counters`
(pro Kalenderjahr, Wiener Zeit) – auch bei gleichzeitigem Einreichen gibt es keine Doppelten.

**Status-Ablauf:** `eingereicht` → `angenommen` / `abgelehnt` → `bezahlt`
(Die Redaktion kann eine Entscheidung korrigieren, solange nicht bezahlt ist; bezahlte Noten sind gesperrt.)

## 2. Rollen und Rechte

Grundprinzip: **Lesen** geht direkt über die Tabellen und wird durch RLS gefiltert.
**Schreiben** geht ausschließlich über Datenbankfunktionen (RPC), die Rolle, erlaubten
Status-Übergang und Pflichtfelder prüfen und den Verlauf schreiben. Eingeloggte Nutzer:innen
haben auf keine Tabelle INSERT/UPDATE/DELETE-Rechte. Das Frontend blendet Menüpunkte nur
zur Bequemlichkeit aus – die eigentliche Sicherheit liegt in der Datenbank.

| | Autor:in | Redaktion | Buchhaltung | Admin |
|---|---|---|---|---|
| Note einreichen (`honorarnote_einreichen`) | ✅ | ✅¹ | ✅¹ | ✅¹ |
| Eigene Noten + Status + Ablehnungsgrund sehen | ✅ | ✅ | ✅ | ✅ |
| Alle Noten sehen | – | ✅ | nur angenommene/bezahlte | ✅ |
| IBAN, BIC, Adresse sehen | nur eigene | **❌** | angenommene/bezahlte | ✅ |
| Annehmen / Ablehnen (Begründung Pflicht) | – | ✅ | – | ✅ |
| Betrag korrigieren (Vermerk Pflicht) | – | ✅ | – | ✅ |
| Interne Kommentare lesen/schreiben, Verlauf | – | ✅ | – | ✅ |
| Als bezahlt markieren | – | – | ✅ | ✅ |
| Note löschen (Datenschutz) | – | – | – | ✅ |
| PDF ansehen | eigene | ✅ | angenommene/bezahlte | ✅ |

¹ jede Person bekommt beim ersten Login automatisch die Rolle `autor`.

PDFs liegen im **privaten** Storage-Bucket `honorarnoten-pdf` unter `<user-id>/<zufall>.pdf`.
Hochladen nur in den eigenen Ordner; lesen darf, wer die zugehörige Note sehen darf. Links
sind signierte URLs mit 5–10 Minuten Gültigkeit.

**Schlüssel:** Im Frontend stehen nur Supabase-URL und der öffentliche *anon/publishable*
Key. Dieser Key hat von sich aus keine Rechte – alles regelt RLS (nicht eingeloggt: kein
Zugriff auf irgendetwas). Der *service_role*-Key wird nirgends im Frontend verwendet; das
Build-Skript bricht ab, falls er versehentlich eingetragen wird.

## 3. Einrichtung

### Supabase
1. Projekt auf [supabase.com](https://supabase.com) anlegen (Region EU, z. B. Frankfurt).
2. Im **SQL Editor** den Inhalt der Migration ausführen (oder `supabase db push` mit der CLI).
3. **Authentication → URL Configuration:** *Site URL* = Netlify-Adresse
   (z. B. `https://honorare-campus-a.netlify.app`), dieselbe Adresse auch unter *Redirect URLs*.
4. **Authentication → Emails → Magic Link**: Vorlage auf Deutsch anpassen. Damit man sich auch
   anmelden kann, wenn der Link auf einem anderen Gerät geöffnet wird, den Code mit ausgeben:
   ```html
   <h2>Anmelden bei den Honorarnoten von campus a college</h2>
   <p><a href="{{ .ConfirmationURL }}">Hier tippen, um dich anzumelden</a></p>
   <p>Oder diesen Code eingeben: <strong>{{ .Token }}</strong></p>
   ```
5. Für echten Betrieb unter **Authentication → SMTP** einen eigenen Mailversand einrichten
   (der eingebaute Supabase-Mailer ist stark limitiert).
6. Optional: Wer sich nicht selbst registrieren soll, unter *Authentication → Providers → Email*
   „Allow new users to sign up“ deaktivieren und Leute per *Invite* einladen.

### Rollen vergeben (Admin, im SQL Editor)
Die Person muss sich vorher einmal angemeldet haben.
```sql
-- Redaktion
insert into public.user_roles (user_id, role)
select id, 'redaktion' from auth.users where email = 'chefredaktion@example.org';

-- Buchhaltung
insert into public.user_roles (user_id, role)
select id, 'buchhaltung' from auth.users where email = 'kassa@example.org';

-- Admin
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'admin@example.org';

-- Rolle entziehen (z. B. Einreichen sperren)
delete from public.user_roles
where role = 'autor' and user_id = (select id from auth.users where email = 'x@example.org');

-- Anzeigename für Verlauf/Kommentare setzen
update public.profiles set anzeigename = 'Maria (Redaktion)' where email = 'chefredaktion@example.org';
```

### Netlify
1. Repository in Netlify verbinden – `netlify.toml` ist fertig konfiguriert
   (Publish-Ordner `public`, Sicherheits-Header inkl. Content-Security-Policy).
2. Unter *Site configuration → Environment variables* setzen:
   - `SUPABASE_URL` – z. B. `https://abcd1234.supabase.co`
   - `SUPABASE_ANON_KEY` – der **anon/publishable** Key (Settings → API)
   - `DATENSCHUTZ_KONTAKT` – E-Mail für Datenschutzanfragen (erscheint im Formular)
3. Deploy. Das Build-Skript erzeugt daraus `public/config.js`.

Bei einer eigenen Supabase-Domain (nicht `*.supabase.co`) die `connect-src` in `netlify.toml` ergänzen.

### E-Mail-Benachrichtigungen (optional)
Edge Function [`supabase/functions/notify-author`](supabase/functions/notify-author/index.ts)
schickt der Autor:in eine Mail bei Annahme, Ablehnung (mit Begründung) und Bezahlung – über
[Resend](https://resend.com) (Absender-Domain dort verifizieren).
```bash
supabase functions deploy notify-author --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_... WEBHOOK_SECRET=$(openssl rand -hex 24) \
  MAIL_FROM="campus a college <honorare@deine-domain.at>" APP_URL=https://honorare-campus-a.netlify.app
```
Dann in Supabase unter *Database → Webhooks* einen Webhook anlegen: Tabelle `honorarnoten`,
Ereignis **Update**, Typ *Supabase Edge Function* `notify-author`, HTTP-Header
`x-webhook-secret` = derselbe Wert wie `WEBHOOK_SECRET`.

## 4. Entwicklung

```bash
cp public/config.example.js public/config.js   # URL + anon-Key eintragen
npm run dev                                     # http://localhost:5173
npm test                                        # Unit-Tests (IBAN, GiroCode, CSV, Beträge)
npm run test:db                                 # RLS-/Ablauf-Tests gegen lokales Postgres
```
`test:db` braucht eine lokale PostgreSQL-Installation (`initdb`, `pg_ctl`); es baut die
Supabase-Schemas `auth`/`storage` minimal nach und prüft u. a., dass die Redaktion keine
IBAN sieht, Autor:innen nur eigene Noten sehen und niemand direkt in Tabellen schreiben kann.

Die Bibliotheken `supabase-js` und `qrcode-generator` liegen gebündelt in `public/vendor/`
(kein externes CDN → keine IP-Weitergabe an Dritte, strenge CSP). Aktualisieren mit
`bash scripts/vendor.sh`.

### Design anpassen
Farben stehen oben in [`public/css/style.css`](public/css/style.css) (`--marke`, `--akzent` …).
Das Logo in [`public/index.html`](public/index.html) an der markierten Stelle einsetzen
(z. B. `public/img/logo.svg`) und `public/img/favicon.svg` ersetzen.

## 5. Datenschutz
- IBAN/Adresse nur für Autor:in selbst, Buchhaltung (ab Annahme) und Admin lesbar.
- Verlauf und E-Mail-Benachrichtigungen enthalten keine Bankdaten.
- Datenschutzhinweis im Einreichformular.
- Admin kann Noten vollständig löschen (inkl. PDF, Kommentare, Verlauf); die Löschung wird
  ohne Personendaten protokolliert.
- Hinweis: Ein hochgeladenes PDF kann selbst Bankdaten enthalten und ist für die Redaktion
  sichtbar, damit sie die Leistung prüfen kann.
- Aufbewahrung: Buchhaltungsunterlagen sind in Österreich i. d. R. 7 Jahre aufzubewahren –
  vor dem Löschen bezahlter Noten den CSV-Export sichern.
