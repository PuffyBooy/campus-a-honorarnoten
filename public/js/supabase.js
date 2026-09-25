// Supabase-Client. URL und "anon"-Key sind öffentlich und dürfen im Frontend
// stehen – alle Rechte werden in der Datenbank per Row Level Security geprüft.
// NIEMALS den service_role-Key hier eintragen!
import { createClient } from '../vendor/supabase-js.mjs';

const cfg = window.HONORAR_CONFIG ?? {};

export const konfigFehlt = !cfg.supabaseUrl || !cfg.supabaseAnonKey;

export const supabase = konfigFehlt
  ? null
  : createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

export const PDF_BUCKET = 'honorarnoten-pdf';
export const config = cfg;
