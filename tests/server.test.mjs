// Tests für den Server: Rollen, Rechte und Abläufe über die echte HTTP-API
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serverErstellen } from '../server/server.js';
import { adminAnlegen } from '../server/honorare.js';
import { CAMPUS_A_PROFIL, campusSeiten, campusHolen } from './campus-fixtures.mjs';

let server;
let db;
let basis;

before(async () => {
  ({ server, db } = serverErstellen({
    port: 0, host: '127.0.0.1', datenbank: ':memory:', proxy: false, cookieSecure: false, campusHolen,
  }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  basis = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

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
  const { passwort } = await adminAnlegen(db, { email: 'Admin@Example.org', vorname: 'Alex', nachname: 'Admin' });
  k.admin = client();
  const ich = await k.admin.ok('anmelden', 'admin@example.org', passwort);
  assert.equal(ich.muss_passwort_aendern, true);
  // mit Startpasswort ist nichts anderes erlaubt
  assert.equal((await k.admin.aufruf('nutzerListe')).status, 403);
  assert.match((await k.admin.aufruf('erstesPasswortSetzen', passwort)).fehler, /Startpasswort/);
  await k.admin.ok('erstesPasswortSetzen', 'admin-passwort-1');
  assert.equal((await k.admin.ok('aktuellerNutzer')).muss_passwort_aendern, false);
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
  await gast.ok('zugangAnfragen', { vorname: 'Anna', nachname: 'Autorin', email: 'anna@example.org', nachricht: 'Hallo' });
  await gast.ok('zugangAnfragen', { vorname: 'Bert', nachname: 'Beispiel', email: 'bert@example.org' });
  // existierendes Konto: gleiche Antwort, aber keine Anfrage
  await gast.ok('zugangAnfragen', { vorname: 'X', nachname: 'Y', email: 'admin@example.org' });

  const anfragen = await k.admin.ok('anfragen');
  assert.deepEqual(anfragen.map((a) => a.email).sort(), ['anna@example.org', 'bert@example.org']);
  assert.equal(await k.admin.ok('offeneAnfragenAnzahl'), 2);

  const zugang = {};
  for (const a of anfragen) zugang[a.email] = await k.admin.ok('anfrageFreischalten', a.id, ['autor']);
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
  assert.match((await a.aufruf('leistungSpeichern', { kategorie: 'ausserordentlich', art: ' ', titel: 'X', veroeffentlichung: '2026-09-01', betrag: 10, vereinbart_mit: 'Rita' })).fehler, /Art des Honorars/);
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
  await k.rita.ok('ablehnen', note.id, 'Nicht erschienen');
  assert.equal((await k.bert.ok('meineNoten'))[0].ablehnungsgrund, 'Nicht erschienen');
  await k.bert.ok('leistungenZurueckholen', note.id);
  assert.equal((await k.bert.ok('meineLeistungen')).length, 1);
  assert.match((await k.bert.aufruf('leistungenZurueckholen', note.id)).fehler, /bereits/);
  assert.match((await k.rita.aufruf('annehmen', note.id)).fehler, /überarbeitet/);
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

test('Honorarsätze: Admin legt fest, alle sehen sie, ungültige Werte abgelehnt', async () => {
  const basisDaten = { empfaenger: { name: 'campus a Medien GmbH' }, datenschutzKontakt: '' };
  assert.deepEqual((await k.anna.ok('einstellungen')).honorarsaetze, {
    college: { kolumne: 15, ausserordentlich: null }, 'campus-a': { kolumne: 15, ausserordentlich: null },
  }, 'Standardsätze ab Werk, für beide Medien');
  assert.equal((await k.rita.aufruf('einstellungenSpeichern', { ...basisDaten, honorarsaetze: { college: { kolumne: 20 } } })).status, 403);
  assert.match((await k.admin.aufruf('einstellungenSpeichern', { ...basisDaten, honorarsaetze: { 'campus-a': { kolumne: -5 } } })).fehler, /Honorarsätze/);
  await k.admin.ok('einstellungenSpeichern', {
    ...basisDaten, honorarsaetze: { college: { kolumne: 17.5, ausserordentlich: '' }, 'campus-a': { kolumne: 25, ausserordentlich: 80 } },
  });
  assert.deepEqual((await k.anna.ok('einstellungen')).honorarsaetze, {
    college: { kolumne: 17.5, ausserordentlich: null }, 'campus-a': { kolumne: 25, ausserordentlich: 80 },
  });
  // ältere Einstellungen ohne Medium gelten für beide
  db.prepare("update einstellungen set wert = ? where schluessel = 'honorarsaetze'").run(JSON.stringify({ kolumne: 16, ausserordentlich: null }));
  assert.equal((await k.anna.ok('einstellungen')).honorarsaetze['campus-a'].kolumne, 16);
});

test('Art der Kolumne (freier Text): Speichern, bleibt beim Abschicken erhalten', async () => {
  await k.anna.ok('leistungSpeichern', { kategorie: 'kolumne', art: 'foto', kolumnenart: '  Kultur  ', titel: 'Theaterkritik', veroeffentlichung: '2026-09-10', betrag: 15 });
  await k.anna.ok('leistungSpeichern', { kategorie: 'ausserordentlich', art: '  Foto   und Text ', kolumnenart: 'Kultur', titel: 'Fotostrecke', veroeffentlichung: '2026-09-11', betrag: 40, vereinbart_mit: 'Rita' });
  const [kolumne, extra] = await k.anna.ok('meineLeistungen');
  assert.equal(kolumne.kolumnenart, 'Kultur');
  assert.equal(kolumne.art, '', 'Kolumnen haben keine Art des Honorars');
  assert.equal(extra.kolumnenart, '', 'nur Kolumnen haben eine Kolumnenart');
  assert.equal(extra.art, 'Foto und Text', 'Art des Honorars ist freier Text');
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
  await a.ok('leistungenZurueckholen', note.id);
  assert.equal((await a.ok('meineLeistungen')).filter((p) => p.artikel_url === url).length, 1);
  assert.equal((await a.ok('meineArtikel')).artikel[0].erfasst, true);

  // Artikeldaten liegen in der Datenbank; die Artikelseiten werden nicht erneut geholt
  const vorher = campusSeiten.abrufe;
  await a.ok('meineArtikel', { neu: true });
  assert.equal(campusSeiten.abrufe - vorher, 1, 'nur die erste Listenseite (keine neuen Artikel)');
});

test('campus a und campus a college: Artikel beider Seiten, getrennte Honorarnoten', async () => {
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
  await b.ok('leistungenZurueckholen', noteA.id);
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

test('Admin: Note löschen mit Protokoll, Export ohne Passwörter', async () => {
  assert.equal((await k.rita.aufruf('noteLoeschen', k.note.id)).status, 403);
  await k.admin.ok('noteLoeschen', k.note.id);
  assert.equal((await k.admin.ok('loeschprotokoll'))[0].nummer, k.note.nummer);
  const exp = await k.admin.ok('exportieren');
  assert.ok(!exp.includes('scrypt$'));
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
  assert.equal((await fetch(`${basis}/%2e%2e/server/db.js`)).status, 404);
  assert.equal((await fetch(`${basis}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${basis}/.nojekyll`)).status, 404);
});
