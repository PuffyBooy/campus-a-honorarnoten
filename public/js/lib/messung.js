// Messung im Browser (für die Kommandozentrale): jeder Seitenwechsel mit seinen Anfragen, der Start der Seite
// und eine Ping-Serie. Der Server schickt in jeder Antwort seine eigene Zeit (Server-Timing) mit – so lässt sich
// die Wartezeit aufteilen in „Server arbeitet“ und „Netz / Warten“.
// Gespeichert nur in diesem Tab (sessionStorage), nichts geht an den Server.

const SCHLUESSEL = 'campus-a-honorare:messungen';
const MAX_WECHSEL = 40;

let laufend = null; // aktueller Seitenwechsel
let letzteAnfrage = null; // { name, ms, server } der zuletzt beendeten Anfrage
let stand = laden();

function laden() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SCHLUESSEL) ?? 'null');
    if (s && Array.isArray(s.wechsel)) return s;
  } catch { /* gesperrt oder kaputt */ }
  return { wechsel: [], start: null };
}

function speichern() {
  try { sessionStorage.setItem(SCHLUESSEL, JSON.stringify(stand)); } catch { /* egal */ }
}

/** „start;dur=1.2, …, gesamt;dur=12.3“ -> { start: 1.2, …, gesamt: 12.3 } */
export function serverTiming(kopf) {
  const t = {};
  for (const teil of String(kopf ?? '').split(',')) {
    const m = teil.trim().match(/^(\w+);dur=([\d.]+)/);
    if (m) t[m[1]] = Number(m[2]);
  }
  return t;
}

/** Von api.js nach jeder Anfrage: Name, Dauer im Browser, Zeiten des Servers */
export function anfrageGemessen(name, ms, server) {
  letzteAnfrage = { name, ms, server };
  if (!laufend) return;
  laufend.anfragen.push({ name, ms: Math.round(ms), server: server.gesamt == null ? null : Math.round(server.gesamt), sql: server.sql ?? null });
}

/** Von app.js: Seitenwechsel beginnt (vorheriger, nicht fertiger zählt nicht) */
export function wechselStart(pfad, art = 'voll') {
  laufend = { zeit: new Date().toISOString(), pfad: pfad || 'start', art, t0: performance.now(), anfragen: [] };
}

/** Von app.js: Seite ist gezeichnet (art: 'schnell', wenn nur ein Teil ausgetauscht wurde) */
export function wechselEnde(art = null) {
  if (!laufend) return;
  const w = laufend;
  if (art) w.art = art;
  laufend = null;
  const ms = Math.round(performance.now() - w.t0);
  const server = w.anfragen.reduce((s, a) => s + (a.server ?? 0), 0);
  const eintrag = {
    zeit: w.zeit, pfad: w.pfad, art: w.art, ms, anfragen: w.anfragen.length, server_ms: Math.round(server),
    langsamste: w.anfragen.reduce((m, a) => (!m || a.ms > m.ms ? a : m), null),
    liste: w.anfragen,
  };
  stand.wechsel = [eintrag, ...stand.wechsel].slice(0, MAX_WECHSEL);
  // erster Wechsel nach dem Laden: auch den Start der Seite festhalten
  if (!stand.startGemessen) {
    stand.startGemessen = true;
    stand.start = seitenstart(eintrag);
  }
  speichern();
}

/** Laden der Seite: HTML, Programmdateien (wie viele, wie groß, wie lange), bis die erste Seite stand */
function seitenstart(ersterWechsel) {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const skripte = (performance.getEntriesByType?.('resource') ?? []).filter((r) => r.initiatorType === 'script' || /\.m?js(\?|$)/.test(r.name));
  const ende = Math.max(0, ...skripte.map((r) => r.responseEnd));
  return {
    zeit: new Date().toISOString(),
    html_ms: nav ? Math.round(nav.responseEnd - nav.startTime) : null,
    html_warten_ms: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
    dateien: skripte.length,
    kb: Math.round(skripte.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
    aus_cache: skripte.filter((r) => r.transferSize === 0 && r.decodedBodySize > 0).length,
    skripte_ms: Math.round(ende),
    bis_fertig_ms: Math.round(performance.now()),
    erster_wechsel_ms: ersterWechsel.ms,
  };
}

export const letzteWechsel = () => stand.wechsel;
export const letzterStart = () => stand.start;
export function messungenLeeren() {
  stand = { wechsel: [], start: stand.start, startGemessen: true };
  speichern();
}

const median = (w) => { const s = [...w].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * Ping-Serie: n Anfragen nacheinander an den Server (mit Datenbank und Anmeldung, aber ohne Arbeit) und
 * eine kleine Datei ohne PHP. Zeigt, wie viel das Netz kostet, wie viel der Server und ob der Browser
 * nach dem Server noch wartet.
 */
export async function pingSerie(store, n = 15, fortschritt = () => {}) {
  const ergebnisse = [];
  for (let i = 0; i < n; i++) {
    fortschritt(i + 1, n);
    const t0 = performance.now();
    await store.ping();
    const ms = performance.now() - t0;
    // die Server-Zeit dieser Anfrage (Server-Timing der Antwort, von api.js gemeldet)
    const st = letzteAnfrage?.name === 'ping' ? letzteAnfrage.server.gesamt ?? null : null;
    ergebnisse.push({ ms, server: st });
  }
  const datei = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch(`manifest.webmanifest?messung=${Date.now()}-${i}`, { cache: 'no-store' }).then((r) => r.text()).catch(() => null);
    datei.push(performance.now() - t0);
  }
  const ms = ergebnisse.map((e) => e.ms);
  const server = ergebnisse.filter((e) => e.server != null).map((e) => e.server);
  const netz = median(datei);
  return {
    anzahl: n,
    min: Math.round(Math.min(...ms)), median: Math.round(median(ms)), max: Math.round(Math.max(...ms)),
    server_median: server.length ? Math.round(median(server)) : null,
    datei_median: Math.round(netz),
    // was über Netz (gemessen an der kleinen Datei) und Server hinausgeht: Warten, z. B. auf Hintergrundarbeit
    warten_median: server.length ? Math.max(0, Math.round(median(ms) - median(server) - netz)) : null,
    ausreisser: ms.filter((x) => x > median(ms) * 2 + 100).length,
    einzeln: ergebnisse.map((e) => ({ ms: Math.round(e.ms), server: e.server == null ? null : Math.round(e.server) })),
  };
}
