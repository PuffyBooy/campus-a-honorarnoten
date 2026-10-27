// Startet den PHP-Server (php -S mit server/router.php) für die Tests – mit eigener Datenbank-Datei,
// nachgebauten Seiten von campus-a-college.at und einem kleinen SMTP-Server, der Mails nur sammelt.
import { spawn, execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
// andere PHP-Version testen: HONORARE_PHP=php8.1 npm test
const PHP = process.env.HONORARE_PHP || 'php';

const freierPort = () => new Promise((ok) => {
  const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/** Ersatz für campus-a-college.at: GET /?url=<Adresse> liefert die Seite aus holen(url) */
async function campusErsatz(holen) {
  const server = httpServer(async (req, res) => {
    const url = new URL(req.url, 'http://x').searchParams.get('url');
    try {
      const html = await holen(url);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } catch (e) {
      res.writeHead(/404/.test(e.message) ? 404 : 502).end(e.message);
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, adresse: `http://127.0.0.1:${server.address().port}/` };
}

const wort = (t) => t.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

/** Mail aus dem SMTP-Gespräch: Empfänger, Betreff, Text- und HTML-Teil (base64) */
function mailLesen(an, roh) {
  const [kopf] = roh.split('\r\n\r\n');
  const betreff = wort(kopf.match(/^Subject: (.*)$/m)?.[1] ?? '');
  const teile = [...roh.matchAll(/Content-Type: text\/(plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)--hn-/g)];
  const teil = (art) => Buffer.from((teile.find((t) => t[1] === art)?.[2] ?? '').replace(/\s+/g, ''), 'base64').toString('utf8');
  return { an, betreff, von: wort(kopf.match(/^From: (.*)$/m)?.[1] ?? ''), text: teil('plain'), html: teil('html'), roh };
}

/** Kleiner SMTP-Server ohne Verschlüsselung; sammelt alle Mails in mails[] */
async function smtpAttrappe() {
  const mails = [];
  const anmeldungen = [];
  const server = netServer((s) => {
    let puffer = '';
    let daten = null;
    let an = '';
    let auth = 0;
    const sag = (z) => s.write(`${z}\r\n`);
    sag('220 test ESMTP');
    s.on('data', (stueck) => {
      puffer += stueck.toString('latin1');
      for (;;) {
        if (daten !== null) {
          const ende = puffer.indexOf('\r\n.\r\n');
          if (ende < 0) return;
          daten += puffer.slice(0, ende);
          puffer = puffer.slice(ende + 5);
          mails.push(mailLesen(an, Buffer.from(daten, 'latin1').toString('utf8').replace(/^\.\./gm, '.')));
          daten = null;
          sag('250 OK');
          continue;
        }
        const i = puffer.indexOf('\r\n');
        if (i < 0) return;
        const zeile = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        if (auth) {
          anmeldungen.push(Buffer.from(zeile, 'base64').toString());
          auth = auth === 1 ? 2 : 0;
          sag(auth ? '334 UGFzc3dvcmQ6' : '235 OK');
        } else if (/^EHLO/i.test(zeile)) sag('250-test\r\n250 AUTH LOGIN');
        else if (/^AUTH LOGIN/i.test(zeile)) { auth = 1; sag('334 VXNlcm5hbWU6'); }
        else if (/^MAIL FROM/i.test(zeile)) sag('250 OK');
        else if (/^RCPT TO:<(.*)>/i.test(zeile)) { an = zeile.match(/<(.*)>/)[1]; sag('250 OK'); }
        else if (/^DATA/i.test(zeile)) { daten = ''; sag('354 weiter'); }
        else if (/^RSET/i.test(zeile)) sag('250 OK');
        else if (/^QUIT/i.test(zeile)) { sag('221 tschüss'); s.end(); }
        else sag('500 ?');
      }
    });
    s.on('error', () => {});
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, port: server.address().port, mails, anmeldungen };
}

/**
 * PHP-Server starten; liefert basis, cli(), sql() und stop().
 * Mit MySQL statt SQLite: HONORARE_TEST_MYSQL='{"host":"127.0.0.1","benutzer":"…","passwort":"…"}' npm test
 * (legt für jeden Lauf eine eigene, leere Datenbank an und löscht sie danach)
 */
export async function phpServerStarten({ campusHolen, envZusatz = {} } = {}) {
  const ordner = mkdtempSync(join(tmpdir(), 'honorare-'));
  const campus = campusHolen ? await campusErsatz(campusHolen) : null;
  const smtp = await smtpAttrappe();
  const port = await freierPort();
  const env = { ...process.env, HONORARE_DATEN: ordner, HONORARE_CAMPUS_TEST: campus?.adresse ?? '' };
  delete env.HONORARE_DATENBANK;
  delete env.HONORARE_MYSQL;
  let mysql = null;
  if (process.env.HONORARE_TEST_MYSQL) {
    mysql = { ...JSON.parse(process.env.HONORARE_TEST_MYSQL), name: `hn_test_${process.pid}_${Date.now()}` };
    const { name, ...ohneName } = mysql;
    execFileSync(PHP, ['-r', `$k = json_decode(getenv('K'), true); (new PDO('mysql:host=' . $k['host'] . ';port=' . ($k['port'] ?? 3306), $k['benutzer'], $k['passwort']))->exec('create database ${'`'}${name}${'`'} character set utf8mb4');`],
      { env: { ...env, K: JSON.stringify(ohneName) } });
    env.HONORARE_MYSQL = JSON.stringify(mysql);
  } else {
    env.HONORARE_DATENBANK = join(ordner, 'honorarnoten.sqlite');
  }
  const envBasis = { ...env }; // zum Aufräumen der Test-Datenbank, auch wenn envZusatz sie verstellt
  Object.assign(env, envZusatz);
  const php = spawn(PHP, ['-d', 'display_errors=stderr', '-d', 'log_errors=0', '-S', `127.0.0.1:${port}`, join(WURZEL, 'server/router.php')],
    { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const fehler = [];
  php.stderr.on('data', (d) => {
    for (const z of d.toString().split('\n')) if (z.trim() && !/Accepted|Closing|Development Server|\[200\]|\[\d{3}\]:/.test(z)) fehler.push(z);
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${basis}/js/modus.js`); break; } catch { await new Promise((ok) => setTimeout(ok, 50)); }
  }
  const cli = (...args) => execFileSync(PHP, [join(WURZEL, 'server/cli.php'), ...args], { env, encoding: 'utf8' });
  /** SQL direkt in der Datenbank des Servers (für Sonderfälle in den Tests) */
  const sql = (anweisung, params = []) => JSON.parse(execFileSync(PHP, [join(WURZEL, 'tests/php/sql.php')],
    { env, encoding: 'utf8', input: JSON.stringify({ sql: anweisung, params }) }));
  const stop = async () => {
    php.kill();
    smtp.server.close();
    campus?.server.close();
    await new Promise((ok) => php.once('exit', ok));
    if (mysql) {
      execFileSync(PHP, [join(WURZEL, 'tests/php/sql.php')], { env: envBasis, input: JSON.stringify({ sql: `drop database \`${mysql.name}\`` }) });
    }
    rmSync(ordner, { recursive: true, force: true });
  };
  return { basis, cli, sql, stop, smtp, fehler, mysql: Boolean(mysql), ordner };
}

/** Wartet, bis eine passende Mail angekommen ist (die Mails gehen nach der Antwort hinaus) */
export async function mailAbwarten(smtp, filter, ms = 3000) {
  const ende = Date.now() + ms;
  for (;;) {
    const m = smtp.mails.find(filter);
    if (m) return m;
    if (Date.now() > ende) return null;
    await new Promise((ok) => setTimeout(ok, 25));
  }
}
