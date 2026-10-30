// Service Worker der Handy-App: macht die App installierbar, zeigt ohne Internet eine Hinweisseite
// und empfängt Push-Mitteilungen. App-Dateien werden absichtlich NICHT zwischengespeichert –
// nach einem Update soll sofort die neue Version laufen.

const OFFLINE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Keine Verbindung</title></head>
<body style="font-family:system-ui,sans-serif;background:#f3f6f5;color:#1d2b2a;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;text-align:center">
<div><p style="font-size:3rem;margin:0">📶</p><h1 style="font-size:1.3rem">Keine Internetverbindung</h1>
<p>Die Anerkennungsprämien brauchen Internet. Sobald du wieder online bist:</p>
<p><button onclick="location.reload()" style="font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#0f6b66;color:#fff">Erneut versuchen</button></p></div>
</body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

// Nur Seitenaufrufe: ohne Netz die Hinweisseite statt der Fehlerseite des Browsers
self.addEventListener('fetch', (ev) => {
  if (ev.request.mode !== 'navigate') return;
  ev.respondWith(fetch(ev.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

// Der Push selbst ist leer – die Mitteilungen holt sich das Gerät mit seiner Anmeldung beim eigenen Server ab
async function mitteilungenZeigen() {
  const abo = await self.registration.pushManager.getSubscription();
  let liste = [];
  try {
    const res = await fetch('api/pushAbholen', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Honorare': '1' },
      body: JSON.stringify({ args: [abo?.endpoint ?? ''] }),
    });
    if (res.ok) liste = (await res.json()).daten ?? [];
  } catch { /* offline oder abgemeldet: allgemeiner Hinweis */ }
  if (!liste.length) liste = [{ id: 'allgemein', titel: 'Neuigkeiten bei den Anerkennungsprämien', ziel: '' }];
  await Promise.all(liste.map((m) => self.registration.showNotification(m.titel, {
    body: 'campus a · Anerkennungsprämien – tippen zum Öffnen',
    icon: 'img/icon-192.png',
    badge: 'img/badge-96.png',
    tag: m.id,
    data: { ziel: m.ziel ?? '' },
  })));
}
self.addEventListener('push', (ev) => ev.waitUntil(mitteilungenZeigen()));

// Tippen auf die Mitteilung: App öffnen (oder das offene Fenster nach vorne holen) und zur Seite springen
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = new URL(`./${ev.notification.data?.ziel ?? ''}`, self.registration.scope).href;
  ev.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const offen = fenster.find((f) => f.url.startsWith(self.registration.scope));
    if (offen) {
      await offen.focus();
      return offen.navigate(url).catch(() => offen.postMessage({ ziel: ev.notification.data?.ziel ?? '' }));
    }
    return self.clients.openWindow(url);
  })());
});
