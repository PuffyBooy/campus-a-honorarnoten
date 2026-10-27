// Tests für den Server (PHP, wie auf World4You): Rollen, Rechte, Abläufe und E-Mails über die echte HTTP-API
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { phpServerStarten, mailAbwarten } from './php-server.mjs';
import { CAMPUS_A_PROFIL, campusSeiten, campusHolen } from './campus-fixtures.mjs';

let php;
let basis;

before(async () => {
  php = await phpServerStarten({ campusHolen });
  basis = php.basis;
});

after(async () => {
  await php.stop();
  assert.deepEqual(php.fehler, [], 'keine PHP-Fehler oder Warnungen');
});


/** kleiner Client mit eigenem Cookie – wie ein Browser */
function client() {
  let cookie = '';
  const aufruf = async (name, ...args) => {
    const res = await fetch(`${basis}/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Honorare': '1', Cookie: cookie },
      body: JSON.stringify({ args }),
    });
    const neu = res.headers.get('set-cookie');
    if (neu) cookie = neu.split(';')[0];
    const body = await res.json();
    return { status: res.status, ...body };
  };
  /** erwartet Erfolg und liefert die Daten */
  const ok = async (name, ...args) => {
    const r = await aufruf(name, ...args);
    assert.equal(r.status, 200, `${name}: ${r.fehler}`);
    return r.daten;
  };
  return { aufruf, ok };
}

async function anmeldenMitNeuemPasswort(c, email, startPw, neu = 'geheim12345') {
  await c.ok('anmelden', email, startPw);
  await c.ok('erstesPasswortSetzen', neu);
}

const AT_IBAN = 'AT611904300234573201';
const k = {};

test('erstes Admin-Konto und Startpasswort', async () => {
  const passwort = php.cli('admin', 'Admin@Example.org', 'Alex', 'Admin').match(/Startpasswort:\s+(\S+)/)[1];
  k.admin = client();
  const ich = await k.admin.ok('anmelden', 'admin@example.org', passwort);
  assert.equal(ich.muss_passwort_aendern, true);
  // mit Startpasswort ist nichts anderes erlaubt
  assert.equal((await k.admin.aufruf('nutzerListe')).status, 403);
  assert.match((await k.admin.aufruf('erstesPasswortSetzen', passwort)).fehler, /Startpasswort/);
  await k.admin.ok('erstesPasswortSetzen', 'admin-passwort-1');
  assert.equal((await k.admin.ok('aktuellerNutzer')).muss_passwort_aendern, false);
});

test('E-Mail-Versand einrichten (Admin): Passwort bleibt geheim, Test-E-Mail', async () => {
  const mail = {
    aktiv: true, host: '127.0.0.1', port: php.smtp.port, verschluesselung: 'keine', benutzer: 'office@example.org',
    passwort: 'smtp-geheim', absender: 'office@example.org', absender_name: 'campus a Office',
    antwort_an: 'kontakt@example.org', adresse: 'https://honorare.example.org',
  };
  assert.match((await k.admin.aufruf('mailEinstellungenSpeichern', { ...mail, antwort_an: 'kein-mail' })).fehler, /gültige E-Mail/);
  await k.admin.ok('mailEinstellungenSpeichern', mail);
  const e = await k.admin.ok('mailEinstellungen');
  assert.equal(e.passwort, undefined, 'Passwort wird nie ausgeliefert');
  assert.equal(e.passwort_gesetzt, true);
  assert.equal(e.adresse, 'https://honorare.example.org/');
  // leeres Passwortfeld = unverändert
  await k.admin.ok('mailEinstellungenSpeichern', { ...mail, passwort: '' });
  const test = await k.admin.ok('testMail');
  assert.equal(test.an, 'admin@example.org');
  const m = php.smtp.mails.find((x) => x.betreff === 'Test-E-Mail der Anerkennungsprämien');
  assert.ok(m, 'Test-E-Mail angekommen');
  assert.equal(m.an, 'admin@example.org');
  assert.deepEqual(php.smtp.anmeldungen.slice(-2), ['office@example.org', 'smtp-geheim'], 'Anmeldung mit gespeichertem Passwort');
  assert.match(m.von, /"campus a Office" <office@example\.org>/);
  assert.match(m.roh, /^Reply-To: <kontakt@example\.org>$/m, 'Antworten gehen an die zweite Adresse');
  assert.match(m.html, /Der E-Mail-Versand funktioniert/);
  assert.match(m.text, /Zur App: https:\/\/honorare\.example\.org\//);
  assert.equal((await k.admin.aufruf('mailEinstellungen')).status, 200);
});

test('Anmeldung: falsches Passwort und unbekannte E-Mail geben dieselbe Meldung', async () => {
  const c = client();
  const a = await c.aufruf('anmelden', 'admin@example.org', 'falsch');
  const b = await c.aufruf('anmelden', 'gibtsnicht@example.org', 'falsch');
  assert.equal(a.status, 401);
  assert.equal(a.fehler, b.fehler);
});

test('Zugang anfragen und freischalten', async () => {
  const gast = client();
  assert.equal((await gast.aufruf('nutzerListe')).status, 401);
  // ohne Bestätigung von Datenschutzerklärung und Hinweis keine Anfrage
  assert.match((await gast.aufruf('zugangAnfragen', { vorname: 'Anna', nachname: 'Autorin', email: 'anna@example.org' })).fehler, /Datenschutzerklärung/);
  await gast.ok('zugangAnfragen', { vorname: 'Anna', nachname: 'Autorin', email: 'anna@example.org', nachricht: 'Hallo', zustimmung: true });
  await gast.ok('zugangAnfragen', { vorname: 'Bert', nachname: 'Beispiel', email: 'bert@example.org', zustimmung: true });
  // existierendes Konto: gleiche Antwort, aber keine Anfrage
  await gast.ok('zugangAnfragen', { vorname: 'X', nachname: 'Y', email: 'admin@example.org', zustimmung: true });

  const anfragen = await k.admin.ok('anfragen');
  assert.deepEqual(anfragen.map((a) => a.email).sort(), ['anna@example.org', 'bert@example.org']);
  assert.ok(anfragen.every((a) => a.zustimmung_am), 'Zeitpunkt der Bestätigung wird gespeichert');
  assert.equal(await k.admin.ok('offeneAnfragenAnzahl'), 2);

  const zugang = {};
  for (const a of anfragen) zugang[a.email] = await k.admin.ok('anfrageFreischalten', a.id, ['autor']);
  assert.equal(zugang['anna@example.org'].mail, true, 'Zugangsdaten gehen per E-Mail hinaus');
  k.zugang = zugang;
  assert.match((await k.admin.aufruf('anfrageFreischalten', anfragen[0].id, ['autor'])).fehler, /bereits bearbeitet/);

  k.anna = client();
  await anmeldenMitNeuemPasswort(k.anna, 'anna@example.org', zugang['anna@example.org'].passwort);
  k.bert = client();
  await anmeldenMitNeuemPasswort(k.bert, 'bert@example.org', zugang['bert@example.org'].passwort);
  await k.bert.ok('profilSpeichern', {
    vorname: 'Bert', nachname: 'Beispiel', email: 'bert@example.org', strasse: 'Weg 2', plz_ort: '8010 Graz',
    kontoinhaber: 'Bert Beispiel', iban: 'DE89370400440532013000', campus_a_profil: `https://campus-a.at/profil/${CAMPUS_A_PROFIL}`,
  });

  // Redaktion und Buchhaltung direkt anlegen
  const r = await k.admin.ok('nutzerAnlegen', { vorname: 'Rita', nachname: 'Redaktion', email: 'rita@example.org', rollen: ['redaktion'] });
  const b = await k.admin.ok('nutzerAnlegen', { vorname: 'Bernd', nachname: 'Kasse', email: 'kasse@example.org', rollen: ['buchhaltung'] });
  k.rita = client();
  await anmeldenMitNeuemPasswort(k.rita, r.email, r.passwort);
  k.kasse = client();
  await anmeldenMitNeuemPasswort(k.kasse, b.email, b.passwort);
});

