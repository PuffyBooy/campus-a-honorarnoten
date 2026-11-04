// „Was ist neu?“: Änderungen der App in einfachen Worten, neueste zuerst. Jeder Punkt kann auf Rollen beschränkt sein.
// Neue Einträge oben anfügen (id = Datum, bei mehreren am Tag mit Buchstaben).
export const NEUIGKEITEN = [
  {
    id: '2026-11-04b', datum: '2026-11-04', titel: 'Redigier-Zähler: mehr Wege zum automatischen Zählen', nur: 'redigier_zaehler',
    punkte: [
      ['redigieren', 'Mein Profil → „Automatisch zählen“: Lesezeichen „＋1 redigiert“ für jeden Browser (auch Safari und iPhone), die Chrome-Erweiterung oder ein persönlicher Schlüssel für Claude, Kurzbefehle und eigene Programme.'],
      ['redigieren', 'Kein Klick geht verloren: Der Zähler merkt sich jeden Klick sofort im Gerät und schickt ihn nach – auch wenn du die Seite gleich verlässt oder kein Netz hast.'],
    ],
  },
  {
    // nur, wo der Admin den Zähler eingeschaltet hat (noch im Test)
    id: '2026-11-04a', datum: '2026-11-04', titel: 'Redigieren mitzählen (Test)', nur: 'redigier_zaehler',
    punkte: [
      ['redigieren', 'In „Mein Monat“: nach jedem redigierten Text auf „＋1 redigiert“ tippen – der Stapel wächst mit. Am Monatsende mit einem Klick als Leistung übernehmen.'],
      ['redigieren', 'Am Handy: Seite „Zähler“ mit großem Knopf; in der installierten App beim langen Drücken aufs Symbol „＋1 redigiert“.'],
      ['redaktion', 'Neue Seite „Redigieren live“: wie viele Texte diesen Monat schon redigiert wurden, je Person, mit Verlauf über 12 Monate – auch als kleines eigenes Fenster.'],
    ],
  },
  {
    id: '2026-10-30c', datum: '2026-10-30', titel: 'Schneller: Seitenwechsel, Start und Einladen',
    punkte: [
      ['', 'Seitenwechsel brauchen nur noch eine Runde zum Server statt zwei bis drei; die App startet schneller (alle Programmdateien auf einmal).'],
      ['admin', 'Einladen und Personen anlegen warten nicht mehr auf den Mailserver – das Ergebnis der E-Mail erscheint ein paar Sekunden später.'],
      ['admin', 'Kommandozentrale: Engpass-Analyse jeder Anfrage (wo die Zeit hängt), Browser-Messung (Netz, Server, Seitenwechsel) und ein erweiterter Leistungstest.'],
    ],
  },
  {
    id: '2026-10-30b', datum: '2026-10-30', titel: 'Handy-App mit Push-Mitteilungen',
    punkte: [
      ['', 'Die App lässt sich jetzt aufs Handy oder den Computer installieren – mit eigenem Symbol, ohne Browserleiste (Mein Profil → Handy-App).'],
      ['', 'Push-Mitteilungen: Rückfragen, Annahme, Zahlung und neue Abrechnungen sofort auf dem Gerät – dieselbe Auswahl wie bei den E-Mails.'],
    ],
  },
  {
    id: '2026-10-30a', datum: '2026-10-30', titel: 'Jahresübersicht als PDF',
    punkte: [
      ['autor', 'In „Meine Abrechnungen“: alle Abrechnungen eines Jahres mit Summen als PDF – z. B. für Steuer oder Beihilfe.'],
    ],
  },
  {
    id: '2026-10-29e', datum: '2026-10-29', titel: 'Nummer der Prämienabrechnung selbst festlegen',
    punkte: [
      ['autor', 'Schon vor der App Prämienabrechnungen geschrieben? Unter „Mein Profil → Nummerierung“ (oder „ändern“ neben der Nummer) die letzte Nummer eintragen – die App zählt von dort weiter.'],
    ],
  },
  {
    id: '2026-10-29d', datum: '2026-10-29', titel: 'Buchhaltung: Abrechnungen einzeln herunterladen',
    punkte: [
      ['buchhaltung', 'Bei jeder Abrechnung „⬇ PDF“ und „⬇ Word“ – einzeln herunterladen.'],
      ['buchhaltung', '„Einzeln in Ordner“ pro Woche oder für alle: jede Abrechnung als eigene Datei – direkt in einen Ordner (Chrome, Edge) oder als ZIP, geordnet nach Woche und Person, auf Wunsch mit den Nachweisen.'],
    ],
  },
  {
    id: '2026-10-29c', datum: '2026-10-29', titel: 'Redaktion: schneller von Abrechnung zu Abrechnung',
    punkte: [
      ['redaktion', 'Der Wechsel zwischen Abrechnungen geht jetzt ohne Neuladen: Liste und Filter bleiben stehen, die nächste Abrechnung ist schon vorgeladen.'],
    ],
  },
  {
    id: '2026-10-29b', datum: '2026-10-29', titel: 'campus a und campus a college auf einmal einreichen',
    punkte: [
      ['autor', 'Wer für beide schreibt: in „Mein Monat“ mit „Beide einreichen …“ beide Prämienabrechnungen mit einem Klick abschicken.'],
    ],
  },
  {
    id: '2026-10-29', datum: '2026-10-29', titel: 'Schneller erfassen, besser finden',
    punkte: [
      ['autor', '„Wie letzten Monat“ in Mein Monat: wiederkehrende Leistungen mit einem Klick übernehmen – nur noch Titel und Datum eintragen.'],
      ['autor', 'Bei eingereichten Abrechnungen steht, bis wann die Überweisung ungefähr kommt.'],
      [null, 'Suche über alles: oben auf 🔍 oder Strg + K (Mac: ⌘ + K).'],
      [null, '„Was ist neu?“ – genau diese Seite.'],
      ['admin', 'Kommandozentrale: Funktionstest spielt den ganzen Ablauf durch und nimmt danach alles zurück.'],
      ['admin', 'Benutzer → „Ansehen als“ und Daten → Sicherung „Zurückspielen …“.'],
    ],
  },
  {
    id: '2026-10-28', datum: '2026-10-28', titel: 'Rückfragen, Nachweise und mehr Sicherheit',
    punkte: [
      ['redaktion', 'Nachfragen statt zurückgeben: kleiner Chat mit der Autor:in (Taste F in der Prüfansicht).'],
      ['autor', 'Rückfragen der Redaktion direkt in „Meine Abrechnungen“ beantworten.'],
      ['autor', 'Beim Redigieren einen Nachweis anhängen (PDF, Word …).'],
      ['autor', 'Zahlungsavis als PDF, wenn die Prämie überwiesen ist.'],
      ['autor', 'Erinnerung per E-Mail kurz vor Monatsende, wenn noch etwas nicht eingereicht ist.'],
      [null, 'Passwort vergessen? Link per E-Mail auf der Anmeldeseite.'],
      [null, 'Freiwillige Zwei-Faktor-Anmeldung im Profil.'],
      ['redaktion', 'Umschalter campus a / campus a college, Tastenkürzel und Vorlagen für Rückgabegründe.'],
      ['admin', 'Wartungsmodus, Warn-Mail bei Problemen und die Kommandozentrale für den Server.'],
    ],
  },
];

const passt = (rolle, rollen) => !rolle || rollen.includes(rolle) || (rolle !== 'autor' && rollen.includes('admin'));

/** Einträge mit den Punkten, die für dieses Konto gelten */
export function neuigkeitenFuer(nutzer) {
  return NEUIGKEITEN.filter((e) => !e.nur || nutzer[e.nur]).map((e) => ({ ...e, punkte: e.punkte.filter(([r]) => passt(r, nutzer.rollen)).map(([, t]) => t) }))
    .filter((e) => e.punkte.length);
}

/** Noch nicht gesehene Einträge (neue Konten sehen nur, was nach ihrer Anmeldung neu ist) */
export function ungesehen(nutzer) {
  const seit = nutzer.neuigkeiten_gesehen ?? String(nutzer.erstellt_am ?? '').slice(0, 10);
  return neuigkeitenFuer(nutzer).filter((e) => e.id > seit);
}

export const NEUESTE = NEUIGKEITEN[0].id;
