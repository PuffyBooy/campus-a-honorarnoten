// Einrichtungsseite: Absenden klappt auch, wenn der Browser „Origin: null“ schickt (wie bei World4You beobachtet),
// und kommt nie wortlos zurück
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phpServerStarten } from './php-server.mjs';

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('Einrichtung: Token statt Origin-Prüfung, klare Meldungen', async () => {
  const php = await phpServerStarten();
  try {
    const seite = await fetch(`${php.basis}/einrichten.php`);
    const cookie = seite.headers.get('set-cookie').split(';')[0];
    const token = (await seite.text()).match(/name="token" value="([a-f0-9]{32})"/)[1];
    const absenden = (felder, kopf = {}) => fetch(`${php.basis}/einrichten.php`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...kopf }, body: new URLSearchParams(felder),
    }).then((r) => r.text()).then(text);
    const admin = { vorname: 'Alex', nachname: 'Admin', email: 'chef@example.org' };

    assert.match(await absenden(admin), /Das Formular konnte nicht bestätigt werden/, 'ohne Cookie und Token: Meldung');
    assert.match(await absenden({ ...admin, token: 'f'.repeat(32) }, { Cookie: cookie }), /nicht bestätigt/, 'falsches Token');
    assert.match(await absenden({ ...admin, email: 'kaputt', token }, { Cookie: cookie, Origin: 'null' }), /gültige E-Mail-Adresse/);
    const fertig = await absenden({ ...admin, token }, { Cookie: cookie, Origin: 'null' });
    assert.match(fertig, /Fertig eingerichtet/);
    assert.match(fertig, /Startpasswort [A-Za-z0-9]{10}/);
    assert.match(await absenden({ ...admin, token }, { Cookie: cookie }), /Bereits eingerichtet/);
  } finally {
    await php.stop();
  }
});
