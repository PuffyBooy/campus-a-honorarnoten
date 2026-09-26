// Verwaltung auf dem Server (Kommandozeile)
//
//   npm run admin -- email@beispiel.at [Vorname] [Nachname]   erstes Admin-Konto anlegen
//   npm run passwort -- email@beispiel.at                      neues Startpasswort setzen
//   npm run backup [-- /pfad/ziel.sqlite]                      Sicherungskopie erstellen
import { join, resolve } from 'node:path';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { oeffneDatenbank, sichern } from './db.js';
import { konfiguration } from './server.js';
import { adminAnlegen } from './honorare.js';
import { passwortHash, startpasswort, alleSitzungenBeenden } from './auth.js';

const [befehl, ...args] = process.argv.slice(2);
const cfg = konfiguration();
const db = oeffneDatenbank(cfg.datenbank);

try {
  if (befehl === 'admin') {
    const [email, vorname, nachname] = args;
    if (!email) throw new Error('Aufruf: npm run admin -- email@beispiel.at [Vorname] [Nachname]');
    const { passwort } = await adminAnlegen(db, { email, vorname, nachname });
    console.log(`\nAdmin-Konto angelegt: ${email.toLowerCase()}\nStartpasswort:        ${passwort}\n`);
    console.log('Beim ersten Anmelden muss ein eigenes Passwort festgelegt werden.\n');
  } else if (befehl === 'passwort') {
    const email = String(args[0] ?? '').trim().toLowerCase();
    const n = db.prepare('select id from nutzer where email = ?').get(email);
    if (!n) throw new Error(`Kein Konto mit der E-Mail-Adresse ${email || '(leer)'} gefunden.`);
    const passwort = startpasswort();
    db.prepare('update nutzer set passwort = ?, muss_passwort_aendern = 1, aktiv = 1 where id = ?').run(await passwortHash(passwort), n.id);
    alleSitzungenBeenden(db, n.id);
    console.log(`\nNeues Startpasswort für ${email}: ${passwort}\n`);
  } else if (befehl === 'anzahl') {
    // Anzahl der Konten (für das Installationsskript)
    console.log(db.prepare('select count(*) c from nutzer').get().c);
  } else if (befehl === 'backup') {
    const ordner = resolve(join(cfg.datenbank, '..', 'backups'));
    const stempel = new Date().toISOString().slice(0, 23).replace(/[:T.]/g, '-');
    const ziel = args[0] ? resolve(args[0]) : join(ordner, `honorarnoten-${stempel}.sqlite`);
    sichern(db, ziel);
    console.log(`Sicherung erstellt: ${ziel}`);
    // automatische Sicherungen älter als BACKUP_TAGE (Standard 30) löschen
    if (!args[0]) {
      const tage = Number(process.env.BACKUP_TAGE ?? 30);
      for (const f of readdirSync(ordner)) {
        const pfad = join(ordner, f);
        const alt = Date.now() - statSync(pfad).mtimeMs > tage * 86400000;
        if (/^honorarnoten-.*\.sqlite$/.test(f) && pfad !== ziel && alt) rmSync(pfad);
      }
    }
  } else {
    console.log('Befehle: admin <email> [Vorname] [Nachname] | passwort <email> | backup [ziel]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`Fehler: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
