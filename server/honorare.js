// Geschäftslogik des Servers: dieselben Regeln wie in der Demo (public/js/store.js),
// aber hier auf dem Server geprüft – im Browser lässt sich nichts umgehen.
import { randomUUID } from 'node:crypto';
import { transaktion } from './db.js';
import {
  passwortHash, passwortPasst, startpasswort, sitzungErstellen, sitzungBeenden, alleSitzungenBeenden,
} from './auth.js';
import { artNormalisieren, heuteIso, textAnzahl } from '../public/js/lib/format.js';
import { ibanFehler, normalizeIban, normalizeBic, bicIstGueltig } from '../public/js/lib/iban.js';
import { honorarnoteNummer } from '../public/js/lib/nummer.js';
import { STANDARD_SAETZE, saetzeNormalisieren } from '../public/js/lib/honorarsaetze.js';
import {
  MEDIEN, MEDIUM_KEYS, PROFIL_FELD, istMedium, mediumName, mediumOder, mediumVonArtikel, nichtVerbunden, profilIdAusLink,
  verbundeneMedien,
} from '../public/js/lib/campus.js';
import { KONTO_FEHLT, darfRedigieren, kontoFertig, rollenNormalisieren } from '../public/js/lib/konto.js';
import { artikelVonProfil } from './campus-artikel.js';

export const STANDARD_EMPFAENGER = {
  name: 'campus a Medien GmbH',
  strasse: 'Stiftgasse 6/1/2',
  plz_ort: '1070 Wien',
  uid: 'ATU81242718',
};

export class Fehler extends Error {
  constructor(meldung, status = 400) {
    super(meldung);
    this.status = status;
  }
}

const pruefe = (bedingung, meldung, status = 400) => { if (!bedingung) throw new Fehler(meldung, status); };
const id = () => randomUUID();
const jetzt = () => new Date().toISOString();
const trim = (s) => String(s ?? '').trim();
const leer = (s) => !trim(s);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const erlaubteRollen = rollenNormalisieren;
const profilLinkFehler = (m) => `Bitte den Link zu deinem Profil auf ${MEDIEN[m].seite} einfügen, z. B. ${MEDIEN[m].basis}/profil/…`;
const anzeigename = (n) => `${n.vorname} ${n.nachname}`.trim() || n.email;

/** Betrag in Euro (Zahl) -> Cent; wirft bei ungültigem Wert */
function cent(betrag) {
  const b = Number(betrag);
  const c = Math.round(b * 100);
  pruefe(Number.isFinite(b) && c > 0 && c <= 10000000 && Math.abs(b * 100 - c) < 1e-6, 'Bitte einen gültigen Betrag angeben.');
  return c;
}
const euro = (c) => c / 100;

// ------------------------------------------------------------------ Nutzer:innen

function nutzerAusZeile(z) {
  if (!z) return null;
  return {
    id: z.id,
    email: z.email,
    vorname: z.vorname,
    nachname: z.nachname,
    rollen: JSON.parse(z.rollen),
    aktiv: Boolean(z.aktiv),
    muss_passwort_aendern: Boolean(z.muss_passwort_aendern),
    profil: {
      strasse: z.strasse, plz_ort: z.plz_ort, kontoinhaber: z.kontoinhaber, iban: z.iban, bic: z.bic,
      campus_profil: z.campus_profil ?? '', campus_a_profil: z.campus_a_profil ?? '',
    },
    erstellt_am: z.erstellt_am,
    letzter_login: z.letzter_login,
  };
}

export function nutzerLaden(db, nutzerId) {
  return nutzerAusZeile(db.prepare('select * from nutzer where id = ?').get(nutzerId));
}

const hat = (n, rolle) => n.rollen.includes(rolle) || (rolle !== 'autor' && n.rollen.includes('admin'));

function ich(ctx) {
  pruefe(ctx.nutzer, 'Bitte melde dich an.', 401);
  // Solange das Startpasswort gilt, ist nur das Festlegen eines eigenen Passworts erlaubt
  pruefe(!ctx.nutzer.muss_passwort_aendern || ctx.erlaubtMitStartpasswort, 'Bitte lege zuerst ein eigenes Passwort fest.', 403);
  return ctx.nutzer;
}

function brauche(ctx, rolle) {
  const n = ich(ctx);
  pruefe(hat(n, rolle), 'Dafür fehlt dir die Berechtigung.', 403);
  // Autor:innen müssen zuerst ihr Konto einrichten (Adresse, Bankverbindung, Profil-Link)
  if (rolle === 'autor') pruefe(kontoFertig(n), KONTO_FEHLT, 403);
  return n;
}

function einstellungenLaden(db) {
  const e = {
    empfaenger: { ...STANDARD_EMPFAENGER },
    datenschutzKontakt: '',
    honorarsaetze: saetzeNormalisieren(STANDARD_SAETZE),
  };
  for (const { schluessel, wert } of db.prepare('select * from einstellungen').all()) {
    if (schluessel !== 'auftraggeber') e[schluessel] = JSON.parse(wert); // früheres SEPA-Konto, nicht mehr verwendet
  }
  e.honorarsaetze = saetzeNormalisieren(e.honorarsaetze); // ältere Sätze ohne Medium gelten für beide
  return e;
}

// ------------------------------------------------------------------ Honorarnoten laden

function positionAusZeile(p) {
  return {
    id: p.id, kategorie: p.kategorie, art: p.art, kolumnenart: p.kolumnenart ?? '', titel: p.titel, veroeffentlichung: p.veroeffentlichung,
    artikel_url: p.artikel_url ?? '', medium: mediumOder(p.medium), anzahl: p.anzahl ?? 0,
    zurueck_nummer: p.zurueck_nummer ?? '', zurueck_grund: p.zurueck_grund ?? '', ausgabe: p.ausgabe, vereinbart_mit: p.vereinbart_mit, notiz: p.notiz,
    betrag: euro(p.betrag_cent), betrag_eingereicht: euro(p.betrag_eingereicht_cent), betrag_vermerk: p.betrag_vermerk,
  };
}

