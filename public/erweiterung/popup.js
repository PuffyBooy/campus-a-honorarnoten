// Popup der Erweiterung: Stand dieses Monats, offene Seite zählen
const $ = (id) => document.getElementById(id);
const fragen = (art, tab = null) => new Promise((ok, fehler) => chrome.runtime.sendMessage({ art, tab }, (r) => (r?.fehler ? fehler(new Error(r.fehler)) : ok(r?.daten))));

function zeigen(s) {
  $('anzahl').textContent = s.anzahl;
  $('einheit').textContent = `${s.anzahl === 1 ? 'Text' : 'Texte'} diesen Monat · heute ${s.heute}`;
  $('letzte').replaceChildren(...s.letzte.slice(0, 5).map((e) => {
    const li = document.createElement('li');
    li.textContent = e.titel || (e.quelle === 'erweiterung' ? `Artikel ${e.artikel_id}` : 'mit dem Knopf gezählt');
    return li;
  }));
}

$('app').href = `${self.HONORARE.app}#/leistungen`;
let offen = null; // offene Seite (Adresse, Titel)
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  offen = tab ? { url: tab.url, title: tab.title } : null;
  $('seite').textContent = tab?.title ?? '';
});
fragen('stand').then(zeigen, (e) => { $('meldung').textContent = e.message; $('meldung').className = 'meldung fehler'; });

$('zaehlen').addEventListener('click', async () => {
  $('zaehlen').disabled = true;
  try {
    const s = await fragen('zaehlen', offen);
    zeigen(s);
    $('meldung').textContent = s.neu ? 'Gezählt.' : 'Diese Seite ist diesen Monat schon gezählt.';
    $('meldung').className = 'meldung';
  } catch (e) {
    $('meldung').textContent = e.message;
    $('meldung').className = 'meldung fehler';
  } finally {
    $('zaehlen').disabled = false;
  }
});
