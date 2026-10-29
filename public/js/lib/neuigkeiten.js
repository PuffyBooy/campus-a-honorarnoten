// „Was ist neu?“: Änderungen der App in einfachen Worten, neueste zuerst. Jeder Punkt kann auf Rollen beschränkt sein.
// Neue Einträge oben anfügen (id = Datum, bei mehreren am Tag mit Buchstaben).
export const NEUIGKEITEN = [
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
  return NEUIGKEITEN.map((e) => ({ ...e, punkte: e.punkte.filter(([r]) => passt(r, nutzer.rollen)).map(([, t]) => t) }))
    .filter((e) => e.punkte.length);
}

/** Noch nicht gesehene Einträge (neue Konten sehen nur, was nach ihrer Anmeldung neu ist) */
export function ungesehen(nutzer) {
  const seit = nutzer.neuigkeiten_gesehen ?? String(nutzer.erstellt_am ?? '').slice(0, 10);
  return neuigkeitenFuer(nutzer).filter((e) => e.id > seit);
}

export const NEUESTE = NEUIGKEITEN[0].id;
