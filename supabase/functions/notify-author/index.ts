// Supabase Edge Function: E-Mail an die Autor:in bei Annahme, Ablehnung und Bezahlung.
//
// Auslöser: Database Webhook auf public.honorarnoten (Ereignis UPDATE), der
// diese Funktion mit dem Header "x-webhook-secret: <WEBHOOK_SECRET>" aufruft.
// Versand über Resend (https://resend.com). Secrets:
//   supabase secrets set RESEND_API_KEY=... WEBHOOK_SECRET=... MAIL_FROM="campus a college <honorare@deine-domain.at>" APP_URL=https://...netlify.app
//
// Der Webhook liefert nur die Tabelle honorarnoten – IBAN/Adresse sind dort nicht enthalten.

type Note = {
  nummer: string;
  status: 'eingereicht' | 'angenommen' | 'abgelehnt' | 'bezahlt';
  vorname: string;
  email: string;
  titel: string;
  betrag: number;
  ablehnungsgrund: string | null;
  bezahlt_am: string | null;
};

const euro = (n: number) =>
  new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(Number(n));
const datum = (iso: string | null) => (iso ? iso.split('-').reverse().join('.') : '');
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function mail(n: Note): { betreff: string; text: string } | null {
  const hallo = `Hallo ${n.vorname},`;
  const gruss = 'Liebe Grüße\ndeine Redaktion von campus a college';
  const link = Deno.env.get('APP_URL') ? `\n\nÜbersicht deiner Honorarnoten: ${Deno.env.get('APP_URL')}/#/meine` : '';
  switch (n.status) {
    case 'angenommen':
      return {
        betreff: `Honorarnote ${n.nummer} angenommen`,
        text: `${hallo}\n\ndeine Honorarnote ${n.nummer} („${n.titel}“) über ${euro(n.betrag)} wurde angenommen und wird demnächst überwiesen.${link}\n\n${gruss}`,
      };
    case 'abgelehnt':
      return {
        betreff: `Honorarnote ${n.nummer} abgelehnt`,
        text: `${hallo}\n\ndeine Honorarnote ${n.nummer} („${n.titel}“) wurde leider abgelehnt.\n\nBegründung: ${n.ablehnungsgrund ?? ''}\n\nBei Fragen melde dich gerne bei der Redaktion.${link}\n\n${gruss}`,
      };
    case 'bezahlt':
      return {
        betreff: `Honorar ${n.nummer} überwiesen`,
        text: `${hallo}\n\nwir haben am ${datum(n.bezahlt_am)} ${euro(n.betrag)} für deine Honorarnote ${n.nummer} („${n.titel}“) überwiesen.${link}\n\n${gruss}`,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  const payload = await req.json();
  const neu = payload.record as Note | undefined;
  const alt = payload.old_record as Note | undefined;
  if (payload.type !== 'UPDATE' || !neu || neu.status === alt?.status) {
    return new Response('ignoriert', { status: 200 });
  }

  const inhalt = mail(neu);
  if (!inhalt) return new Response('ignoriert', { status: 200 });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('MAIL_FROM'),
      to: [neu.email],
      subject: inhalt.betreff,
      text: inhalt.text,
      html: `<div style="font-family:sans-serif;white-space:pre-wrap">${esc(inhalt.text)}</div>`,
    }),
  });

  if (!res.ok) {
    console.error('Resend-Fehler', res.status, await res.text());
    return new Response('Mailversand fehlgeschlagen', { status: 502 });
  }
  return new Response('gesendet', { status: 200 });
});
