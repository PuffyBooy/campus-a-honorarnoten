// Zwei-Faktor-Codes (TOTP nach RFC 6238) für die Demo – auf dem Server macht das server/lib/totp.php.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_SCHRITT = 30;

export function totpGeheimnis() {
  const bits = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(2).padStart(8, '0')).join('');
  return bits.match(/.{5}/g).map((t) => BASE32[parseInt(t, 2)]).join('');
}

function base32Dekodieren(s) {
  const bits = s.toUpperCase().replace(/[^A-Z2-7]/g, '').split('').map((z) => BASE32.indexOf(z).toString(2).padStart(5, '0')).join('');
  return Uint8Array.from(bits.match(/.{8}/g) ?? [], (b) => parseInt(b, 2));
}

export async function totpCode(geheimnis, schritt) {
  const key = await crypto.subtle.importKey('raw', base32Dekodieren(geheimnis), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const zaehler = new DataView(new ArrayBuffer(8));
  zaehler.setUint32(0, Math.floor(schritt / 2 ** 32));
  zaehler.setUint32(4, schritt >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, zaehler.buffer));
  const o = h[19] & 0x0f;
  const zahl = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(zahl % 1000000).padStart(6, '0');
}

/** Schritt, zu dem der Code passt (±1 Schritt Toleranz), sonst null */
export async function totpPruefen(geheimnis, code) {
  code = String(code ?? '').replace(/\D/g, '');
  if (code.length !== 6) return null;
  const jetzt = Math.floor(Date.now() / 1000 / TOTP_SCHRITT);
  for (const d of [0, -1, 1]) {
    if ((await totpCode(geheimnis, jetzt + d)) === code) return jetzt + d;
  }
  return null;
}

export const totpUri = (geheimnis, konto) => `otpauth://totp/${encodeURIComponent(`campus a Prämien:${konto}`)}?secret=${geheimnis}`
  + `&issuer=${encodeURIComponent('campus a Prämien')}&digits=6&period=${TOTP_SCHRITT}`;

export function ersatzcodes() {
  const teil = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 5);
  return Array.from({ length: 8 }, () => `${teil()}-${teil()}`);
}
