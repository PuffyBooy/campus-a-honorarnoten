import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datenschutzHtml, hinweisAktiv, hinweisHtml, hinweisOffen, impressumHtml } from '../public/js/lib/rechtliches.js';

const r = {
  betreiber: { name: 'Max <Muster>', anschrift: 'Weg 1\n1010 Wien', email: 'max@example.org', extern: true, stand: '2026-10-01T00:00:00.000Z' },
  empfaenger: { name: 'campus a Medien GmbH', strasse: 'Stiftgasse 6/1/2', plz_ort: '1070 Wien' },
  datenschutzKontakt: 'datenschutz@example.org',
};

test('Hinweis: nicht bei campus a angestellt', () => {
  assert.ok(hinweisAktiv(r.betreiber));
  assert.ok(!hinweisAktiv({ ...r.betreiber, extern: false }), 'angestellt: kein Hinweis');
  assert.ok(!hinweisAktiv({ ...r.betreiber, name: '' }), 'ohne Betreiber: kein Hinweis');
  const h = hinweisHtml(r);
  assert.match(h, /nicht bei der campus a Medien GmbH angestellt/);
  assert.match(h, /Max &lt;Muster&gt;/, 'maskiert');
  assert.match(h, /World4You/);
  assert.ok(hinweisOffen({ hinweis_bestaetigt_am: null }, r.betreiber));
  assert.ok(hinweisOffen({ hinweis_bestaetigt_am: '2026-09-30T00:00:00.000Z' }, r.betreiber), 'vor dem Stand bestätigt');
  assert.ok(!hinweisOffen({ hinweis_bestaetigt_am: '2026-10-02T00:00:00.000Z' }, r.betreiber));
});

test('Impressum und Datenschutzerklärung', () => {
  const i = impressumHtml(r);
  assert.match(i, /Medieninhaber und Betreiber/);
  assert.match(i, /Weg 1<br>1010 Wien/);
  assert.match(i, /§ 25 Mediengesetz/);
  assert.match(i, /nicht bei der campus a Medien GmbH angestellt/);
  assert.match(impressumHtml({ ...r, betreiber: {} }), /\[Name des Betreibers/, 'Platzhalter, solange nichts eingetragen ist');
  const d = datenschutzHtml(r);
  for (const x of [/Art\. 6 Abs\. 1 lit\. b DSGVO/, /§ 132 BAO/, /Datenschutzbehörde/, /hn_sitzung/, /datenschutz@example\.org/, /ohne<\/em> Adresse und Bankverbindung/]) {
    assert.match(d, x);
  }
  assert.ok(!/<script/i.test(datenschutzHtml({ ...r, betreiber: { ...r.betreiber, zusatz_datenschutz: '<script>x</script>' } })), 'Zusatztext maskiert');
  assert.match(datenschutzHtml(r, { istDemo: true }), /Demo-Version/);
});