function noteAusZeile(db, z) {
  const positionen = db.prepare('select * from note_positionen where note_id = ? order by reihenfolge').all(z.id).map(positionAusZeile);
  return {
    id: z.id, nummer: z.nummer, jahr: z.jahr, laufende_nummer: z.laufende_nummer, monat: z.monat, medium: mediumOder(z.medium),
    autor_id: z.autor_id, status: z.status, eingereicht_am: z.eingereicht_am, entschieden_am: z.entschieden_am,
    bezahlt_am: z.bezahlt_am, ablehnungsgrund: z.ablehnungsgrund, zurueckgeholt_am: z.zurueckgeholt_am,
    autor: JSON.parse(z.autor_json), zahlung: JSON.parse(z.zahlung_json), empfaenger: JSON.parse(z.empfaenger_json),
    positionen,
  };
}

function noteHolen(db, noteId) {
  const z = db.prepare('select * from noten where id = ?').get(String(noteId));
  pruefe(z, 'Diese Honorarnote gibt es nicht (mehr).', 404);
  return noteAusZeile(db, z);
}

function darfSehen(n, note) {
  if (hat(n, 'redaktion')) return true;
  if (note.autor_id === n.id) return true;
  return hat(n, 'buchhaltung') && ['angenommen', 'bezahlt'].includes(note.status);
}

function darfZahlungsdaten(n, note) {
  return note.autor_id === n.id || n.rollen.includes('admin')
    || (hat(n, 'buchhaltung') && ['angenommen', 'bezahlt'].includes(note.status));
}

/** Sicht auf eine Note: die Redaktion bekommt keine IBAN und keine Adresse */
function sicht(n, note) {
  const k = { ...note, betrag: euro(note.positionen.reduce((s, p) => s + cent(p.betrag), 0)) };
  if (!darfZahlungsdaten(n, note)) {
    delete k.zahlung;
    k.autor = { vorname: note.autor.vorname, nachname: note.autor.nachname, email: note.autor.email };
  }
  return k;
}

function notenListe(db, n, where = '', params = [], order = 'eingereicht_am desc') {
  return db.prepare(`select * from noten ${where} order by ${order}`).all(...params)
    .map((z) => noteAusZeile(db, z)).map((x) => sicht(n, x));
}

function verlaufEintragen(db, noteId, n, aktion, details = {}) {
  db.prepare('insert into verlauf (id, note_id, akteur_id, akteur_name, aktion, details, am) values (?, ?, ?, ?, ?, ?, ?)')
    .run(id(), noteId, n.id, anzeigename(n), aktion, JSON.stringify(details), jetzt());
}

// ================================================================== API-Funktionen
// Jede Funktion bekommt ctx = { db, nutzer, token } und die Argumente aus dem Browser.

