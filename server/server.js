// HTTP-Server: liefert die App aus (Ordner public/) und stellt die API bereit.
// Keine npm-Pakete nötig – nur Node.js ab Version 22.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oeffneDatenbank } from './db.js';
import { sitzungPruefen, abgelaufeneSitzungenLoeschen, SITZUNG_TAGE } from './auth.js';
import { funktionen, nutzerLaden, Fehler } from './honorare.js';

const WURZEL = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(WURZEL, 'public');

export const konfiguration = (env = process.env) => ({
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '127.0.0.1',
  datenbank: env.DATENBANK ?? join(WURZEL, 'daten', 'honorarnoten.sqlite'),
  // hinter Caddy/nginx: echte Client-IP aus X-Real-IP lesen
  proxy: (env.TRUST_PROXY ?? '1') === '1',
  // Secure-Cookie nur über HTTPS; für lokale Tests ohne HTTPS: COOKIE_SECURE=0
  cookieSecure: (env.COOKIE_SECURE ?? '1') === '1',
});

const COOKIE = 'hn_sitzung';
const MAX_BODY = 100 * 1024;

// Funktionen, die ohne Anmeldung aufgerufen werden dürfen
const OEFFENTLICH = new Set(['aktuellerNutzer', 'anmelden', 'abmelden', 'zugangAnfragen']);

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const SICHERHEITS_HEADER = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
    + "connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// ------------------------------------------------------------------ Begrenzung von Versuchen

class Begrenzer {
  constructor(max, fensterMs) {
    this.max = max;
    this.fenster = fensterMs;
    this.eintraege = new Map();
  }

  /** true, wenn der Versuch erlaubt ist */
  versuch(schluessel) {
    const jetzt = Date.now();
    const liste = (this.eintraege.get(schluessel) ?? []).filter((t) => jetzt - t < this.fenster);
    if (liste.length >= this.max) {
      this.eintraege.set(schluessel, liste);
      return false;
    }
    liste.push(jetzt);
    this.eintraege.set(schluessel, liste);
    return true;
  }

  aufraeumen() {
    const jetzt = Date.now();
    for (const [k, liste] of this.eintraege) {
      if (!liste.some((t) => jetzt - t < this.fenster)) this.eintraege.delete(k);
    }
  }
}

const VIERTELSTUNDE = 15 * 60 * 1000;
const begrenzer = {
  loginIp: new Begrenzer(30, VIERTELSTUNDE),
  loginEmail: new Begrenzer(10, VIERTELSTUNDE),
  anfrageIp: new Begrenzer(5, 60 * 60 * 1000),
  passwort: new Begrenzer(10, VIERTELSTUNDE),
  api: new Begrenzer(600, 60 * 1000),
};

// ------------------------------------------------------------------ Hilfsfunktionen

