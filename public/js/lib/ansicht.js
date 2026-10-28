// „Als Person ansehen“ (Admin): nur diese Funktionen gehen dabei – alles andere ist gesperrt.
// Dieselbe Liste wie Honorare::NUR_ANSEHEN auf dem Server; in der Demo sperrt nurAnsehen() den Rest.
export const NUR_ANSEHEN = ['aktuellerNutzer', 'abmelden', 'ansichtBeenden', 'einstellungen', 'rechtliches', 'navZaehler', 'ablaufZeiten',
  'meineLeistungen', 'meineArtikel', 'naechsteNummer', 'notenDiesenMonat', 'meineNoten', 'note', 'nachrichten', 'nachweisLaden',
  'zahlungsavis', 'alleNoten', 'redaktionListe', 'pruefInfo', 'ausgezahltImJahr', 'kommentare', 'verlaufVon',
  'offeneZahlungen', 'bezahlteNoten', 'bezahlteNotenSeit', 'zahlungskonto'];

// Hilfsfunktionen im Browser, die nichts ändern
const IMMER = ['initialisieren', 'profilVollstaendig', 'ansichtAktiv'];

/** Demo: Datenhaltung so einpacken, dass beim Ansehen nur lesende Funktionen gehen (wie auf dem Server) */
export function nurAnsehen(store) {
  return new Proxy(store, {
    get(ziel, name) {
      const wert = ziel[name];
      if (typeof wert !== 'function' || NUR_ANSEHEN.includes(name) || IMMER.includes(name) || !ziel.ansichtAktiv?.()) return wert;
      return () => Promise.reject(new Error('Du siehst die App gerade als jemand anderes – ändern geht dabei nicht. Oben auf „Zurück zu meinem Konto“.'));
    },
  });
}