test('Autor:in: Profil, Leistungen, Monatsabrechnung', async () => {
  const a = k.anna;
  assert.match((await a.aufruf('profilSpeichern', { vorname: 'Anna', nachname: 'Autorin', email: 'anna@example.org', iban: 'AT00 0000 0000 0000 0000' })).fehler, /IBAN|Prüfziffer/);
  // Konto einrichten ist Pflicht: ohne Adresse, Bankverbindung und Profil-Link geht nichts
  const leistung = { kategorie: 'kolumne', titel: 'X', veroeffentlichung: '2026-09-01', betrag: 15 };
  const gesperrt = await a.aufruf('leistungSpeichern', leistung);
  assert.equal(gesperrt.status, 403);
  assert.match(gesperrt.fehler, /Konto einrichten/);
  const profil = {
    vorname: 'Anna', nachname: 'Müller', email: 'anna@example.org', strasse: 'Hauptstraße 1', plz_ort: '1010 Wien',
    kontoinhaber: 'Anna Müller', iban: 'at61 1904 3002 3457 3201', bic: 'bkauatww',
  };
  await a.ok('profilSpeichern', profil);
  assert.match((await a.aufruf('meineLeistungen')).fehler, /Profil-Link/, 'ohne Profil-Link noch gesperrt');
  assert.match((await a.aufruf('profilSpeichern', { ...profil, campus_profil: 'https://campus-a.at/profil/ae1054937a1ae033e117' })).fehler,
    /Profil auf campus-a-college\.at/, 'Link der falschen Seite');
  await a.ok('profilSpeichern', { ...profil, campus_profil: 'https://www.campus-a-college.at/profil/ae1054937a1ae033e117' });
  assert.equal((await a.ok('aktuellerNutzer')).profil.iban, AT_IBAN);
  assert.deepEqual(await a.ok('meineLeistungen'), []);

  assert.match((await a.aufruf('leistungSpeichern', { kategorie: 'ausserordentlich', art: 'Interview', titel: 'X', veroeffentlichung: '2026-09-01', betrag: 10 })).fehler, /vereinbart/);
  assert.match((await a.aufruf('leistungSpeichern', { kategorie: 'ausserordentlich', art: ' ', titel: 'X', veroeffentlichung: '2026-09-01', betrag: 10, vereinbart_mit: 'Rita' })).fehler, /Art der Anerkennungsprämie/);
  assert.match((await a.aufruf('leistungSpeichern', { kategorie: 'kolumne', kolumnenart: 'Schule', titel: 'X', veroeffentlichung: '2026-09-01', betrag: 10.005 })).fehler, /Betrag/);
  await a.ok('leistungSpeichern', { kategorie: 'kolumne', kolumnenart: 'Schule', titel: 'Kolumne 1', veroeffentlichung: '2026-09-01', betrag: 15 });
  await a.ok('leistungSpeichern', { kategorie: 'ausserordentlich', art: 'Interview', titel: 'Interview', veroeffentlichung: '2026-09-05', betrag: 60.5, vereinbart_mit: 'Rita' });
  const liste = await a.ok('meineLeistungen');
  assert.equal(liste.length, 2);
  assert.equal(liste[1].betrag, 60.5);

  // Bert kann Annas Leistung weder ändern noch löschen
  assert.equal((await k.bert.aufruf('leistungLoeschen', liste[0].id)).status, 404);

  const jahr = new Date().getFullYear();
  assert.equal((await a.ok('naechsteNummer')).nummer, `MUELLER-AN-${jahr}-01`);
  const note = await a.ok('abrechnungAbschicken', liste.map((p) => p.id));
  assert.equal(note.nummer, `MUELLER-AN-${jahr}-01`);
  assert.equal(note.betrag, 75.5);
  assert.equal(note.zahlung.iban, AT_IBAN);
  assert.equal((await a.ok('meineLeistungen')).length, 0);
  assert.equal((await a.ok('naechsteNummer')).nummer, `MUELLER-AN-${jahr}-02`);
  k.note = note;
});

test('Sichtbarkeit: fremde Noten und Rollen', async () => {
  assert.equal((await k.bert.aufruf('note', k.note.id)).status, 403);
  assert.equal((await k.bert.aufruf('alleNoten')).status, 403);
  assert.equal((await k.anna.aufruf('annehmen', k.note.id)).status, 403);
  assert.equal((await k.kasse.aufruf('note', k.note.id)).status, 403, 'Buchhaltung sieht eingereichte Noten nicht');
  assert.equal((await k.kasse.ok('offeneZahlungen')).length, 0);
});

test('Redaktion sieht keine IBAN und keine Adresse', async () => {
  const alle = await k.rita.ok('alleNoten');
  assert.equal(alle.length, 1);
  const text = JSON.stringify([alle, await k.rita.ok('note', k.note.id)]);
  assert.ok(!text.includes(AT_IBAN) && !text.includes('Hauptstraße') && !text.includes('BKAUATWW'));
  assert.equal(alle[0].zahlung, undefined);
});

test('Redaktion: ablehnen, korrigieren, kommentieren, annehmen', async () => {
  const r = k.rita;
  assert.match((await r.aufruf('ablehnen', k.note.id, '  ')).fehler, /Begründung/);
  const pos = k.note.positionen.find((p) => p.titel === 'Interview');
  assert.match((await r.aufruf('betragKorrigieren', k.note.id, pos.id, 50, '')).fehler, /Vermerk/);
  await r.ok('betragKorrigieren', k.note.id, pos.id, 50, 'Laut Vereinbarung');
  await r.ok('kommentieren', k.note.id, 'Passt');
  await r.ok('annehmen', k.note.id);
  assert.match((await r.aufruf('annehmen', k.note.id)).fehler, /nicht angenommen/);
  const verlauf = await r.ok('verlaufVon', k.note.id);
  assert.deepEqual(verlauf.map((v) => v.aktion).sort(), ['angenommen', 'betrag_korrigiert', 'eingereicht', 'kommentar']);
  assert.equal(verlauf.find((v) => v.aktion === 'angenommen').akteur_name, 'Rita Redaktion');
  // Autor:in sieht keine internen Kommentare und keinen Verlauf
  assert.equal((await k.anna.aufruf('kommentare', k.note.id)).status, 403);
  assert.equal((await k.anna.aufruf('verlaufVon', k.note.id)).status, 403);
  const meine = await k.anna.ok('meineNoten');
  assert.equal(meine[0].betrag, 65);
  assert.equal(meine[0].positionen.find((p) => p.titel === 'Interview').betrag_vermerk, 'Laut Vereinbarung');
});

test('Buchhaltung: bezahlen', async () => {
  const b = k.kasse;
  const offen = await b.ok('offeneZahlungen');
  assert.equal(offen.length, 1);
  assert.equal(offen[0].zahlung.iban, AT_IBAN, 'Buchhaltung sieht IBAN angenommener Noten');
  assert.equal((await k.rita.aufruf('alsBezahltMarkieren', k.note.id, '2026-01-01')).status, 403);
  assert.match((await b.aufruf('alsBezahltMarkieren', k.note.id, '2999-01-01')).fehler, /Zahlungsdatum/);
  const heute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date());
  const bezahlt = await b.ok('alsBezahltMarkieren', k.note.id, heute);
  assert.equal(bezahlt.status, 'bezahlt');
  assert.equal((await b.ok('bezahlteNoten', heute.slice(0, 7))).length, 1);
  assert.match((await k.rita.aufruf('betragKorrigieren', k.note.id, k.note.positionen[0].id, 20, 'x')).fehler, /Bezahlte/);
});

