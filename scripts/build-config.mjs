// Erzeugt public/config.js aus Umgebungsvariablen (Netlify-Build).
// Bricht ab, wenn versehentlich ein service_role-Key verwendet wird.
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const kontakt = process.env.DATENSCHUTZ_KONTAKT ?? '';

if (!url || !key) {
  console.error('SUPABASE_URL und SUPABASE_ANON_KEY müssen gesetzt sein.');
  process.exit(1);
}

function jwtRolle(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;
  } catch {
    return null;
  }
}
if (key.startsWith('sb_secret_') || jwtRolle(key) === 'service_role') {
  console.error('FEHLER: SUPABASE_ANON_KEY ist ein geheimer service_role-Key. Bitte den anon/publishable Key verwenden!');
  process.exit(1);
}

const cfg = { supabaseUrl: url, supabaseAnonKey: key, datenschutzKontakt: kontakt };
writeFileSync(new URL('../public/config.js', import.meta.url),
  `window.HONORAR_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`);
console.log('public/config.js erzeugt für', url);
