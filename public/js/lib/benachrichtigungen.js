// E-Mail-Benachrichtigungen: Jedes Konto wählt im Profil selbst, welche E-Mails es bekommt.
// Welche zur Auswahl stehen, hängt von den Rollen ab (gemeinsam für Browser und Server – server/lib/regeln.php).
export const BENACHRICHTIGUNGEN = [
  { typ: 'neue_note', rollen: ['redaktion'], text: 'Neue Prämienabrechnung eingereicht (zum Prüfen)' },
  { typ: 'zur_zahlung', rollen: ['buchhaltung'], text: 'Prämienabrechnung angenommen (zur Zahlung)' },
  { typ: 'anfrage', rollen: ['admin'], text: 'Neue Zugangsanfrage' },
  { typ: 'probleme', rollen: ['admin'], text: 'Warnung bei Problemen (Fehler im Protokoll, z. B. Sicherung oder E-Mail-Versand)' },
  { typ: 'eingang', rollen: ['autor'], text: 'Bestätigung, wenn ich eine Prämienabrechnung abschicke' },
  { typ: 'erinnerung', rollen: ['autor'], text: 'Erinnerung vor Monatsende, wenn ich noch Leistungen nicht eingereicht habe' },
  { typ: 'angenommen', rollen: ['autor'], text: 'Meine Prämienabrechnung wurde angenommen' },
  { typ: 'abgelehnt', rollen: ['autor'], text: 'Meine Prämienabrechnung wurde zum Überarbeiten zurückgegeben' },
  { typ: 'bezahlt', rollen: ['autor'], text: 'Meine Anerkennungsprämie wurde überwiesen' },
  { typ: 'rueckfrage', rollen: ['autor'], text: 'Die Redaktion hat eine Rückfrage zu meiner Prämienabrechnung' },
];

// Admins dürfen auch die Mails von Redaktion und Buchhaltung bekommen – aber erst, wenn sie es einschalten
const FUER_ADMIN = ['neue_note', 'zur_zahlung'];

/** Benachrichtigungen, die für dieses Konto zur Auswahl stehen */
export function verfuegbareBenachrichtigungen(n) {
  const r = n?.rollen ?? [];
  return BENACHRICHTIGUNGEN.filter((b) => b.rollen.some((x) => r.includes(x)) || (r.includes('admin') && FUER_ADMIN.includes(b.typ)));
}

/** Ohne eigene Wahl: an – außer Redaktions- und Buchhaltungs-Mails für reine Admins */
function standard(n, typ) {
  const b = BENACHRICHTIGUNGEN.find((x) => x.typ === typ);
  return b.rollen.some((x) => n.rollen.includes(x));
}

/** Bekommt dieses Konto diese E-Mail? */
export function bekommt(n, typ) {
  if (!verfuegbareBenachrichtigungen(n).some((b) => b.typ === typ)) return false;
  const wahl = n.benachrichtigungen?.[typ];
  return typeof wahl === 'boolean' ? wahl : standard(n, typ);
}

/** Wahl speichern: nur verfügbare Arten, nur true/false */
export function benachrichtigungenNormalisieren(n, wahl) {
  const neu = { ...(n.benachrichtigungen ?? {}) };
  for (const { typ } of verfuegbareBenachrichtigungen(n)) {
    if (typeof wahl?.[typ] === 'boolean') neu[typ] = wahl[typ];
  }
  return neu;
}