test('Abgelehnte Note überarbeiten', async () => {
  await k.bert.ok('profilSpeichern', {
    vorname: 'Bert', nachname: 'Beispiel', email: 'bert@example.org', strasse: 'Weg 2', plz_ort: '8010 Graz',
    kontoinhaber: 'Bert Beispiel', iban: 'DE89370400440532013000', campus_a_profil: `https://campus-a.at/profil/${CAMPUS_A_PROFIL}`,
  });
  await k.bert.ok('leistungSpeichern', { kategorie: 'kolumne', kolumnenart: 'Stadt', titel: 'Graz', veroeffentlichung: '2026-09-02', betrag: 15 });
  const note = await k.bert.ok('abrechnungAbschicken', (await k.bert.ok('meineLeistungen')).map((p) => p.id));
  assert.equal((await k.bert.ok('meineLeistungen')).length, 0);
  await k.rita.ok('ablehnen', note.id, 'Nicht erschienen');
  const abgelehnt = (await k.bert.ok('meineNoten'))[0];
  assert.equal(abgelehnt.ablehnungsgrund, 'Nicht erschienen');
  assert.ok(abgelehnt.zurueckgeholt_am, 'Ablehnen gibt die Leistungen sofort zurück');
  // die Leistungen sind sofort wieder bei Bert, mit Hinweis auf Note und Begründung
  const zurueck = await k.bert.ok('meineLeistungen');
  assert.deepEqual(zurueck.map((p) => [p.titel, p.betrag, p.zurueck_nummer, p.zurueck_grund]), [['Graz', 15, note.nummer, 'Nicht erschienen']]);
  assert.match((await k.bert.aufruf('leistungenZurueckholen', note.id)).fehler, /bereits/);
  assert.match((await k.rita.aufruf('annehmen', note.id)).fehler, /überarbeitet/);
  assert.ok((await k.rita.ok('verlaufVon', note.id)).some((v) => v.aktion === 'zurueckgeholt' && v.akteur_name === 'Rita Redaktion'));
  // überarbeiten und als neue Prämienabrechnung abschicken
  await k.bert.ok('leistungSpeichern', { ...zurueck[0], titel: 'Graz (korrigiert)' });
  const neu = await k.bert.ok('abrechnungAbschicken', [zurueck[0].id]);
  assert.notEqual(neu.nummer, note.nummer);
  assert.equal(neu.positionen[0].titel, 'Graz (korrigiert)');
});

test('Abgeschickte Note zurückziehen, solange sie nicht angenommen ist', async () => {
  await k.bert.ok('leistungSpeichern', { kategorie: 'kolumne', titel: 'Leoben', veroeffentlichung: '2026-09-05', betrag: 15 });
  const ids = (await k.bert.ok('meineLeistungen')).map((p) => p.id);
  const note = await k.bert.ok('abrechnungAbschicken', ids);
  assert.equal((await k.rita.aufruf('abrechnungZurueckziehen', note.id)).status, 403);
  await k.bert.ok('abrechnungZurueckziehen', note.id);
  assert.ok(!(await k.bert.ok('meineNoten')).some((n) => n.id === note.id), 'die Abrechnung ist weg');
  assert.equal((await k.rita.aufruf('note', note.id)).status, 404);
  const zurueck = await k.bert.ok('meineLeistungen');
  assert.deepEqual(zurueck.map((p) => [p.titel, p.zurueck_nummer, p.zurueck_grund]), [['Leoben', note.nummer, '']]);
  assert.ok((await k.admin.ok('loeschprotokoll')).some((l) => l.nummer === note.nummer && /zurückgezogen/.test(l.geloescht_von)));
  // neu einreichen: die Nummer wird wieder verwendet, weil es die letzte war
  const neu = await k.bert.ok('abrechnungAbschicken', zurueck.map((p) => p.id));
  assert.equal(neu.nummer, note.nummer);
  await k.rita.ok('annehmen', neu.id);
  assert.match((await k.bert.aufruf('abrechnungZurueckziehen', neu.id)).fehler, /schon geprüft/);
});

test('Redaktion: Haken „geprüft“ pro Leistung', async () => {
  await k.bert.ok('leistungSpeichern', { kategorie: 'kolumne', titel: 'Bruck', veroeffentlichung: '2026-09-06', betrag: 15 });
  const note = await k.bert.ok('abrechnungAbschicken', (await k.bert.ok('meineLeistungen')).map((p) => p.id));
  const pid = note.positionen[0].id;
  assert.equal(note.positionen[0].geprueft_am, null);
  assert.equal((await k.bert.aufruf('positionPruefen', note.id, pid, true)).status, 403);
  await k.rita.ok('positionPruefen', note.id, pid, true);
  await k.rita.ok('positionPruefen', note.id, pid, true); // zweimal geht auch (MySQL meldet dann 0 geänderte Zeilen)
  let p = (await k.rita.ok('note', note.id)).positionen[0];
  assert.equal(p.geprueft_von, 'Rita Redaktion');
  assert.ok(p.geprueft_am);
  await k.rita.ok('positionPruefen', note.id, pid, false);
  p = (await k.rita.ok('note', note.id)).positionen[0];
  assert.deepEqual([p.geprueft_von, p.geprueft_am], [null, null]);
  assert.equal((await k.rita.aufruf('positionPruefen', note.id, 'gibt-es-nicht', true)).status, 404);
  await k.rita.ok('annehmen', note.id);
});

test('Admin: Rollen, letzter Admin, Deaktivieren beendet Sitzungen', async () => {
  const ich = await k.admin.ok('aktuellerNutzer');
  assert.match((await k.admin.aufruf('rollenSetzen', ich.id, ['autor'])).fehler, /Admin-Konto/);
  assert.match((await k.admin.aufruf('nutzerAktivSetzen', ich.id, false)).fehler, /eigenes Konto/);
  const bert = (await k.admin.ok('nutzerListe')).find((n) => n.email === 'bert@example.org');
  assert.equal(bert.passwort, undefined, 'Passwort-Hash wird nie ausgeliefert');
  await k.admin.ok('nutzerAktivSetzen', bert.id, false);
  assert.equal((await k.bert.aufruf('meineNoten')).status, 401);
  assert.equal((await client().aufruf('anmelden', 'bert@example.org', 'geheim12345')).status, 403);
  await k.admin.ok('nutzerAktivSetzen', bert.id, true);
});

test('Zahlungskonto (SEPA): nur Admin speichert, Buchhaltung liest, sonst niemand', async () => {
  assert.deepEqual(await k.kasse.ok('zahlungskonto'), { name: '', iban: '', bic: '' });
  assert.equal((await k.rita.aufruf('zahlungskonto')).status, 403);
  assert.equal((await k.kasse.aufruf('zahlungskontoSpeichern', { name: 'x', iban: 'AT022050302101023600' })).status, 403);
  assert.match((await k.admin.aufruf('zahlungskontoSpeichern', { name: 'Firma', iban: 'AT00 1234' })).fehler, /IBAN/);
  assert.match((await k.admin.aufruf('zahlungskontoSpeichern', { iban: 'AT022050302101023600' })).fehler, /Namen/);
  const konto = await k.admin.ok('zahlungskontoSpeichern', { name: ' campus a Medien GmbH ', iban: 'at02 2050 3021 0102 3600', bic: 'spihat22xxx' });
  assert.deepEqual(konto, { name: 'campus a Medien GmbH', iban: 'AT022050302101023600', bic: 'SPIHAT22XXX' });
  assert.deepEqual(await k.kasse.ok('zahlungskonto'), konto);
  assert.equal((await k.rita.ok('einstellungen')).zahlungskonto, undefined, 'nicht in den allgemeinen Einstellungen');
});

