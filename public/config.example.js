// Lokale Entwicklung: als public/config.js kopieren und ausfüllen.
// Auf Netlify wird config.js automatisch aus Umgebungsvariablen erzeugt.
// Nur URL + anon/publishable Key eintragen – NIEMALS den service_role-Key!
window.HONORAR_CONFIG = {
  supabaseUrl: 'https://DEIN-PROJEKT.supabase.co',
  supabaseAnonKey: 'DEIN-ANON-KEY',
  datenschutzKontakt: 'redaktion@example.org',
};
