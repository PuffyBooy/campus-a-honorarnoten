// Impressum, Datenschutzerklärung und der Hinweis, dass die App von jemandem betrieben wird, der nicht bei
// campus a angestellt ist (gemeinsam für Demo und Server). Die Angaben zum Betreiber trägt der Admin unter
// Admin → Einstellungen ein. Die Texte sind eine Vorlage – keine Rechtsberatung.
import { esc } from './format.js';

export const STANDARD_HOSTER = 'World4You Internet Services GmbH, Wolfgang-Pauli-Straße 2, BT3, 4020 Linz, Österreich';

export const BETREIBER_STANDARD = {
  name: '',               // wer die App betreibt (Person oder Verein)
  anschrift: '',          // Anschrift für das Impressum
  email: '',
  telefon: '',
  extern: true,           // nicht bei der campus a Medien GmbH angestellt -> Hinweis an alle
  hoster: STANDARD_HOSTER,
  zusatz_impressum: '',
  zusatz_datenschutz: '',
  stand: '',              // Zeitpunkt der letzten Änderung (Hinweis muss danach neu bestätigt werden)
};

export const betreiberOder = (b) => ({ ...BETREIBER_STANDARD, ...(b ?? {}) });

/** Muss allen der Hinweis „Betreiber nicht bei campus a angestellt“ gezeigt werden? */
export const hinweisAktiv = (b) => Boolean(b?.name && b.extern);

/** Hat diese Person den aktuellen Hinweis noch nicht bestätigt? */
export const hinweisOffen = (nutzer, b) => hinweisAktiv(b) && Boolean(nutzer)
  && (!nutzer.hinweis_bestaetigt_am || nutzer.hinweis_bestaetigt_am < (b.stand || ''));

const absaetze = (text) => String(text ?? '').trim().split(/\n{2,}/).filter(Boolean)
  .map((a) => `<p>${esc(a).replace(/\n/g, '<br>')}</p>`).join('');

const unternehmen = (r) => r.empfaenger?.name || 'campus a Medien GmbH';

/** Kurzer Hinweis (HTML) für Anmeldung, Konto einrichten und das Banner nach dem Anmelden */
export function hinweisHtml(r) {
  const b = betreiberOder(r.betreiber);
  if (!hinweisAktiv(b)) return '';
  return `<strong>Wichtiger Hinweis:</strong> Diese App wird von <strong>${esc(b.name)}</strong> betrieben
    – ${esc(b.name)} ist <strong>nicht bei der ${esc(unternehmen(r))} angestellt</strong>. Als Betreiber:in
    und Administrator:in hat ${esc(b.name)} Zugriff auf alle hier gespeicherten Daten, auch auf Adressen und
    Bankverbindungen. Gespeichert werden die Daten bei ${esc(b.hoster || STANDARD_HOSTER)}.
    Mehr in der <a href="#/datenschutz">Datenschutzerklärung</a>.`;
}