test('Buchhaltung: PDF an sich selbst mailen (als Anhang)', async () => {
  const pdf = Buffer.from('%PDF-1.7\nTest\n%%EOF').toString('base64');
  assert.equal((await k.rita.aufruf('pdfMailen', 'a.pdf', pdf)).status, 403);
  assert.match((await k.kasse.aufruf('pdfMailen', '../a.pdf', pdf)).fehler, /Dateiname/);
  assert.match((await k.kasse.aufruf('pdfMailen', 'a.pdf', Buffer.from('<html>').toString('base64'))).fehler, /kein PDF/);
  assert.deepEqual(await k.kasse.ok('pdfMailen', 'Praemienabrechnungen_2026_KW43.pdf', pdf, 'Prämienabrechnungen KW 43'), { an: 'kasse@example.org' });
  const m = await mailAbwarten(php.smtp, (x) => x.an === 'kasse@example.org' && x.betreff === 'Prämienabrechnungen KW 43');
  assert.match(m.roh, /Content-Type: multipart\/mixed/);
  assert.match(m.roh, /Content-Disposition: attachment; filename="Praemienabrechnungen_2026_KW43\.pdf"/);
  assert.ok(m.roh.replace(/\r\n/g, '').includes(pdf), 'PDF unverändert im Anhang');
  assert.match(m.text, /im Anhang/);
});

