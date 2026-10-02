// Demo-Zugänge für die Vorführung (nur im Demo-Modus sichtbar)
export const DEMO_PASSWORT = 'demo1234';

export const DEMO_KONTEN = [
  // startet bei jedem Klick frisch: zeigt „Konto einrichten“ wie beim ersten Anmelden mit Startpasswort
  { email: 'neu@demo.at', rolle: 'Erstes Anmelden', text: 'Neue Autor:in – Konto einrichten', frisch: true },
  { email: 'maria@demo.at', rolle: 'Autor:in', text: 'Maria Musterfrau' },
  { email: 'redaktion@demo.at', rolle: 'Redaktion', text: 'Rita Redaktion' },
  { email: 'buchhaltung@demo.at', rolle: 'Buchhaltung', text: 'Bernd Buchhaltung' },
  { email: 'admin@demo.at', rolle: 'Admin', text: 'Alex Admin' },
];
