// Verständliche Meldungen, wenn die Datenbank fehlt oder nicht erreichbar ist (statt „Interner Fehler“)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phpServerStarten } from './php-server.mjs';

const aufruf = async (basis) => {
  const res = await fetch(`${basis}/api/aktuellerNutzer`, { method: 'POST', headers: { 'X-Honorare': '1' }, body: '{}' });
  return { status: res.status, ...(await res.json()) };
};

test('MySQL nicht erreichbar: Hinweis auf die Einrichtung', async () => {
  const php = await phpServerStarten({
    envZusatz: { HONORARE_MYSQL: JSON.stringify({ host: '127.0.0.1', port: 1, name: 'x', benutzer: 'x', passwort: 'x' }), HONORARE_DATENBANK: '' },
  });
  try {
    const r = await aufruf(php.basis);
    assert.equal(r.status, 503);
    assert.match(r.fehler, /Keine Verbindung zur Datenbank.*einrichten\.php/);
  } finally {
    php.fehler.length = 0; // erwartete Log-Zeile
    await php.stop();
  }
});