test('Link in der Zugangs-Mail meldet direkt an (einmal, danach eigenes Passwort)', async () => {
  const z = await k.admin.ok('nutzerAnlegen', { vorname: 'Lina', nachname: 'Link', email: 'lina@example.org', rollen: ['autor'] });
  assert.match(z.link, /#\/link\/[\w-]{20,}$/);
  const mail = await mailAbwarten(php.smtp, (m) => m.an === 'lina@example.org' && m.betreff.startsWith('Dein Zugang'));
  assert.ok(mail.html.includes(z.link.replace(/&/g, '&amp;')), 'der Knopf führt zum Anmeldelink');
  const token = z.link.split('#/link/')[1];
  const lina = client();
  const n = await lina.ok('linkAnmelden', token);
  assert.equal(n.email, 'lina@example.org');
  assert.equal(n.muss_passwort_aendern, true, 'danach eigenes Passwort festlegen');
  assert.equal((await lina.ok('aktuellerNutzer')).email, 'lina@example.org');
  assert.match((await client().aufruf('linkAnmelden', token)).fehler, /schon verwendet/);
  assert.equal((await client().aufruf('linkAnmelden', 'falsch')).status, 404);
  // neues Startpasswort: neuer Link, der alte gilt nicht mehr
  const z2 = await k.admin.ok('passwortZuruecksetzen', n.id);
  const z3 = await k.admin.ok('passwortZuruecksetzen', n.id);
  assert.equal((await client().aufruf('linkAnmelden', z2.link.split('#/link/')[1])).status, 410);
  // abgelaufen
  php.sql("update links set gueltig_bis = '2020-01-01T00:00:00.000Z' where nutzer_id = ?", [n.id]);
  assert.match((await client().aufruf('linkAnmelden', z3.link.split('#/link/')[1])).fehler, /abgelaufen/);
  await k.admin.ok('nutzerLoeschen', n.id);
});

test('Registrierungslink: Konto selbst anlegen, begrenzt in Zeit und Anzahl', async () => {
  assert.equal((await k.rita.aufruf('registrierungslinkErstellen', { tage: 7 })).status, 403);
  assert.match((await k.admin.aufruf('registrierungslinkErstellen', { tage: 5 })).fehler, /Gültigkeit/);
  const r = await k.admin.ok('registrierungslinkErstellen', { tage: 7, max: 1, rollen: ['autor', 'admin'], email: 'neu@example.org', notiz: 'Klasse 7B' });
  assert.equal(r.mail, true);
  assert.ok(await mailAbwarten(php.smtp, (m) => m.an === 'neu@example.org' && m.betreff === 'Einladung zu den Anerkennungsprämien'));
  const token = r.link.split('#/registrieren/')[1];
  const gast = client();
  assert.deepEqual((await gast.ok('einladungPruefen', token)).rollen, ['autor'], 'nie Admin über einen Link');
  const daten = { vorname: 'Nina', nachname: 'Neu', email: 'neu@example.org', passwort: 'geheim12345' };
  assert.match((await gast.aufruf('mitLinkRegistrieren', token, daten)).fehler, /Datenschutzerklärung/);
  assert.match((await gast.aufruf('mitLinkRegistrieren', token, { ...daten, zustimmung: true, passwort: 'kurz' })).fehler, /8 Zeichen/);
  assert.match((await gast.aufruf('mitLinkRegistrieren', token, { ...daten, zustimmung: true, email: 'anna@example.org' })).fehler, /schon ein Konto/);
  const nina = await gast.ok('mitLinkRegistrieren', token, { ...daten, zustimmung: true });
  assert.deepEqual([nina.rollen, nina.muss_passwort_aendern, Boolean(nina.hinweis_bestaetigt_am)], [['autor'], false, true]);
  assert.equal((await gast.ok('aktuellerNutzer')).email, 'neu@example.org', 'gleich angemeldet');
  assert.ok(await mailAbwarten(php.smtp, (m) => m.an === 'admin@example.org' && m.betreff === 'Neu registriert: Nina Neu'));
  // nur einmal
  assert.match((await client().aufruf('mitLinkRegistrieren', token, { ...daten, email: 'x@example.org', zustimmung: true })).fehler, /so oft/);
  // zurückziehen
  const r2 = await k.admin.ok('registrierungslinkErstellen', { tage: 1, max: null });
  const liste = await k.admin.ok('registrierungslinks');
  assert.deepEqual(liste.slice(0, 2).map((l) => [l.max, l.nutzungen, l.aktiv]), [[null, 0, true], [1, 1, false]]);
  assert.equal(liste[1].notiz, 'Klasse 7B');
  await k.admin.ok('registrierungslinkWiderrufen', liste[0].id);
  assert.match((await client().aufruf('einladungPruefen', r2.link.split('#/registrieren/')[1])).fehler, /zurückgezogen/);
  await k.admin.ok('nutzerLoeschen', nina.id);
});

test('Admin: Protokoll schreibt im Hintergrund mit (Info, Warnung, Fehler), mit Filtern', async () => {
  await client().aufruf('anmelden', 'anna@example.org', 'falsches-passwort');
  assert.equal((await k.rita.aufruf('protokoll')).status, 403);
  const alle = await k.admin.ok('protokoll');
  assert.ok(alle.eintraege.length > 5);
  assert.ok(alle.zaehler.alle >= alle.zaehler.info + alle.zaehler.warnung);
  const fehl = await k.admin.ok('protokoll', { stufe: 'warnung', suche: 'anna@example' });
  assert.match(fehl.eintraege[0].text, /Anmeldung fehlgeschlagen für anna@example\.org/);
  assert.equal(fehl.eintraege[0].wer, 'Anna Müller');
  assert.match(fehl.eintraege[0].ip, /^(127\.0\.0\.0|::1?|.*::)$|^$/, 'IP nur gekürzt');
  const konten = await k.admin.ok('protokoll', { bereich: 'konten' });
  assert.ok(konten.eintraege.every((e) => e.bereich === 'konten'));
  assert.ok(konten.eintraege.some((e) => /Konto angelegt: Lina Link/.test(e.text)));
  assert.ok((await k.admin.ok('protokoll', { bereich: 'abrechnungen' })).eintraege.some((e) => /^Angenommen: /.test(e.text)));
  // weiterblättern
  const seite2 = await k.admin.ok('protokoll', { vor: alle.eintraege.at(-1).zeit });
  assert.ok(seite2.eintraege.every((e) => e.zeit < alle.eintraege.at(-1).zeit));
});

test('Admin: Übersicht und Sicherungen (jetzt sichern, herunterladen)', async () => {
  const d = await k.admin.ok('dashboard');
  assert.equal(typeof d.zahlen.zu_pruefen, 'number');
  assert.match(d.system.php, /^8\./);
  assert.ok(d.aktivitaet.length > 0);
  assert.equal((await k.kasse.aufruf('dashboard')).status, 403);
  const b = await k.admin.ok('jetztSichern');
  assert.match(b.name, /^honorarnoten-\d{4}-\d{2}-\d{2}-\d{6}\.(sqlite|sql)$/);
  assert.ok((await k.admin.ok('sicherungen')).liste.some((x) => x.name === b.name));
  const r = await k.admin.ok('sicherungHerunterladen', b.name);
  const inhalt = Buffer.from(r.inhalt, 'base64');
  assert.ok(inhalt.length === b.groesse && inhalt.length > 1000);
  assert.equal((await k.admin.aufruf('sicherungHerunterladen', '../konfig.php')).status, 404);
  assert.ok((await k.admin.ok('protokoll', { bereich: 'sicherung' })).eintraege.some((e) => e.stufe === 'warnung' && /heruntergeladen/.test(e.text)));
});

test('Redaktion: Liste am Server gefiltert und seitenweise, Prüf-Infos, Jahressumme der Buchhaltung', async () => {
  assert.equal((await k.anna.aufruf('redaktionListe')).status, 403);
  const alle = await k.rita.ok('alleNoten');
  const r = await k.rita.ok('redaktionListe', { status: '', limit: 2 });
  assert.equal(r.anzahl, alle.length);
  assert.equal(r.noten.length, 2);
  assert.deepEqual(Object.keys(r.zaehler).sort(), ['abgelehnt', 'angenommen', 'bezahlt', 'eingereicht']);
  assert.equal(Object.values(r.zaehler).reduce((a, b) => a + b, 0), alle.length);
  const seite2 = await k.rita.ok('redaktionListe', { status: '', limit: 2, offset: 2 });
  assert.ok(!seite2.noten.some((n) => r.noten.some((m) => m.id === n.id)), 'keine Doppelten zwischen den Seiten');
  const bezahlt = await k.rita.ok('redaktionListe', { status: 'bezahlt' });
  assert.ok(bezahlt.noten.every((n) => n.status === 'bezahlt'));
  assert.equal(bezahlt.summe, Math.round(bezahlt.noten.reduce((s, n) => s + n.betrag * 100, 0)) / 100);
  const anna = await k.rita.ok('redaktionListe', { suche: 'müller' });
  assert.ok(anna.noten.length && anna.noten.every((n) => /Müller/.test(n.autor.nachname)));
  const sortiert = await k.rita.ok('redaktionListe', { sortierung: 'betrag_desc' });
  assert.ok(sortiert.noten.every((n, i, l) => i === 0 || l[i - 1].betrag >= n.betrag));
  assert.ok(r.noten[0].positionen.length > 0, 'Leistungen sind dabei');
  const info = await k.rita.ok('pruefInfo', alle[0].id);
  assert.match(info.jahr, /^\d{4}$/);
  assert.equal(typeof info.jahr_summe, 'number');
  assert.equal(typeof info.doppelt, 'object');
  const jahr = await k.kasse.ok('ausgezahltImJahr');
  assert.equal(typeof jahr.anzahl, 'number');
  assert.equal((await k.rita.aufruf('ausgezahltImJahr')).status, 403);
});

test('Admin: E-Mail-Adresse ändern, alte und neue Adresse bekommen eine Info', async () => {
  const bert = (await k.admin.ok('nutzerListe')).find((n) => n.email === 'bert@example.org');
  assert.equal((await k.rita.aufruf('emailAendern', bert.id, 'b@example.org')).status, 403);
  assert.match((await k.admin.aufruf('emailAendern', bert.id, 'kein-mail')).fehler, /gültige/);
  assert.match((await k.admin.aufruf('emailAendern', bert.id, 'ANNA@example.org')).fehler, /schon verwendet/);
  assert.match((await k.admin.aufruf('emailAendern', bert.id, 'bert@example.org')).fehler, /schon die E-Mail/);
  const r = await k.admin.ok('emailAendern', bert.id, ' Bert.Neu@Example.org ');
  assert.deepEqual(r, { email: 'bert.neu@example.org', mail: true });
  assert.ok(await mailAbwarten(php.smtp, (m) => m.an === 'bert@example.org' && m.betreff === 'Deine E-Mail-Adresse wurde geändert'));
  assert.ok(await mailAbwarten(php.smtp, (m) => m.an === 'bert.neu@example.org' && m.betreff === 'Deine E-Mail-Adresse wurde geändert'));
  // angemeldet wird ab jetzt mit der neuen Adresse, das Passwort bleibt
  assert.equal((await client().aufruf('anmelden', 'bert@example.org', 'geheim12345')).status, 401);
  const neu = client();
  await neu.ok('anmelden', 'bert.neu@example.org', 'geheim12345');
  assert.equal((await neu.ok('aktuellerNutzer')).email, 'bert.neu@example.org');
  await k.admin.ok('emailAendern', bert.id, 'bert@example.org');
});

test('Prämiensätze: Admin legt fest, alle sehen sie, ungültige Werte abgelehnt', async () => {
  const basisDaten = { empfaenger: { name: 'campus a Medien GmbH' }, datenschutzKontakt: '' };
  assert.deepEqual((await k.anna.ok('einstellungen')).honorarsaetze, {
    college: { kolumne: 15, ausserordentlich: null, redigieren: 2 }, 'campus-a': { kolumne: 15, ausserordentlich: null },
  }, 'Standardsätze ab Werk, für beide Medien (Redigieren nur campus a college)');
  assert.equal((await k.rita.aufruf('einstellungenSpeichern', { ...basisDaten, honorarsaetze: { college: { kolumne: 20 } } })).status, 403);
  assert.match((await k.admin.aufruf('einstellungenSpeichern', { ...basisDaten, honorarsaetze: { 'campus-a': { kolumne: -5 } } })).fehler, /Prämiensätze/);
  await k.admin.ok('einstellungenSpeichern', {
    ...basisDaten, honorarsaetze: { college: { kolumne: 17.5, ausserordentlich: '' }, 'campus-a': { kolumne: 25, ausserordentlich: 80 } },
  });
  assert.deepEqual((await k.anna.ok('einstellungen')).honorarsaetze, {
    college: { kolumne: 17.5, ausserordentlich: null, redigieren: 2 }, 'campus-a': { kolumne: 25, ausserordentlich: 80 },
  });
  // ältere Einstellungen ohne Medium gelten für beide
  php.sql("update einstellungen set wert = ? where schluessel = 'honorarsaetze'", [JSON.stringify({ kolumne: 16, ausserordentlich: null })]);
  assert.equal((await k.anna.ok('einstellungen')).honorarsaetze['campus-a'].kolumne, 16);
});

test('Art der Kolumne (freier Text): Speichern, bleibt beim Abschicken erhalten', async () => {
  await k.anna.ok('leistungSpeichern', { kategorie: 'kolumne', art: 'foto', kolumnenart: '  Kultur  ', titel: 'Theaterkritik', veroeffentlichung: '2026-09-10', betrag: 15 });
  await k.anna.ok('leistungSpeichern', { kategorie: 'ausserordentlich', art: '  Foto   und Text ', kolumnenart: 'Kultur', titel: 'Fotostrecke', veroeffentlichung: '2026-09-11', betrag: 40, vereinbart_mit: 'Rita' });
  const [kolumne, extra] = await k.anna.ok('meineLeistungen');
  assert.equal(kolumne.kolumnenart, 'Kultur');
  assert.equal(kolumne.art, '', 'Kolumnen haben keine Art der Anerkennungsprämie');
  assert.equal(extra.kolumnenart, '', 'nur Kolumnen haben eine Kolumnenart');
  assert.equal(extra.art, 'Foto und Text', 'Art der Anerkennungsprämie ist freier Text');
  const note = await k.anna.ok('abrechnungAbschicken', [kolumne.id, extra.id]);
  assert.equal(note.positionen.find((p) => p.kategorie === 'kolumne').kolumnenart, 'Kultur');
  assert.equal((await k.rita.ok('note', note.id)).positionen[0].kolumnenart, 'Kultur');
});

test('Art der Kolumne ist optional', async () => {
  await k.anna.ok('leistungSpeichern', { kategorie: 'kolumne', kolumnenart: '   ', titel: 'Ohne Art', veroeffentlichung: '2026-09-12', betrag: 15 });
  const p = (await k.anna.ok('meineLeistungen')).find((x) => x.titel === 'Ohne Art');
  assert.equal(p.kolumnenart, '');
  await k.anna.ok('leistungLoeschen', p.id);
});

test('Artikel von campus-a-college.at: Profil verknüpfen, alle Artikel sehen, übernehmen', async () => {
  const a = k.anna;
  const profil = { vorname: 'Anna', nachname: 'Müller', email: 'anna@example.org', strasse: 'Hauptstraße 1', plz_ort: '1010 Wien',
    kontoinhaber: 'Anna Müller', iban: AT_IBAN, bic: '' };
  assert.match((await a.aufruf('profilSpeichern', { ...profil, campus_profil: 'https://example.org/profil/abc' })).fehler, /Profil auf campus-a-college/);
  await a.ok('profilSpeichern', { ...profil, campus_profil: 'https://www.campus-a-college.at/profil/ae1054937a1ae033e117' });
  assert.equal((await a.ok('aktuellerNutzer')).profil.campus_profil, 'ae1054937a1ae033e117');
  await a.ok('profilSpeichern', profil);
  assert.equal((await a.ok('aktuellerNutzer')).profil.campus_profil, 'ae1054937a1ae033e117', 'ohne Angabe bleibt die Verknüpfung');

  // alle Artikel über beide Seiten der Liste, neueste zuerst, mit Datum und Kategorie von der Artikelseite
  const { verknuepft, artikel } = await a.ok('meineArtikel');
  assert.ok(verknuepft);
  assert.deepEqual(artikel.map((x) => x.titel), ['Das Packerl wird teurer', 'Alter bestätigen, bitte', 'Der freie Platz']);
  assert.deepEqual(artikel[0], {
    url: 'https://www.campus-a-college.at/news/detail/das-packerl-wird-teurer', medium: 'college', titel: 'Das Packerl wird teurer',
    datum: '2026-09-28', ressort: 'Wirtschaft', region: 'International', kategorie: 'Meinung', erfasst: false,
  });

  // übernehmen: ein Artikel lässt sich nur einmal erfassen
  const url = artikel[0].url;
  const leistung = { kategorie: 'kolumne', titel: artikel[0].titel, veroeffentlichung: artikel[0].datum, betrag: 15, artikel_url: url };
  assert.match((await a.aufruf('leistungSpeichern', { ...leistung, artikel_url: 'https://boese.example/news/detail/x' })).fehler, /Link zum Artikel/);
  await a.ok('leistungSpeichern', leistung);
  assert.match((await a.aufruf('leistungSpeichern', leistung)).fehler, /schon als Leistung/);
  const gespeichert = (await a.ok('meineLeistungen')).find((p) => p.artikel_url === url);
  await a.ok('leistungSpeichern', { ...leistung, id: gespeichert.id, betrag: 16 }); // eigene Leistung bearbeiten geht
  assert.deepEqual((await a.ok('meineArtikel')).artikel.map((x) => x.erfasst), [true, false, false]);

  // bleibt nach dem Abschicken verknüpft und erfasst; die Redaktion sieht den Link
  const note = await a.ok('abrechnungAbschicken', [gespeichert.id]);
  assert.equal((await k.rita.ok('note', note.id)).positionen[0].artikel_url, url);
  assert.equal((await a.ok('meineArtikel')).artikel[0].erfasst, true);
  assert.match((await a.aufruf('leistungSpeichern', leistung)).fehler, /schon als Leistung/);

  // abgelehnt und zurückgeholt: Verknüpfung wandert zurück in die Leistungen
  await k.rita.ok('ablehnen', note.id, 'Bitte Betrag prüfen');
  assert.equal((await a.ok('meineLeistungen')).filter((p) => p.artikel_url === url).length, 1);
  assert.equal((await a.ok('meineArtikel')).artikel[0].erfasst, true);

  // Artikeldaten liegen in der Datenbank; die Artikelseiten werden nicht erneut geholt
  const vorher = campusSeiten.abrufe;
  await a.ok('meineArtikel', { neu: true });
  assert.equal(campusSeiten.abrufe - vorher, 1, 'nur die erste Listenseite (keine neuen Artikel)');
});

test('campus a und campus a college: Artikel beider Seiten, getrennte Prämienabrechnungen', async () => {
  const b = k.bert;
  await b.ok('anmelden', 'bert@example.org', 'geheim12345'); // Sitzung wurde beim Deaktivieren beendet
  // Bert hat nur ein Profil auf campus-a.at
  const { medien, artikel } = await b.ok('meineArtikel');
  assert.deepEqual(medien, ['campus-a']);
  assert.deepEqual(artikel.map((a) => [a.medium, a.titel, a.datum]), [['campus-a', 'Das Geschäft mit Universitäts-Rankings', '2026-09-11']]);
  const url = artikel[0].url;
  assert.equal(url, 'https://campus-a.at/news/news-detail/das-geschaeft-mit-universitaets-rankings');

  const basis = { kategorie: 'kolumne', titel: 'Rankings', veroeffentlichung: '2026-09-11', betrag: 15 };
  assert.match((await b.aufruf('leistungSpeichern', { ...basis, medium: 'college', artikel_url: url })).fehler, /campus-a-college\.at/, 'Artikel passt nicht zum Medium');
  assert.match((await b.aufruf('leistungSpeichern', { ...basis, medium: 'zeitung' })).fehler, /campus a college oder campus a/);
  await b.ok('leistungSpeichern', { ...basis, medium: 'campus-a', artikel_url: url });
  // nur Medien mit Profil-Link: ohne Link zu campus-a-college.at keine Leistung dafür
  assert.match((await b.aufruf('leistungSpeichern', { ...basis, titel: 'Schulbeitrag', medium: 'college' })).fehler, /kein Profil-Link/);
  await b.ok('leistungSpeichern', { ...basis, titel: 'Ohne Medium' });
  const ohne = (await b.ok('meineLeistungen')).find((p) => p.titel === 'Ohne Medium');
  assert.equal(ohne.medium, 'campus-a', 'ohne Angabe: das verbundene Medium');
  await b.ok('leistungLoeschen', ohne.id);
  await b.ok('profilSpeichern', {
    vorname: 'Bert', nachname: 'Beispiel', email: 'bert@example.org', strasse: 'Weg 2', plz_ort: '8010 Graz',
    kontoinhaber: 'Bert Beispiel', iban: 'DE89370400440532013000', campus_profil: 'https://www.campus-a-college.at/profil/0123456789ab',
  });
  await b.ok('leistungSpeichern', { ...basis, titel: 'Schulbeitrag' }); // mit beiden Links ohne Angabe: campus a college
  const liste = (await b.ok('meineLeistungen')).filter((p) => ['Rankings', 'Schulbeitrag'].includes(p.titel));
  assert.deepEqual(liste.map((p) => p.medium).sort(), ['campus-a', 'college']);
  assert.equal((await b.ok('meineArtikel')).artikel[0].erfasst, true);

  // gemischt abschicken geht nicht, getrennt schon – jede Note hat ihr Medium
  assert.match((await b.aufruf('abrechnungAbschicken', liste.map((p) => p.id))).fehler, /getrennt/);
  const noteA = await b.ok('abrechnungAbschicken', [liste.find((p) => p.medium === 'campus-a').id]);
  const noteC = await b.ok('abrechnungAbschicken', [liste.find((p) => p.medium === 'college').id]);
  assert.deepEqual([noteA.medium, noteC.medium], ['campus-a', 'college']);
  assert.equal(noteA.positionen[0].medium, 'campus-a');
  assert.notEqual(noteA.nummer, noteC.nummer);
  const redaktion = await k.rita.ok('alleNoten');
  assert.equal(redaktion.find((n) => n.id === noteA.id).medium, 'campus-a', 'Redaktion sieht das Medium');

  // abgelehnt und zurückgeholt: Medium bleibt erhalten
  await k.rita.ok('ablehnen', noteA.id, 'Test');
  assert.equal((await b.ok('meineLeistungen')).find((p) => p.titel === 'Rankings').medium, 'campus-a');
  await k.rita.ok('ablehnen', noteC.id, 'Test');
});

test('Artikel: campus-a-college.at nicht erreichbar', async () => {
  campusSeiten.kaputt = true;
  try {
    const r = await k.anna.aufruf('meineArtikel', { neu: true });
    assert.equal(r.status, 502);
    assert.match(r.fehler, /nicht erreichbar/);
  } finally {
    campusSeiten.kaputt = false;
  }
});

test('Buchhaltung: ganze Woche als bezahlt markieren (alle oder keine)', async () => {
  const heute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date());
  const note = async (titel) => {
    await k.anna.ok('leistungSpeichern', { kategorie: 'kolumne', titel, veroeffentlichung: '2026-09-20', betrag: 15 });
    const p = (await k.anna.ok('meineLeistungen')).find((x) => x.titel === titel);
    return k.anna.ok('abrechnungAbschicken', [p.id]);
  };
  const [a, b, c] = [await note('Woche A'), await note('Woche B'), await note('Woche C')];
  await k.rita.ok('annehmen', a.id);
  await k.rita.ok('annehmen', b.id); // c bleibt eingereicht

  assert.equal((await k.rita.aufruf('alleAlsBezahltMarkieren', [a.id], heute)).status, 403);
  assert.match((await k.kasse.aufruf('alleAlsBezahltMarkieren', [a.id, c.id], heute)).fehler, /Nur angenommene/);
  assert.equal((await k.kasse.ok('offeneZahlungen')).filter((n) => [a.id, b.id].includes(n.id)).length, 2, 'nichts geändert');
  assert.match((await k.kasse.aufruf('alleAlsBezahltMarkieren', [], heute)).fehler, /mindestens eine/);

  const bezahlt = await k.kasse.ok('alleAlsBezahltMarkieren', [a.id, b.id], heute);
  assert.deepEqual(bezahlt.map((n) => [n.nummer, n.status, n.bezahlt_am]), [[a.nummer, 'bezahlt', heute], [b.nummer, 'bezahlt', heute]]);
  assert.equal(bezahlt[0].zahlung.iban, AT_IBAN, 'für das PDF: IBAN und Adresse dabei');
  const seit = await k.kasse.ok('bezahlteNotenSeit', heute);
  assert.ok([a.id, b.id].every((id) => seit.some((n) => n.id === id)));
  assert.match((await k.kasse.aufruf('bezahlteNotenSeit', 'gestern')).fehler, /Datum/);
  await k.rita.ok('ablehnen', c.id, 'Test');
});