function cookieLesen(req) {
  for (const teil of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = teil.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

function cookieSetzen(res, wert, cfg) {
  const teile = [`${COOKIE}=${wert ?? ''}`, 'HttpOnly', 'SameSite=Strict', 'Path=/',
    wert ? `Max-Age=${SITZUNG_TAGE * 86400}` : 'Max-Age=0'];
  if (cfg.cookieSecure) teile.push('Secure');
  res.setHeader('Set-Cookie', teile.join('; '));
}

function clientIp(req, cfg) {
  const echt = cfg.proxy ? req.headers['x-real-ip'] : null;
  return String(echt || req.socket.remoteAddress || 'unbekannt');
}

function json(res, status, daten) {
  const text = JSON.stringify(daten);
  res.writeHead(status, {
    ...SICHERHEITS_HEADER,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function bodyLesen(req) {
  let groesse = 0;
  const teile = [];
  for await (const teil of req) {
    groesse += teil.length;
    if (groesse > MAX_BODY) throw new Fehler('Anfrage zu groß.', 413);
    teile.push(teil);
  }
  try {
    return JSON.parse(Buffer.concat(teile).toString('utf8') || '{}');
  } catch {
    throw new Fehler('Ungültige Anfrage.', 400);
  }
}

/**
 * Schutz gegen gefälschte Anfragen von fremden Webseiten (CSRF):
 * eigener Header (erzwingt bei fremden Seiten eine CORS-Vorabprüfung, die wir nie erlauben)
 * und – falls vorhanden – Origin muss zur eigenen Adresse passen.
 */
function herkunftOk(req) {
  if (req.headers['x-honorare'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ API

async function api(req, res, db, cfg, name) {
  if (req.method !== 'POST') return json(res, 405, { fehler: 'Nur POST erlaubt.' });
  if (!herkunftOk(req)) return json(res, 403, { fehler: 'Anfrage abgelehnt.' });
  if (!Object.hasOwn(funktionen, name)) return json(res, 404, { fehler: 'Unbekannte Funktion.' });

  const ip = clientIp(req, cfg);
  if (!begrenzer.api.versuch(ip)) return json(res, 429, { fehler: 'Zu viele Anfragen. Bitte kurz warten.' });

  const body = await bodyLesen(req);
  const args = Array.isArray(body.args) ? body.args : [];

  const token = cookieLesen(req);
  const nutzerId = sitzungPruefen(db, token);
  let nutzer = nutzerId ? nutzerLaden(db, nutzerId) : null;
  if (nutzer && !nutzer.aktiv) nutzer = null;
  if (!nutzer && !OEFFENTLICH.has(name)) return json(res, 401, { fehler: 'Bitte melde dich an.', abgemeldet: true });

  if (name === 'anmelden') {
    const email = String(args[0] ?? '').trim().toLowerCase();
    if (!begrenzer.loginIp.versuch(ip) || !begrenzer.loginEmail.versuch(email)) {
      return json(res, 429, { fehler: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' });
    }
  }
  if (name === 'zugangAnfragen' && !begrenzer.anfrageIp.versuch(ip)) {
    return json(res, 429, { fehler: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }
  if (['passwortAendern', 'erstesPasswortSetzen'].includes(name) && !begrenzer.passwort.versuch(nutzer?.id ?? ip)) {
    return json(res, 429, { fehler: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' });
  }

  // campusHolen: nur in Tests gesetzt (Abruf von campus-a-college.at ersetzen)
  const ctx = { db, nutzer, token: nutzerId ? token : null, campusHolen: cfg.campusHolen };
  const daten = await funktionen[name](ctx, ...args);
  if (ctx.neueSitzung) cookieSetzen(res, ctx.neueSitzung, cfg);
  if (ctx.sitzungLoeschen) cookieSetzen(res, null, cfg);
  return json(res, 200, { daten: daten ?? null });
}

// ------------------------------------------------------------------ Statische Dateien

async function datei(req, res, pfad) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, SICHERHEITS_HEADER);
    return res.end();
  }
  // Im Server-Modus meldet diese Datei dem Browser, dass die API benutzt wird
  if (pfad === '/js/modus.js') {
    res.writeHead(200, { ...SICHERHEITS_HEADER, 'Content-Type': TYPEN['.js'], 'Cache-Control': 'no-cache' });
    return res.end("export const MODUS = 'server';\n");
  }

  let relativ;
  try {
    relativ = decodeURIComponent(pfad === '/' ? '/index.html' : pfad);
  } catch {
    relativ = '/';
  }
  const ziel = normalize(join(PUBLIC, relativ));
  const versteckt = relativ.split('/').some((t) => t.startsWith('.'));
  if (!ziel.startsWith(PUBLIC + sep) || versteckt) {
    res.writeHead(404, SICHERHEITS_HEADER);
    return res.end('Nicht gefunden');
  }
  try {
    const info = await stat(ziel);
    if (!info.isFile()) throw new Error('keine Datei');
    const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    const kopf = {
      ...SICHERHEITS_HEADER,
      'Content-Type': TYPEN[extname(ziel)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, kopf);
      return res.end();
    }
    const inhalt = await readFile(ziel);
    res.writeHead(200, { ...kopf, 'Content-Length': inhalt.length });
    return res.end(req.method === 'HEAD' ? undefined : inhalt);
  } catch {
    res.writeHead(404, { ...SICHERHEITS_HEADER, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }
}

// ------------------------------------------------------------------ Start

export function serverErstellen(cfg = konfiguration()) {
  const db = oeffneDatenbank(cfg.datenbank);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, db, cfg, url.pathname.slice(5));
      return await datei(req, res, url.pathname);
    } catch (e) {
      if (e instanceof Fehler) return json(res, e.status, { fehler: e.message });
      console.error(new Date().toISOString(), req.method, url.pathname, e);
      if (!res.headersSent) return json(res, 500, { fehler: 'Interner Fehler. Bitte später erneut versuchen.' });
      return res.end();
    }
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;

  const aufraeumen = setInterval(() => {
    abgelaufeneSitzungenLoeschen(db);
    Object.values(begrenzer).forEach((b) => b.aufraeumen());
  }, 60 * 60 * 1000);
  aufraeumen.unref();
  server.on('close', () => {
    clearInterval(aufraeumen);
    db.close();
  });
  return { server, db };
}

const direktGestartet = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direktGestartet) {
  const cfg = konfiguration();
  const { server, db } = serverErstellen(cfg);
  const anzahl = db.prepare('select count(*) c from nutzer').get().c;
  server.listen(cfg.port, cfg.host, () => {
    console.log(`Honorarnoten läuft auf http://${cfg.host}:${cfg.port} (Datenbank: ${cfg.datenbank})`);
    if (!anzahl) console.log('Noch kein Konto vorhanden. Erstes Admin-Konto anlegen: npm run admin -- deine@email.at');
    if (!cfg.cookieSecure) console.log('Achtung: COOKIE_SECURE=0 – nur für lokale Tests ohne HTTPS verwenden!');
  });
  const beenden = () => server.close(() => process.exit(0));
  process.on('SIGTERM', beenden);
  process.on('SIGINT', beenden);
}