export function impressumHtml(r, { istDemo = false } = {}) {
  const b = betreiberOder(r.betreiber);
  const name = b.name || '[Name des Betreibers – unter Admin → Einstellungen eintragen]';
  const anschrift = b.anschrift || '[Anschrift]';
  return `
    <h1>Impressum</h1>
    ${istDemo ? '<p class="hinweisbox">Demo-Version: Die Angaben unten sind Beispiele.</p>' : ''}
    <h2>Medieninhaber und Betreiber dieser App</h2>
    <p>${esc(name)}<br>${esc(anschrift).replace(/\n/g, '<br>')}
      ${b.email ? `<br>E-Mail: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ''}
      ${b.telefon ? `<br>Telefon: ${esc(b.telefon)}` : ''}</p>
    <h2>Zweck</h2>
    <p>Diese Web-App ist ein internes Werkzeug zur Erfassung und Abrechnung von Anerkennungsprämien für
      <strong>campus a college</strong> und <strong>campus a</strong>. Sie ist nicht öffentlich zugänglich;
      ein Zugang wird nur auf Anfrage vergeben.</p>
    ${b.extern ? `<p>Die App wird nicht von der ${esc(unternehmen(r))} betrieben, sondern von ${esc(name)}, der/die
      nicht bei der ${esc(unternehmen(r))} angestellt ist.</p>` : ''}
    <h2>Rechnungsempfänger der Prämienabrechnungen</h2>
    <p>${esc(unternehmen(r))}${r.empfaenger?.strasse ? `<br>${esc(r.empfaenger.strasse)}` : ''}${r.empfaenger?.plz_ort ? `<br>${esc(r.empfaenger.plz_ort)}` : ''}</p>
    <h2>Hosting</h2>
    <p>${esc(b.hoster || STANDARD_HOSTER)}</p>
    ${absaetze(b.zusatz_impressum)}
    <p class="klein">Angaben gemäß § 5 E-Commerce-Gesetz und Offenlegung gemäß § 25 Mediengesetz.</p>`;
}

export function datenschutzHtml(r, { istDemo = false } = {}) {
  const b = betreiberOder(r.betreiber);
  const name = b.name || '[Name des Betreibers]';
  const kontakt = r.datenschutzKontakt || b.email;
  const firma = unternehmen(r);
  return `
    <h1>Datenschutzerklärung</h1>
    ${istDemo ? `<p class="hinweisbox"><strong>Demo-Version:</strong> In der Demo bleiben alle Daten nur im Speicher dieses
      Browsers und werden an niemanden geschickt. Der folgende Text gilt für die echte App auf dem Server.</p>` : ''}
    ${hinweisAktiv(b) ? `<aside class="hinweis-betreiber">${hinweisHtml(r).replace(/ Mehr in der <a[^>]*>Datenschutzerklärung<\/a>\./, '')}</aside>` : ''}

    <h2>1. Wer ist verantwortlich?</h2>
    <p>Die App dient der Abrechnung von Anerkennungsprämien gegenüber der <strong>${esc(firma)}</strong>
      ${r.empfaenger?.strasse ? `(${esc(r.empfaenger.strasse)}, ${esc(r.empfaenger.plz_ort ?? '')})` : ''}.
      Betrieben und technisch verwaltet wird sie von <strong>${esc(name)}</strong>${b.anschrift ? `, ${esc(b.anschrift.replace(/\n/g, ', '))}` : ''}${b.extern ? `
      – ${esc(name)} ist <strong>nicht bei der ${esc(firma)} angestellt</strong>` : ''}.</p>
    <p>Kontakt für Fragen zum Datenschutz:
      ${kontakt ? `<a href="mailto:${esc(kontakt)}">${esc(kontakt)}</a>` : '[E-Mail-Adresse unter Admin → Einstellungen eintragen]'}</p>

    <h2>2. Welche Daten werden verarbeitet?</h2>
    <ul>
      <li><strong>Konto:</strong> Vor- und Nachname, E-Mail-Adresse, Rollen, Passwort (nur als Hash gespeichert),
        Zeitpunkt der letzten Anmeldung.</li>
      <li><strong>Für die Auszahlung</strong> (nur Autor:innen): Adresse, Kontoinhaber:in, IBAN, BIC.</li>
      <li><strong>Profil-Links</strong> auf campus-a-college.at bzw. campus-a.at. Damit liest die App die dort
        <em>öffentlich</em> veröffentlichten Artikel (Titel, Datum, Ressort) aus, damit du sie als Leistung übernehmen kannst.</li>
      <li><strong>Leistungen und Prämienabrechnungen:</strong> Titel, Datum, Beträge, Notizen, Status, Begründungen,
        interne Kommentare der Redaktion und ein Verlauf, wer was wann geändert hat.</li>
      <li><strong>Zugangsanfragen:</strong> Name, E-Mail-Adresse und die Nachricht.</li>
      <li><strong>Technisch:</strong> ein Sitzungs-Cookie für die Anmeldung; IP-Adressen kurzzeitig (höchstens
        3 Stunden) zum Schutz vor dem Erraten von Passwörtern; Zugriffsprotokolle des Hosters.</li>
    </ul>

    <h2>3. Wofür und auf welcher Grundlage?</h2>
    <ul>
      <li>Erfassen, Prüfen, Abrechnen und Auszahlen der Anerkennungsprämien – Vertrag bzw. vorvertragliche Maßnahmen
        (Art. 6 Abs. 1 lit. b DSGVO).</li>
      <li>Aufbewahrung der Prämienabrechnungen als Buchhaltungsbelege – gesetzliche Pflicht (Art. 6 Abs. 1 lit. c DSGVO,
        § 132 BAO).</li>
      <li>Sicherheit der App (Anmeldung, Schutz vor Missbrauch, Sicherungskopien) – berechtigtes Interesse
        (Art. 6 Abs. 1 lit. f DSGVO).</li>
    </ul>

    <h2>4. Wer sieht die Daten?</h2>
    <ul>
      <li><strong>Redaktion:</strong> Leistungen und Prämienabrechnungen mit Namen – <em>ohne</em> Adresse und Bankverbindung.</li>
      <li><strong>Buchhaltung:</strong> angenommene Prämienabrechnungen mit Adresse und Bankverbindung, für die Überweisung.</li>
      <li><strong>Admin und Betreiber:in (${esc(name)}):</strong> alle Daten, weil sie die App verwalten
        (Konten, Sicherungen, Fehlerbehebung)${b.extern ? ` – <strong>auch wenn sie nicht bei der ${esc(firma)} angestellt sind</strong>` : ''}.</li>
      <li><strong>Hosting und E-Mail-Versand:</strong> ${esc(b.hoster || STANDARD_HOSTER)}. Die Daten liegen
        auf deren Servern in Österreich; der Hoster verarbeitet sie nur als Auftragsverarbeiter.</li>
      <li><strong>${esc(firma)}:</strong> bekommt die Prämienabrechnungen als Rechnungsempfänger.</li>
    </ul>
    <p>Es gibt keine Werbung, kein Tracking, keine Analyse-Dienste und keine eingebundenen fremden Inhalte
      (Schriften und Programmteile liegen auf demselben Server). Daten werden nicht in Länder außerhalb der EU übermittelt.</p>

    <h2>5. E-Mails</h2>
    <p>Die App verschickt automatische E-Mails (Zugangsdaten, Eingangsbestätigung, Annahme, Rückgabe, Zahlung;
      an die Redaktion bzw. Buchhaltung bei neuen Prämienabrechnungen). Dafür werden Name, E-Mail-Adresse, Nummer,
      Leistungen und Beträge der Prämienabrechnung verwendet – nie die Bankverbindung.</p>

    <h2>6. Wie lange?</h2>
    <ul>
      <li>Konto und Profil: bis zur Löschung des Kontos (auf Wunsch jederzeit).</li>
      <li>Abgeschickte Prämienabrechnungen: 7 Jahre (steuerliche Aufbewahrungspflicht), auch wenn das Konto gelöscht wird.</li>
      <li>Abgelehnte Zugangsanfragen und gespeicherte, nicht abgeschickte Leistungen: bis zur Löschung.</li>
      <li>Sicherungskopien: 30 Tage. Anmelde-Sitzungen: 14 Tage. Versandprotokoll der E-Mails: 90 Tage.</li>
    </ul>

    <h2>7. Cookies</h2>
    <p>Nur ein technisch notwendiges Cookie (<code>hn_sitzung</code>), damit du angemeldet bleibst. Es wird beim
      Abmelden gelöscht und läuft nach 14 Tagen ab. Dafür ist keine Einwilligung nötig.</p>

    <h2>8. Deine Rechte</h2>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
      Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO). Adresse und Bankverbindung kannst du im Profil
      selbst ändern. Für alles andere: ${kontakt ? `<a href="mailto:${esc(kontakt)}">${esc(kontakt)}</a>` : 'siehe Kontakt oben'}.</p>
    <p>Du kannst dich auch bei der österreichischen <strong>Datenschutzbehörde</strong> beschweren:
      Barichgasse 40–42, 1030 Wien, <a href="https://www.dsb.gv.at" target="_blank" rel="noopener noreferrer">www.dsb.gv.at</a>.</p>
    ${absaetze(b.zusatz_datenschutz)}
    ${b.stand ? `<p class="klein">Stand: ${esc(new Date(b.stand).toLocaleDateString('de-AT'))}</p>` : ''}`;
}