test('Redigieren (campus a college): Kategorie wie Kolumne, Anzahl Texte × Satz', async () => {
  // Redigieren nur mit Rolle vom Admin (bringt die Rolle Autor:in automatisch mit)
  const z = await k.admin.ok('nutzerAnlegen', { vorname: 'Ida', nachname: 'Lektor', email: 'ida@example.org', rollen: ['redigieren'] });
  assert.deepEqual(z.nutzer?.rollen ?? (await k.admin.ok('nutzerListe')).find((n) => n.email === 'ida@example.org').rollen, ['autor', 'redigieren']);
  const ida = client();
  await anmeldenMitNeuemPasswort(ida, 'ida@example.org', z.passwort);
  const profil = {
    vorname: 'Ida', nachname: 'Lektor', email: 'ida@example.org', strasse: 'Weg 3', plz_ort: '1010 Wien',
    kontoinhaber: 'Ida Lektor', iban: AT_IBAN, campus_a_profil: `https://campus-a.at/profil/${CAMPUS_A_PROFIL}`,
  };
  await ida.ok('profilSpeichern', profil);
  const red = { kategorie: 'redigieren', veroeffentlichung: '2026-09-30' };
  assert.match((await ida.aufruf('leistungSpeichern', { ...red, anzahl: 0 })).fehler, /Anzahl/);
  assert.match((await ida.aufruf('leistungSpeichern', { ...red, anzahl: 2.5 })).fehler, /Anzahl/);
  // Betrag rechnet der Server (5 × 2 €), immer campus a college – auch ohne Profil-Link dort
  await ida.ok('leistungSpeichern', { ...red, anzahl: 5, betrag: 999, medium: 'campus-a' });
  const [p] = await ida.ok('meineLeistungen');
  assert.deepEqual([p.kategorie, p.medium, p.anzahl, p.betrag, p.titel], ['redigieren', 'college', 5, 10, 'Redigieren (5 Texte)']);
  // ohne Rolle „Redigieren“ geht es nicht
  const ohne = await k.anna.aufruf('leistungSpeichern', { ...red, anzahl: 3 });
  assert.equal(ohne.status, 403);
  assert.match(ohne.fehler, /nicht freigeschaltet/);

  // Satz einstellbar; bearbeiten rechnet neu
  await k.admin.ok('einstellungenSpeichern', {
    empfaenger: { name: 'campus a Medien GmbH' }, honorarsaetze: { college: { kolumne: 15, redigieren: 2.5 }, 'campus-a': { kolumne: 15 } },
  });
  await ida.ok('leistungSpeichern', { ...red, id: p.id, anzahl: 4, titel: 'Redigieren September' });
  const [p2] = await ida.ok('meineLeistungen');
  assert.deepEqual([p2.anzahl, p2.betrag, p2.titel], [4, 10, 'Redigieren September']);

  const note = await ida.ok('abrechnungAbschicken', [p2.id]);
  assert.equal(note.medium, 'college');
  assert.deepEqual([note.positionen[0].kategorie, note.positionen[0].anzahl, note.betrag], ['redigieren', 4, 10]);
  // abgelehnt: kommt mit Anzahl zurück
  await k.rita.ok('ablehnen', note.id, 'Bitte Zeitraum angeben');
  const [zurueck] = await ida.ok('meineLeistungen');
  assert.deepEqual([zurueck.kategorie, zurueck.anzahl, zurueck.betrag, zurueck.zurueck_grund], ['redigieren', 4, 10, 'Bitte Zeitraum angeben']);
});

