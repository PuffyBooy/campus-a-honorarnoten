// Handy-App: installieren (PWA) und Push-Mitteilungen auf diesem Gerät ein- und ausschalten.
// Der Service Worker (sw.js) holt nach jedem Push die Mitteilungen beim eigenen Server ab.

let installieren = null; // gemerktes „beforeinstallprompt“ (Chrome, Edge, Android)
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installieren = ev;
  window.dispatchEvent(new CustomEvent('honorare:installierbar'));
});

export function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* z. B. ohne HTTPS – App läuft auch ohne */ });
  // Tippen auf eine Mitteilung, während die App offen ist: dorthin springen
  navigator.serviceWorker.addEventListener('message', (ev) => { if (typeof ev.data?.ziel === 'string') location.hash = ev.data.ziel || '#/'; });
}

/** Läuft die Seite schon als installierte App? */
export const istInstalliert = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const istIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const kannInstallieren = () => Boolean(installieren);

/** Installations-Dialog des Browsers zeigen; true, wenn installiert wurde */
export async function installierenStarten() {
  if (!installieren) return false;
  const ev = installieren;
  installieren = null;
  await ev.prompt();
  return (await ev.userChoice).outcome === 'accepted';
}

/** Kann dieses Gerät/dieser Browser überhaupt Push? (iPhone: nur als installierte App ab iOS 16.4) */
export const pushMoeglich = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registrierung() {
  return navigator.serviceWorker.getRegistration().then((r) => r ?? navigator.serviceWorker.ready);
}

/** Aktuelles Push-Abo dieses Geräts (oder null) */
export async function pushAbo() {
  if (!pushMoeglich()) return null;
  return (await registrierung())?.pushManager.getSubscription() ?? null;
}

const schluesselBytes = (b64) => {
  const roh = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(roh, (c) => c.charCodeAt(0));
};

/** Kurzer Gerätename für die Liste („Chrome auf Android“) */
function geraetName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const system = /Android/.test(ua) ? 'Android' : istIos() ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${browser} auf ${system}` : browser;
}

/** Push auf diesem Gerät einschalten: Erlaubnis fragen, beim Push-Dienst anmelden, beim Server eintragen */
export async function pushEinschalten(store) {
  if (!pushMoeglich()) throw new Error('Dieser Browser kann keine Push-Mitteilungen empfangen.');
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== 'granted') {
    throw new Error(erlaubnis === 'denied'
      ? 'Mitteilungen sind für diese Seite blockiert. Bitte in den Browser-Einstellungen erlauben und noch einmal versuchen.'
      : 'Ohne Erlaubnis gibt es keine Mitteilungen.');
  }
  const schluessel = await store.pushSchluessel();
  const reg = await registrierung();
  let abo = await reg.pushManager.getSubscription();
  // altes Abo mit anderem Schlüssel (z. B. nach Neuinstallation des Servers) ersetzen
  if (abo && abo.options?.applicationServerKey
    && btoa(String.fromCharCode(...new Uint8Array(abo.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== schluessel) {
    await abo.unsubscribe();
    abo = null;
  }
  abo ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(schluessel) });
  await store.pushAbonnieren(abo.toJSON(), geraetName());
  return abo;
}

/** Push auf diesem Gerät ausschalten (auch beim Abmelden – das Gerät soll keine Mitteilungen mehr bekommen) */
export async function pushAusschalten(store) {
  const abo = await pushAbo().catch(() => null);
  if (!abo) return;
  await Promise.resolve(store.pushAbmelden(abo.endpoint)).catch(() => {});
  await abo.unsubscribe().catch(() => {});
}