export const funktionen = {
  // ---------------------------------------------------------------- Sitzung
  aktuellerNutzer(ctx) {
    return ctx.nutzer;
  },

  async anmelden(ctx, email, passwort) {
    const z = ctx.db.prepare('select * from nutzer where email = ?').get(trim(email).toLowerCase());
    // auch bei unbekannter E-Mail rechnen, damit man Konten nicht an der Antwortzeit erkennt
    const ok = await passwortPasst(z?.passwort ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', String(passwort ?? ''));
    pruefe(z && ok, 'E-Mail oder Passwort ist falsch.', 401);
    pruefe(z.aktiv, 'Dieses Konto ist deaktiviert. Bitte wende dich an die Redaktion.', 403);
    if (ctx.token) sitzungBeenden(ctx.db, ctx.token);
    ctx.neueSitzung = sitzungErstellen(ctx.db, z.id);
    ctx.db.prepare('update nutzer set letzter_login = ? where id = ?').run(jetzt(), z.id);
    return nutzerLaden(ctx.db, z.id);
  },

  abmelden(ctx) {
    sitzungBeenden(ctx.db, ctx.token);
    ctx.sitzungLoeschen = true;
    return null;
  },

  // ---------------------------------------------------------------- Zugang anfragen (ohne Anmeldung)
  zugangAnfragen(ctx, daten = {}) {
    const email = trim(daten.email).toLowerCase();
    pruefe(!leer(daten.vorname) && !leer(daten.nachname), 'Bitte Vor- und Nachnamen angeben.');
    pruefe(EMAIL.test(email) && email.length <= 200, 'Bitte eine gültige E-Mail-Adresse angeben.');
    // bewusst dieselbe Antwort, ob ein Konto existiert oder nicht (kein Ausforschen von Konten)
    const vorhanden = ctx.db.prepare('select 1 from nutzer where email = ?').get(email)
      || ctx.db.prepare("select 1 from anfragen where email = ? and status = 'offen'").get(email);
    const offen = ctx.db.prepare("select count(*) c from anfragen where status = 'offen'").get().c;
    pruefe(offen < 500, 'Derzeit können keine Anfragen angenommen werden. Bitte später erneut versuchen.', 503);
    if (!vorhanden) {
      ctx.db.prepare('insert into anfragen (id, vorname, nachname, email, nachricht, am) values (?, ?, ?, ?, ?, ?)')
        .run(id(), trim(daten.vorname).slice(0, 100), trim(daten.nachname).slice(0, 100), email,
          trim(daten.nachricht).slice(0, 1000), jetzt());
    }
    return true;
  },

  async erstesPasswortSetzen(ctx, neu) {
    ctx.erlaubtMitStartpasswort = true;
    const n = ich(ctx);
    pruefe(n.muss_passwort_aendern, 'Bitte das Passwort im Profil ändern.');
    pruefe(String(neu ?? '').length >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
    const z = ctx.db.prepare('select passwort from nutzer where id = ?').get(n.id);
    pruefe(!(await passwortPasst(z.passwort, neu)), 'Bitte ein neues Passwort wählen, nicht das Startpasswort.');
    const hash = await passwortHash(neu);
    ctx.db.prepare('update nutzer set passwort = ?, muss_passwort_aendern = 0 where id = ?').run(hash, n.id);
    alleSitzungenBeenden(ctx.db, n.id, ctx.token);
    return true;
  },

  async passwortAendern(ctx, alt, neu) {
    const n = ich(ctx);
    const z = ctx.db.prepare('select passwort from nutzer where id = ?').get(n.id);
    pruefe(await passwortPasst(z.passwort, alt), 'Das bisherige Passwort stimmt nicht.');
    pruefe(String(neu ?? '').length >= 8, 'Das Passwort muss mindestens 8 Zeichen haben.');
    const hash = await passwortHash(neu);
    ctx.db.prepare('update nutzer set passwort = ?, muss_passwort_aendern = 0 where id = ?').run(hash, n.id);
    alleSitzungenBeenden(ctx.db, n.id, ctx.token);
    return true;
  },

  // ---------------------------------------------------------------- Profil
  profilSpeichern(ctx, d = {}) {
    const n = ich(ctx);
    const email = trim(d.email).toLowerCase();
    pruefe(!leer(d.vorname) && !leer(d.nachname), 'Bitte Vor- und Nachnamen angeben.');
    pruefe(EMAIL.test(email), 'Bitte eine gültige E-Mail-Adresse angeben.');
    pruefe(!ctx.db.prepare('select 1 from nutzer where email = ? and id <> ?').get(email, n.id), 'Diese E-Mail-Adresse wird schon verwendet.');
    if (!leer(d.iban)) pruefe(!ibanFehler(d.iban), ibanFehler(d.iban));
    pruefe(bicIstGueltig(d.bic), 'Der BIC ist ungültig.');
    // Profil-Links auf campus-a-college.at und campus-a.at; ohne Angabe bleibt eine bestehende Verknüpfung erhalten
    const links = {};
    for (const m of MEDIUM_KEYS) {
      const feld = PROFIL_FELD[m];
      links[feld] = d[feld] === undefined ? n.profil[feld] : profilIdAusLink(d[feld], m);
      pruefe(links[feld] !== null, profilLinkFehler(m));
    }
    ctx.db.prepare(`update nutzer set vorname = ?, nachname = ?, email = ?, strasse = ?, plz_ort = ?,
        kontoinhaber = ?, iban = ?, bic = ?, campus_profil = ?, campus_a_profil = ? where id = ?`)
      .run(trim(d.vorname).slice(0, 100), trim(d.nachname).slice(0, 100), email, trim(d.strasse).slice(0, 150),
        trim(d.plz_ort).slice(0, 100), trim(d.kontoinhaber).slice(0, 70), normalizeIban(d.iban), normalizeBic(d.bic),
        links.campus_profil, links.campus_a_profil, n.id);
    return nutzerLaden(ctx.db, n.id);
  },

  einstellungen(ctx) {
    ich(ctx);
    return einstellungenLaden(ctx.db);
  },

  // ---------------------------------------------------------------- Leistungen (Entwürfe)
  meineLeistungen(ctx) {
    const n = brauche(ctx, 'autor');
    return ctx.db.prepare('select * from positionen where autor_id = ? order by veroeffentlichung, erstellt_am').all(n.id)
      .map((p) => ({ ...positionAusZeile({ ...p, betrag_eingereicht_cent: p.betrag_cent, betrag_vermerk: '' }) }));
  },

  leistungSpeichern(ctx, d = {}) {
    const n = brauche(ctx, 'autor');
    const istKolumne = d.kategorie === 'kolumne';
    // Redigieren (nur campus a college): Anzahl der Texte × Satz pro Text
    const istRedigieren = d.kategorie === 'redigieren';
    const anzahl = istRedigieren ? Number(d.anzahl) : 0;
    const p = {
      kategorie: d.kategorie,
      // Kolumnen haben eine Art der Kolumne (freier Text, optional), außerordentliche Honorare eine Art des Honorars
      art: d.kategorie === 'ausserordentlich' ? artNormalisieren(d.art) : '',
      kolumnenart: istKolumne ? artNormalisieren(d.kolumnenart) : '',
      titel: (trim(d.titel) || (istRedigieren ? redigierTitel(anzahl) : '')).slice(0, 200),
      artikel_url: istRedigieren ? '' : trim(d.artikel_url),
      // ohne Angabe: das (erste) Medium mit Profil-Link
      medium: istRedigieren ? 'college' : (d.medium ?? verbundeneMedien(n.profil)[0] ?? 'college'),
      anzahl,
      veroeffentlichung: String(d.veroeffentlichung ?? ''),
      ausgabe: trim(d.ausgabe).slice(0, 100),
      vereinbart_mit: d.kategorie === 'ausserordentlich' ? trim(d.vereinbart_mit).slice(0, 100) : '',
      notiz: trim(d.notiz).slice(0, 1000),
    };
    pruefe(['kolumne', 'ausserordentlich', 'redigieren'].includes(p.kategorie), 'Bitte wählen, ob Kolumne oder außerordentliches Honorar.');
    if (istRedigieren) {
      pruefe(darfRedigieren(n), 'Redigieren ist für dein Konto nicht freigeschaltet. Bitte wende dich an den Admin.', 403);
      pruefe(Number.isInteger(anzahl) && anzahl >= 1 && anzahl <= 1000, 'Bitte die Anzahl der redigierten Texte angeben (1 bis 1000).');
    }
    pruefe(!leer(p.titel), 'Bitte den Titel des Beitrags angeben.');
    if (p.kategorie === 'ausserordentlich') pruefe(!leer(p.art), 'Bitte die Art des Honorars angeben.');
    pruefe(istMedium(p.medium), 'Bitte wählen, ob für campus a college oder campus a.');
    // nur Medien mit Profil-Link (Redigieren ausgenommen); eine ältere Leistung darf ihr bisheriges Medium behalten
    const bisher = d.id ? ctx.db.prepare('select medium from positionen where id = ? and autor_id = ?').get(String(d.id), n.id) : null;
    pruefe(istRedigieren || verbundeneMedien(n.profil).includes(p.medium) || bisher?.medium === p.medium, nichtVerbunden(p.medium));
    if (p.artikel_url) {
      pruefe(mediumVonArtikel(p.artikel_url) === p.medium, `Der Link zum Artikel ist ungültig (erwartet: ein Artikel auf ${MEDIEN[p.medium].seite}).`);
      pruefe(!artikelSchonVerwendet(ctx.db, n.id, p.artikel_url, d.id ? String(d.id) : null), ARTIKEL_DOPPELT);
    }
    pruefe(/^\d{4}-\d{2}-\d{2}$/.test(p.veroeffentlichung) && !Number.isNaN(Date.parse(p.veroeffentlichung)), 'Bitte das Datum der Veröffentlichung angeben.');
    if (p.kategorie === 'ausserordentlich') pruefe(!leer(p.vereinbart_mit), 'Bitte angeben, mit wem aus der Redaktion das Honorar vereinbart wurde.');
    // Redigieren: Betrag rechnet der Server aus (Anzahl × eingestellter Satz pro Text)
    const betragCent = istRedigieren ? anzahl * cent(einstellungenLaden(ctx.db).honorarsaetze.college.redigieren) : cent(d.betrag);
    if (d.id) {
      const r = ctx.db.prepare(`update positionen set kategorie = ?, art = ?, kolumnenart = ?, titel = ?, veroeffentlichung = ?, ausgabe = ?,
          vereinbart_mit = ?, notiz = ?, betrag_cent = ?, artikel_url = ?, medium = ?, anzahl = ?, geaendert_am = ? where id = ? and autor_id = ?`)
        .run(p.kategorie, p.art, p.kolumnenart, p.titel, p.veroeffentlichung, p.ausgabe, p.vereinbart_mit, p.notiz, betragCent,
          p.artikel_url, p.medium, p.anzahl, jetzt(), String(d.id), n.id);
      pruefe(r.changes === 1, 'Diese Leistung gibt es nicht (mehr).', 404);
    } else {
      pruefe(ctx.db.prepare('select count(*) c from positionen where autor_id = ?').get(n.id).c < 500, 'Zu viele gespeicherte Leistungen.');
      ctx.db.prepare(`insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe, vereinbart_mit,
          notiz, betrag_cent, artikel_url, medium, anzahl, erstellt_am) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id(), n.id, p.kategorie, p.art, p.kolumnenart, p.titel, p.veroeffentlichung, p.ausgabe, p.vereinbart_mit, p.notiz, betragCent,
          p.artikel_url, p.medium, p.anzahl, jetzt());
    }
    return true;
  },

  leistungLoeschen(ctx, pid) {
    const n = brauche(ctx, 'autor');
    const r = ctx.db.prepare('delete from positionen where id = ? and autor_id = ?').run(String(pid), n.id);
    pruefe(r.changes === 1, 'Diese Leistung gibt es nicht (mehr).', 404);
    return true;
  },

  /**
   * Alle Artikel der Autor:in auf campus-a-college.at und campus-a.at (je nach hinterlegten Profilen),
   * neueste zuerst, mit Vermerk, ob schon als Leistung erfasst
   */
  async meineArtikel(ctx, { neu = false } = {}) {
    const n = brauche(ctx, 'autor');
    const medien = verbundeneMedien(n.profil);
    if (!medien.length) return { verknuepft: false, artikel: [] };
    const ergebnisse = await Promise.allSettled(medien.map((m) =>
      artikelVonProfil(ctx.db, n.profil[PROFIL_FELD[m]], { medium: m, holen: ctx.campusHolen, neu: Boolean(neu) })));
    const nichtErreichbar = medien.filter((m, i) => ergebnisse[i].status === 'rejected').map((m) => MEDIEN[m].seite);
    pruefe(nichtErreichbar.length < medien.length,
      `${nichtErreichbar.join(' und ')} ${nichtErreichbar.length > 1 ? 'sind' : 'ist'} gerade nicht erreichbar. Bitte später erneut versuchen.`, 502);
    const verwendet = verwendeteArtikel(ctx.db, n.id);
    const artikel = ergebnisse.flatMap((e) => (e.status === 'fulfilled' ? e.value : []))
      .sort((x, y) => (y.datum || '').localeCompare(x.datum || ''))
      .map((a) => ({ ...a, erfasst: verwendet.has(a.url) }));
    return {
      verknuepft: true,
      medien,
      warnung: nichtErreichbar.length ? `${nichtErreichbar.join(' und ')} ist gerade nicht erreichbar, diese Artikel fehlen.` : '',
      artikel,
    };
  },

  naechsteNummer(ctx) {
    const n = brauche(ctx, 'autor');
    return naechsteNummer(ctx.db, n);
  },

  notenDiesenMonat(ctx) {
    const n = brauche(ctx, 'autor');
    return notenListe(ctx.db, n, 'where autor_id = ? and monat = ?', [n.id, heuteIso().slice(0, 7)]);
  },

  abrechnungAbschicken(ctx, positionIds) {
    const n = brauche(ctx, 'autor');
    pruefe(Array.isArray(positionIds) && positionIds.length && positionIds.length <= 200, 'Bitte mindestens eine Leistung auswählen.');
    const ids = positionIds.map(String);
    return transaktion(ctx.db, () => {
      const positionen = ctx.db.prepare(`select * from positionen where autor_id = ? and id in (${ids.map(() => '?').join(',')})
        order by veroeffentlichung, erstellt_am`).all(n.id, ...ids);
      pruefe(positionen.length === ids.length, 'Einige Leistungen gibt es nicht mehr. Bitte Seite neu laden.');
      // campus a und campus a college bekommen getrennte Honorarnoten
      const medium = mediumOder(positionen[0].medium);
      pruefe(positionen.every((p) => mediumOder(p.medium) === medium), 'Leistungen für campus a und campus a college bitte getrennt abschicken.');
      const { jahr, laufendeNummer, nummer } = naechsteNummer(ctx.db, n);
      const e = einstellungenLaden(ctx.db);
      const noteId = id();
      ctx.db.prepare(`insert into noten (id, nummer, jahr, laufende_nummer, monat, medium, autor_id, status, eingereicht_am,
          autor_json, zahlung_json, empfaenger_json) values (?, ?, ?, ?, ?, ?, ?, 'eingereicht', ?, ?, ?, ?)`)
        .run(noteId, nummer, jahr, laufendeNummer, heuteIso().slice(0, 7), medium, n.id, jetzt(),
          JSON.stringify({ vorname: n.vorname, nachname: n.nachname, email: n.email, strasse: n.profil.strasse, plz_ort: n.profil.plz_ort }),
          JSON.stringify({ kontoinhaber: n.profil.kontoinhaber, iban: n.profil.iban, bic: n.profil.bic }),
          JSON.stringify(e.empfaenger));
      const einf = ctx.db.prepare(`insert into note_positionen (id, note_id, reihenfolge, kategorie, art, kolumnenart, titel, veroeffentlichung,
          ausgabe, vereinbart_mit, notiz, betrag_cent, betrag_eingereicht_cent, artikel_url, medium, anzahl)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      positionen.forEach((p, i) => einf.run(p.id, noteId, i, p.kategorie, p.art, p.kolumnenart, p.titel, p.veroeffentlichung, p.ausgabe,
        p.vereinbart_mit, p.notiz, p.betrag_cent, p.betrag_cent, p.artikel_url, medium, p.anzahl ?? 0));
      ctx.db.prepare(`delete from positionen where autor_id = ? and id in (${ids.map(() => '?').join(',')})`).run(n.id, ...ids);
      const summe = positionen.reduce((s, p) => s + p.betrag_cent, 0);
      verlaufEintragen(ctx.db, noteId, n, 'eingereicht', { betrag: euro(summe), positionen: positionen.length, medium: mediumName(medium) });
      return sicht(n, noteHolen(ctx.db, noteId));
    });
  },

  meineNoten(ctx) {
    const n = brauche(ctx, 'autor');
    return notenListe(ctx.db, n, 'where autor_id = ?', [n.id]);
  },

  /** Ältere abgelehnte Noten (vor der automatischen Rückgabe): Leistungen selbst zurückholen */
  leistungenZurueckholen(ctx, noteId) {
    const n = brauche(ctx, 'autor');
    return transaktion(ctx.db, () => {
      const note = noteHolen(ctx.db, noteId);
      pruefe(note.autor_id === n.id, 'Dafür fehlt dir die Berechtigung.', 403);
      pruefe(note.status === 'abgelehnt', 'Nur abgelehnte Honorarnoten können überarbeitet werden.');
      pruefe(!note.zurueckgeholt_am, 'Die Leistungen wurden bereits zurückgeholt.');
      zurueckAnAutor(ctx.db, note, n);
      return true;
    });
  },

  // ---------------------------------------------------------------- Redaktion
  alleNoten(ctx) {
    const n = brauche(ctx, 'redaktion');
    return notenListe(ctx.db, n);
  },

  note(ctx, noteId) {
    const n = ich(ctx);
    const note = noteHolen(ctx.db, noteId);
    pruefe(darfSehen(n, note), 'Dafür fehlt dir die Berechtigung.', 403);
    return sicht(n, note);
  },

  annehmen(ctx, noteId) {
    const n = brauche(ctx, 'redaktion');
    return transaktion(ctx.db, () => {
      const x = noteHolen(ctx.db, noteId);
      pruefe(['eingereicht', 'abgelehnt'].includes(x.status), 'Diese Honorarnote kann nicht angenommen werden.');
      pruefe(!x.zurueckgeholt_am, 'Die Autor:in überarbeitet diese Leistungen bereits in einer neuen Honorarnote.');
      ctx.db.prepare("update noten set status = 'angenommen', ablehnungsgrund = '', entschieden_am = ? where id = ?").run(jetzt(), x.id);
      verlaufEintragen(ctx.db, x.id, n, 'angenommen', { vorher: x.status });
      return true;
    });
  },

  ablehnen(ctx, noteId, grund) {
    const n = brauche(ctx, 'redaktion');
    pruefe(!leer(grund), 'Bitte eine Begründung für die Ablehnung angeben.');
    const g = trim(grund).slice(0, 1000);
    return transaktion(ctx.db, () => {
      const x = noteHolen(ctx.db, noteId);
      pruefe(['eingereicht', 'angenommen'].includes(x.status), 'Diese Honorarnote kann nicht abgelehnt werden.');
      ctx.db.prepare("update noten set status = 'abgelehnt', ablehnungsgrund = ?, entschieden_am = ? where id = ?").run(g, jetzt(), x.id);
      verlaufEintragen(ctx.db, x.id, n, 'abgelehnt', { vorher: x.status, grund: g });
      // die Leistungen gehen sofort zurück an die Autor:in zum Überarbeiten
      zurueckAnAutor(ctx.db, { ...x, ablehnungsgrund: g }, n);
      return true;
    });
  },

  betragKorrigieren(ctx, noteId, positionId, betrag, vermerk) {
    const n = brauche(ctx, 'redaktion');
    pruefe(!leer(vermerk), 'Ein Vermerk zur Betragskorrektur ist Pflicht.');
    const neuCent = cent(betrag);
    const v = trim(vermerk).slice(0, 500);
    return transaktion(ctx.db, () => {
      const x = noteHolen(ctx.db, noteId);
      pruefe(x.status !== 'bezahlt', 'Bezahlte Honorarnoten können nicht mehr geändert werden.');
      const p = x.positionen.find((y) => y.id === positionId);
      pruefe(p, 'Diese Position gibt es nicht.', 404);
      pruefe(cent(p.betrag) !== neuCent, 'Der Betrag ist unverändert.');
      ctx.db.prepare('update note_positionen set betrag_cent = ?, betrag_vermerk = ? where note_id = ? and id = ?').run(neuCent, v, x.id, p.id);
      verlaufEintragen(ctx.db, x.id, n, 'betrag_korrigiert', { position: p.titel, alt: p.betrag, neu: euro(neuCent), vermerk: v });
      return true;
    });
  },

  kommentieren(ctx, noteId, text) {
    const n = brauche(ctx, 'redaktion');
    pruefe(!leer(text), 'Der Kommentar ist leer.');
    const x = noteHolen(ctx.db, noteId);
    transaktion(ctx.db, () => {
      ctx.db.prepare('insert into kommentare (id, note_id, verfasser_id, verfasser_name, text, am) values (?, ?, ?, ?, ?, ?)')
        .run(id(), x.id, n.id, anzeigename(n), trim(text).slice(0, 2000), jetzt());
      verlaufEintragen(ctx.db, x.id, n, 'kommentar');
    });
    return true;
  },

  kommentare(ctx, noteId) {
    brauche(ctx, 'redaktion');
    return ctx.db.prepare('select * from kommentare where note_id = ? order by am').all(String(noteId));
  },

  verlaufVon(ctx, noteId) {
    brauche(ctx, 'redaktion');
    return ctx.db.prepare('select * from verlauf where note_id = ? order by am desc').all(String(noteId))
      .map((v) => ({ ...v, details: JSON.parse(v.details) }));
  },

  // ---------------------------------------------------------------- Buchhaltung
  offeneZahlungen(ctx) {
    const n = brauche(ctx, 'buchhaltung');
    return notenListe(ctx.db, n, "where status = 'angenommen'", [], 'entschieden_am');
  },

  bezahlteNoten(ctx, monat) {
    const n = brauche(ctx, 'buchhaltung');
    pruefe(/^\d{4}-\d{2}$/.test(String(monat)), 'Ungültiger Monat.');
    return notenListe(ctx.db, n, "where status = 'bezahlt' and bezahlt_am like ?", [`${monat}-%`], 'bezahlt_am, nummer');
  },

  /** Bezahlte Noten ab einem Zahlungsdatum ("JJJJ-MM-TT"), z. B. für die letzten Wochen */
  bezahlteNotenSeit(ctx, datum) {
    const n = brauche(ctx, 'buchhaltung');
    pruefe(/^\d{4}-\d{2}-\d{2}$/.test(String(datum ?? '')), 'Ungültiges Datum.');
    return notenListe(ctx.db, n, "where status = 'bezahlt' and bezahlt_am >= ?", [datum], 'bezahlt_am, nummer');
  },

  alsBezahltMarkieren(ctx, noteId, datum) {
    return funktionen.alleAlsBezahltMarkieren(ctx, [noteId], datum)[0];
  },

  /** Mehrere Noten auf einmal als bezahlt markieren (z. B. eine ganze Woche): alle oder keine */
  alleAlsBezahltMarkieren(ctx, noteIds, datum) {
    const n = brauche(ctx, 'buchhaltung');
    pruefe(/^\d{4}-\d{2}-\d{2}$/.test(String(datum ?? '')) && datum <= heuteIso(), 'Bitte ein gültiges Zahlungsdatum angeben (nicht in der Zukunft).');
    pruefe(Array.isArray(noteIds) && noteIds.length && noteIds.length <= 500, 'Bitte mindestens eine Honorarnote auswählen.');
    return transaktion(ctx.db, () => noteIds.map((noteId) => {
      const x = noteHolen(ctx.db, noteId);
      pruefe(x.status === 'angenommen', `${x.nummer}: Nur angenommene Honorarnoten können als bezahlt markiert werden.`);
      ctx.db.prepare("update noten set status = 'bezahlt', bezahlt_am = ? where id = ?").run(datum, x.id);
      verlaufEintragen(ctx.db, x.id, n, 'bezahlt', { datum });
      return sicht(n, noteHolen(ctx.db, x.id));
    }));
  },

  // ---------------------------------------------------------------- Admin: Anfragen & Konten
  anfragen(ctx) {
    brauche(ctx, 'admin');
    return ctx.db.prepare('select * from anfragen order by am desc limit 300').all();
  },

  offeneAnfragenAnzahl(ctx) {
    const n = ich(ctx);
    if (!hat(n, 'admin')) return 0;
    return ctx.db.prepare("select count(*) c from anfragen where status = 'offen'").get().c;
  },

  async anfrageFreischalten(ctx, anfrageId, rollen = ['autor']) {
    const admin = brauche(ctx, 'admin');
    const r = erlaubteRollen(rollen);
    pruefe(r.length, 'Bitte mindestens eine Rolle wählen.');
    const passwort = startpasswort();
    const hash = await passwortHash(passwort);
    return transaktion(ctx.db, () => {
      const a = ctx.db.prepare('select * from anfragen where id = ?').get(String(anfrageId));
      pruefe(a, 'Diese Anfrage gibt es nicht (mehr).', 404);
      pruefe(a.status === 'offen', 'Diese Anfrage wurde bereits bearbeitet.');
      pruefe(!ctx.db.prepare('select 1 from nutzer where email = ?').get(a.email), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
      kontoEinfuegen(ctx.db, { vorname: a.vorname, nachname: a.nachname, email: a.email, rollen: r }, hash);
      ctx.db.prepare("update anfragen set status = 'freigeschaltet', bearbeitet_am = ?, bearbeitet_von = ? where id = ?")
        .run(jetzt(), anzeigename(admin), a.id);
      return { email: a.email, vorname: a.vorname, passwort };
    });
  },

  anfrageAblehnen(ctx, anfrageId) {
    const admin = brauche(ctx, 'admin');
    const r = ctx.db.prepare("update anfragen set status = 'abgelehnt', bearbeitet_am = ?, bearbeitet_von = ? where id = ? and status = 'offen'")
      .run(jetzt(), anzeigename(admin), String(anfrageId));
    pruefe(r.changes === 1, 'Diese Anfrage wurde bereits bearbeitet.');
    return true;
  },

  async nutzerAnlegen(ctx, d = {}) {
    brauche(ctx, 'admin');
    const email = trim(d.email).toLowerCase();
    pruefe(!leer(d.vorname) && !leer(d.nachname), 'Bitte Vor- und Nachnamen angeben.');
    pruefe(EMAIL.test(email), 'Bitte eine gültige E-Mail-Adresse angeben.');
    const r = erlaubteRollen(d.rollen);
    pruefe(r.length, 'Bitte mindestens eine Rolle wählen.');
    const passwort = startpasswort();
    const hash = await passwortHash(passwort);
    return transaktion(ctx.db, () => {
      pruefe(!ctx.db.prepare('select 1 from nutzer where email = ?').get(email), 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
      kontoEinfuegen(ctx.db, { vorname: d.vorname, nachname: d.nachname, email, rollen: r }, hash);
      ctx.db.prepare("update anfragen set status = 'freigeschaltet', bearbeitet_am = ? where email = ? and status = 'offen'").run(jetzt(), email);
      return { email, vorname: trim(d.vorname), passwort };
    });
  },

  nutzerListe(ctx) {
    brauche(ctx, 'admin');
    return ctx.db.prepare('select * from nutzer order by nachname collate nocase, vorname collate nocase').all().map(nutzerAusZeile);
  },

  rollenSetzen(ctx, uid, rollen) {
    brauche(ctx, 'admin');
    const r = erlaubteRollen(rollen);
    return transaktion(ctx.db, () => {
      const n = nutzerLaden(ctx.db, String(uid));
      pruefe(n, 'Dieses Konto gibt es nicht (mehr).', 404);
      if (!r.includes('admin')) pruefe(nochEinAdmin(ctx.db, n.id), 'Es muss mindestens ein aktives Admin-Konto geben.');
      ctx.db.prepare('update nutzer set rollen = ? where id = ?').run(JSON.stringify(r), n.id);
      return true;
    });
  },

  nutzerAktivSetzen(ctx, uid, aktiv) {
    const admin = brauche(ctx, 'admin');
    return transaktion(ctx.db, () => {
      const n = nutzerLaden(ctx.db, String(uid));
      pruefe(n, 'Dieses Konto gibt es nicht (mehr).', 404);
      pruefe(aktiv || n.id !== admin.id, 'Du kannst dein eigenes Konto nicht deaktivieren.');
      if (!aktiv && n.rollen.includes('admin')) pruefe(nochEinAdmin(ctx.db, n.id), 'Es muss mindestens ein aktives Admin-Konto geben.');
      ctx.db.prepare('update nutzer set aktiv = ? where id = ?').run(aktiv ? 1 : 0, n.id);
      if (!aktiv) alleSitzungenBeenden(ctx.db, n.id);
      return true;
    });
  },

  async passwortZuruecksetzen(ctx, uid) {
    brauche(ctx, 'admin');
    const n = nutzerLaden(ctx.db, String(uid));
    pruefe(n, 'Dieses Konto gibt es nicht (mehr).', 404);
    const passwort = startpasswort();
    const hash = await passwortHash(passwort);
    ctx.db.prepare('update nutzer set passwort = ?, muss_passwort_aendern = 1 where id = ?').run(hash, n.id);
    alleSitzungenBeenden(ctx.db, n.id, n.id === ctx.nutzer.id ? ctx.token : null);
    return { email: n.email, vorname: n.vorname, passwort };
  },

  nutzerLoeschen(ctx, uid) {
    const admin = brauche(ctx, 'admin');
    return transaktion(ctx.db, () => {
      const n = nutzerLaden(ctx.db, String(uid));
      pruefe(n, 'Dieses Konto gibt es nicht (mehr).', 404);
      pruefe(n.id !== admin.id, 'Du kannst dein eigenes Konto nicht löschen.');
      if (n.rollen.includes('admin')) pruefe(nochEinAdmin(ctx.db, n.id), 'Es muss mindestens ein aktives Admin-Konto geben.');
      // abgeschickte Honorarnoten bleiben als Buchhaltungsbelege erhalten (autor_id wird leer)
      ctx.db.prepare('delete from nutzer where id = ?').run(n.id);
      return true;
    });
  },

  // ---------------------------------------------------------------- Admin: Honorarnoten & Einstellungen
  alleNotenAdmin(ctx) {
    const n = brauche(ctx, 'admin');
    return notenListe(ctx.db, n);
  },

  noteLoeschen(ctx, noteId) {
    const admin = brauche(ctx, 'admin');
    return transaktion(ctx.db, () => {
      const x = noteHolen(ctx.db, noteId);
      ctx.db.prepare('delete from noten where id = ?').run(x.id);
      ctx.db.prepare('insert into loeschprotokoll (id, nummer, geloescht_von, am) values (?, ?, ?, ?)')
        .run(id(), x.nummer, anzeigename(admin), jetzt());
      return true;
    });
  },

  loeschprotokoll(ctx) {
    brauche(ctx, 'admin');
    return ctx.db.prepare('select * from loeschprotokoll order by am desc').all();
  },

  einstellungenSpeichern(ctx, d = {}) {
    brauche(ctx, 'admin');
    const e = d.empfaenger ?? {};
    pruefe(!leer(e.name), 'Bitte den Namen des Rechnungsempfängers angeben.');
    const kontakt = trim(d.datenschutzKontakt);
    pruefe(!kontakt || EMAIL.test(kontakt), 'Bitte eine gültige E-Mail-Adresse für Datenschutzanfragen angeben.');
    let saetze;
    try {
      saetze = saetzeNormalisieren(d.honorarsaetze ?? einstellungenLaden(ctx.db).honorarsaetze);
    } catch (fehler) {
      throw new Fehler(fehler.message);
    }
    const speichere = ctx.db.prepare('insert into einstellungen (schluessel, wert) values (?, ?) on conflict(schluessel) do update set wert = excluded.wert');
    transaktion(ctx.db, () => {
      speichere.run('empfaenger', JSON.stringify({
        name: trim(e.name).slice(0, 150), strasse: trim(e.strasse).slice(0, 150),
        plz_ort: trim(e.plz_ort).slice(0, 100), uid: trim(e.uid).slice(0, 30),
      }));
      speichere.run('datenschutzKontakt', JSON.stringify(kontakt));
      speichere.run('honorarsaetze', JSON.stringify(saetze));
    });
    return true;
  },

  statistik(ctx) {
    brauche(ctx, 'admin');
    const zaehle = (s) => ctx.db.prepare('select count(*) c from noten where status = ?').get(s).c;
    return {
      nutzer: ctx.db.prepare('select count(*) c from nutzer').get().c,
      anfragen: ctx.db.prepare("select count(*) c from anfragen where status = 'offen'").get().c,
      entwuerfe: ctx.db.prepare('select count(*) c from positionen').get().c,
      eingereicht: zaehle('eingereicht'),
      angenommen: zaehle('angenommen'),
      abgelehnt: zaehle('abgelehnt'),
      bezahlt: zaehle('bezahlt'),
    };
  },

  /** Datenexport als JSON (ohne Passwörter und Sitzungen) – enthält IBANs, vertraulich! */
  exportieren(ctx) {
    brauche(ctx, 'admin');
    const alle = (t) => ctx.db.prepare(`select * from ${t}`).all();
    return JSON.stringify({
      exportiert_am: jetzt(),
      nutzer: alle('nutzer').map(({ passwort, ...rest }) => rest),
      anfragen: alle('anfragen'),
      positionen: alle('positionen'),
      noten: alle('noten'),
      note_positionen: alle('note_positionen'),
      kommentare: alle('kommentare'),
      verlauf: alle('verlauf'),
      loeschprotokoll: alle('loeschprotokoll'),
      einstellungen: alle('einstellungen'),
    }, null, 2);
  },
};

// ------------------------------------------------------------------ interne Helfer

/**
 * Leistungen einer abgelehnten Note zurück in „Meine Leistungen“ der Autor:in (mit eingereichtem Betrag,
 * Medium, Artikel-Link und der Begründung als Hinweis). Die Note gilt danach als zurückgeholt.
 */
function zurueckAnAutor(db, note, akteur) {
  if (note.autor_id && db.prepare('select 1 from nutzer where id = ?').get(note.autor_id)) {
    const einf = db.prepare(`insert into positionen (id, autor_id, kategorie, art, kolumnenart, titel, veroeffentlichung, ausgabe,
        vereinbart_mit, notiz, betrag_cent, artikel_url, medium, anzahl, zurueck_nummer, zurueck_grund, erstellt_am)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of note.positionen) {
      einf.run(id(), note.autor_id, p.kategorie, p.art, p.kolumnenart, p.titel, p.veroeffentlichung, p.ausgabe, p.vereinbart_mit,
        p.notiz, cent(p.betrag_eingereicht), p.artikel_url, note.medium, p.anzahl ?? 0, note.nummer, note.ablehnungsgrund ?? '', jetzt());
    }
  }
  db.prepare('update noten set zurueckgeholt_am = ? where id = ?').run(jetzt(), note.id);
  verlaufEintragen(db, note.id, akteur, 'zurueckgeholt');
}

/** Titel einer Redigier-Leistung ohne eigene Beschreibung */
const redigierTitel = (anzahl) => `Redigieren (${textAnzahl(anzahl)})`;

const ARTIKEL_DOPPELT = 'Dieser Artikel ist schon als Leistung gespeichert oder abgerechnet.';

/**
 * Artikel-Adressen, die schon erfasst sind: gespeicherte Leistungen und abgeschickte Honorarnoten.
 * Ausgenommen sind abgelehnte Noten, deren Leistungen zurückgeholt wurden (die stehen wieder in den Leistungen).
 */
function verwendeteArtikel(db, autorId, ohnePosition = null) {
  const urls = db.prepare(`select artikel_url u from positionen where autor_id = ? and artikel_url <> '' and id is not ?
    union select np.artikel_url from note_positionen np join noten n on n.id = np.note_id
    where n.autor_id = ? and np.artikel_url <> '' and not (n.status = 'abgelehnt' and n.zurueckgeholt_am is not null)`)
    .all(autorId, ohnePosition, autorId);
  return new Set(urls.map((z) => z.u));
}

const artikelSchonVerwendet = (db, autorId, url, ohnePosition) => verwendeteArtikel(db, autorId, ohnePosition).has(url);

function naechsteNummer(db, n, jahr = Number(heuteIso().slice(0, 4))) {
  const { m } = db.prepare('select coalesce(max(laufende_nummer), 0) m from noten where autor_id = ? and jahr = ?').get(n.id, jahr);
  const laufendeNummer = m + 1;
  return { jahr, laufendeNummer, nummer: honorarnoteNummer({ vorname: n.vorname, nachname: n.nachname, jahr, laufendeNummer }) };
}

function nochEinAdmin(db, ohne) {
  return db.prepare('select rollen from nutzer where id <> ? and aktiv = 1').all(ohne)
    .some((z) => JSON.parse(z.rollen).includes('admin'));
}

function kontoEinfuegen(db, { vorname, nachname, email, rollen }, hash) {
  const nutzerId = id();
  db.prepare(`insert into nutzer (id, email, vorname, nachname, rollen, aktiv, muss_passwort_aendern, passwort, kontoinhaber, erstellt_am)
      values (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
    .run(nutzerId, email, trim(vorname).slice(0, 100), trim(nachname).slice(0, 100), JSON.stringify(rollen), hash,
      `${trim(vorname)} ${trim(nachname)}`.slice(0, 70), jetzt());
  return nutzerId;
}

/** Für das Kommandozeilen-Skript: erstes Admin-Konto anlegen */
export async function adminAnlegen(db, { vorname, nachname, email }) {
  email = trim(email).toLowerCase();
  if (!EMAIL.test(email)) throw new Fehler('Bitte eine gültige E-Mail-Adresse angeben.');
  if (db.prepare('select 1 from nutzer where email = ?').get(email)) throw new Fehler('Für diese E-Mail-Adresse gibt es schon ein Konto.');
  const passwort = startpasswort();
  kontoEinfuegen(db, { vorname: vorname || 'Admin', nachname: nachname || '', email, rollen: ['admin'] }, await passwortHash(passwort));
  return { email, passwort };
}