test('E-Mails: Anfrage, Zugang, Einreichen, Annehmen, Ablehnen, Bezahlen', async () => {
  const mail = (an, betreff) => mailAbwarten(php.smtp, (m) => m.an === an && betreff.test(m.betreff));
  const anfrage = await mail('admin@example.org', /^Neue Zugangsanfrage: Anna Autorin$/);
  assert.ok(anfrage, 'Zugangsanfrage an das Admin-Konto');
  assert.match(anfrage.text, /Nachricht: „Hallo“/);
  assert.match(anfrage.html, /href="https:\/\/honorare\.example\.org\/#\/admin\/anfragen"/);

  const zugang = await mail('anna@example.org', /^Dein Zugang zu den Anerkennungsprämien$/);
  assert.ok(zugang?.text.includes(k.zugang['anna@example.org'].passwort), 'Startpasswort in der Willkommens-Mail');

  const nummer = k.note.nummer;
  const redaktion = await mail('rita@example.org', new RegExp(`^Neue Prämienabrechnung von Anna Müller \\(${nummer}\\)$`));
  assert.ok(redaktion, 'neue Prämienabrechnung an das Konto der Redaktion');
  assert.ok(!php.smtp.mails.some((m) => m.an === 'admin@example.org' && m.betreff.startsWith('Neue Prämienabrechnung')), 'reine Admins: aus, solange nicht eingeschaltet');
  assert.match(redaktion.html, new RegExp(`#/redaktion/${k.note.id}`));
  assert.match(redaktion.text, /Kolumne 1 \(01\.09\.2026\): € 15,00/);
  assert.match(redaktion.text, /Gesamt: € 75,50/);
  assert.ok(!redaktion.text.includes('AT61'), 'keine IBAN in der Mail an die Redaktion');
  assert.ok(await mail('anna@example.org', new RegExp(`^Deine Prämienabrechnung ${nummer} ist eingegangen$`)), 'Eingangsbestätigung');

  const angenommen = await mail('anna@example.org', new RegExp(`^Prämienabrechnung ${nummer} angenommen$`));
  assert.match(angenommen.text, /Betrag geändert bei „Interview“: € 60,50 → € 50,00 \(Laut Vereinbarung\)/);
  assert.ok(await mail('kasse@example.org', new RegExp(`^Zur Zahlung: ${nummer} \\(€ 65,00\\)$`)), 'an die Buchhaltung');
  assert.ok(await mail('anna@example.org', new RegExp(`^Prämienabrechnung ${nummer} bezahlt$`)), 'bezahlt');

  const abgelehnt = await mail('bert@example.org', /bitte überarbeiten$/);
  assert.match(abgelehnt.text, /Begründung der Redaktion:\nNicht erschienen/);
  assert.match(abgelehnt.html, /#\/leistungen/);
  // Gestaltung: Kopf in Markenfarbe, Knopf, Textfassung
  assert.match(redaktion.html, /background:#0f6b66/);
  assert.match(redaktion.html, /Prämienabrechnung prüfen/);
  assert.ok(php.smtp.mails.every((m) => m.text && m.html), 'jede Mail mit Text- und HTML-Fassung');
});

test('Benachrichtigungen: jedes Konto wählt selbst', async () => {
  const rita = await k.rita.ok('aktuellerNutzer');
  assert.deepEqual(rita.benachrichtigungen, {}, 'ohne eigene Wahl: Standard');
  // nur Arten der eigenen Rollen werden gespeichert
  const neu = await k.rita.ok('benachrichtigungenSpeichern', { neue_note: false, bezahlt: false, quatsch: true });
  assert.deepEqual(neu.benachrichtigungen, { neue_note: false });
  const anna = await k.anna.ok('benachrichtigungenSpeichern', { eingang: false });
  assert.deepEqual(anna.benachrichtigungen, { eingang: false });
  // Admin schaltet die Redaktions-Mails für sich ein
  await k.admin.ok('benachrichtigungenSpeichern', { neue_note: true });

  const vorher = php.smtp.mails.length;
  await k.anna.ok('leistungSpeichern', { kategorie: 'kolumne', titel: 'Wahl-Test', veroeffentlichung: '2026-09-21', betrag: 15 });
  const p = (await k.anna.ok('meineLeistungen')).find((x) => x.titel === 'Wahl-Test');
  const note = await k.anna.ok('abrechnungAbschicken', [p.id]);
  const admin = await mailAbwarten(php.smtp, (m) => m.an === 'admin@example.org' && m.betreff.includes(note.nummer));
  assert.ok(admin, 'Admin hat es eingeschaltet');
  await k.anna.ok('aktuellerNutzer'); // nächste Anfrage: die Mails der vorigen sind sicher verschickt
  const neueMails = php.smtp.mails.slice(vorher).filter((m) => m.betreff.includes(note.nummer));
  assert.ok(!neueMails.some((m) => m.an === 'rita@example.org'), 'Rita hat neue Prämienabrechnungen ausgeschaltet');
  assert.ok(!neueMails.some((m) => m.an === 'anna@example.org'), 'Anna will keine Eingangsbestätigung');
  await k.rita.ok('ablehnen', note.id, 'Test');
  await k.rita.ok('benachrichtigungenSpeichern', { neue_note: true });
  await k.anna.ok('benachrichtigungenSpeichern', { eingang: true });
});

test('Admin: Note löschen mit Protokoll, Export ohne Passwörter', async () => {
  assert.equal((await k.rita.aufruf('noteLoeschen', k.note.id)).status, 403);
  await k.admin.ok('noteLoeschen', k.note.id);
  assert.equal((await k.admin.ok('loeschprotokoll'))[0].nummer, k.note.nummer);
  const exp = await k.admin.ok('exportieren');
  assert.ok(!exp.includes('$2y$') && !exp.includes('scrypt$'), 'keine Passwort-Hashes');
  assert.ok(!exp.includes('smtp-geheim'), 'kein Passwort des Mail-Postfachs');
});

test('Impressum und Datenschutz: Betreiber, öffentlich lesbar, Hinweis bestätigen', async () => {
  const gast = client();
  const leer = await gast.ok('rechtliches');
  assert.equal(leer.betreiber.name, '', 'ohne Anmeldung lesbar, Standard ohne Betreiber');
  assert.match(leer.betreiber.hoster, /World4You/);
  const basisDaten = { empfaenger: { name: 'campus a Medien GmbH' }, datenschutzKontakt: 'datenschutz@example.org' };
  const betreiber = { name: 'Max Muster', anschrift: 'Weg 1\n1010 Wien', email: 'max@example.org', extern: true };
  assert.match((await k.admin.aufruf('einstellungenSpeichern', { ...basisDaten, betreiber: { ...betreiber, email: 'x' } })).fehler, /Betreibers/);
  assert.equal((await k.rita.aufruf('einstellungenSpeichern', { ...basisDaten, betreiber })).status, 403);
  await k.admin.ok('einstellungenSpeichern', { ...basisDaten, betreiber });
  const r = await gast.ok('rechtliches');
  assert.equal(r.betreiber.name, 'Max Muster');
  assert.equal(r.betreiber.anschrift, 'Weg 1\n1010 Wien');
  assert.equal(r.datenschutzKontakt, 'datenschutz@example.org');
  assert.ok(r.betreiber.stand, 'Stand gesetzt');
  assert.equal(r.empfaenger.name, 'campus a Medien GmbH');
  assert.equal(r.empfaenger.iban, undefined);

  // Hinweis zur Kenntnis nehmen; nur bei wichtigen Änderungen gilt ein neuer Stand
  assert.equal((await gast.aufruf('hinweisBestaetigen')).status, 401);
  const anna = await k.anna.ok('hinweisBestaetigen');
  assert.ok(anna.hinweis_bestaetigt_am >= r.betreiber.stand);
  await k.admin.ok('einstellungenSpeichern', { ...basisDaten, betreiber: { ...betreiber, telefon: '0660 123' } });
  assert.equal((await gast.ok('rechtliches')).betreiber.stand, r.betreiber.stand, 'Telefon ändert den Stand nicht');
  await new Promise((ok) => setTimeout(ok, 5));
  await k.admin.ok('einstellungenSpeichern', { ...basisDaten, betreiber: { ...betreiber, anschrift: 'Neu 2, 1020 Wien' } });
  assert.ok((await gast.ok('rechtliches')).betreiber.stand > anna.hinweis_bestaetigt_am, 'neue Anschrift: neu bestätigen');
  // auch für Angemeldete über die Einstellungen
  assert.equal((await k.anna.ok('einstellungen')).betreiber.name, 'Max Muster');
});

test('Schutz: CSRF-Header, fremde Origin, unbekannte Funktionen', async () => {
  const ohne = await fetch(`${basis}/api/aktuellerNutzer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(ohne.status, 403);
  const fremd = await fetch(`${basis}/api/aktuellerNutzer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Honorare': '1', Origin: 'https://boese.example' }, body: '{}',
  });
  assert.equal(fremd.status, 403);
  assert.equal((await client().aufruf('constructor')).status, 404);
  assert.equal((await client().aufruf('toString')).status, 404);
});

test('Schutz: zu viele Anmeldeversuche werden gebremst', async () => {
  const c = client();
  let letzte;
  for (let i = 0; i < 11; i++) letzte = await c.aufruf('anmelden', 'rita@example.org', `falsch${i}`);
  assert.equal(letzte.status, 429);
});

test('Statische Dateien: Modus, Pfad-Tricks, Sicherheits-Header', async () => {
  const modus = await fetch(`${basis}/js/modus.js`);
  assert.match(await modus.text(), /'server'/);
  const start = await fetch(`${basis}/`);
  assert.equal(start.status, 200);
  assert.match(start.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${basis}/%2e%2e/server/lib/db.php`)).status, 404);
  assert.equal((await fetch(`${basis}/../server/lib/db.php`)).status, 404);
  assert.equal((await fetch(`${basis}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${basis}/.nojekyll`)).status, 404);
});
