// Passwörter (scrypt) und Sitzungen (Cookie, in der Datenbank nur als Hash gespeichert)
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SITZUNG_TAGE = 14;

export async function passwortHash(passwort) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(passwort), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function passwortPasst(gespeichert, passwort) {
  const [verfahren, saltB64, hashB64] = String(gespeichert ?? '').split('$');
  if (verfahren !== 'scrypt' || !saltB64 || !hashB64) return false;
  const soll = Buffer.from(hashB64, 'base64');
  const ist = await scryptAsync(String(passwort), Buffer.from(saltB64, 'base64'), soll.length, SCRYPT);
  return timingSafeEqual(soll, ist);
}

/** Gut lesbares Startpasswort ohne verwechselbare Zeichen (0/O, 1/l/I) */
export function startpasswort(laenge = 10) {
  const zeichen = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: laenge }, () => zeichen[randomInt(zeichen.length)]).join('');
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export function sitzungErstellen(db, nutzerId) {
  const token = randomBytes(32).toString('base64url');
  const jetzt = new Date();
  const ablauf = new Date(jetzt.getTime() + SITZUNG_TAGE * 86400000);
  db.prepare('insert into sitzungen (token_hash, nutzer_id, erstellt_am, laeuft_ab) values (?, ?, ?, ?)')
    .run(tokenHash(token), nutzerId, jetzt.toISOString(), ablauf.toISOString());
  return token;
}

/** Liefert die Nutzer-ID zur Sitzung (oder null) und verlängert die Sitzung. */
export function sitzungPruefen(db, token) {
  if (!token || token.length > 100) return null;
  const h = tokenHash(token);
  const s = db.prepare('select nutzer_id, laeuft_ab from sitzungen where token_hash = ?').get(h);
  if (!s) return null;
  const jetzt = Date.now();
  if (Date.parse(s.laeuft_ab) < jetzt) {
    db.prepare('delete from sitzungen where token_hash = ?').run(h);
    return null;
  }
  // höchstens einmal pro Stunde verlängern
  const neu = new Date(jetzt + SITZUNG_TAGE * 86400000);
  if (neu - Date.parse(s.laeuft_ab) > 3600000) {
    db.prepare('update sitzungen set laeuft_ab = ? where token_hash = ?').run(neu.toISOString(), h);
  }
  return s.nutzer_id;
}

export function sitzungBeenden(db, token) {
  if (token) db.prepare('delete from sitzungen where token_hash = ?').run(tokenHash(token));
}

export function alleSitzungenBeenden(db, nutzerId, ausserToken = null) {
  if (ausserToken) {
    db.prepare('delete from sitzungen where nutzer_id = ? and token_hash <> ?').run(nutzerId, tokenHash(ausserToken));
  } else {
    db.prepare('delete from sitzungen where nutzer_id = ?').run(nutzerId);
  }
}

export function abgelaufeneSitzungenLoeschen(db) {
  db.prepare('delete from sitzungen where laeuft_ab < ?').run(new Date().toISOString());
}
