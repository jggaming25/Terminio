// Terminio – Live-ICS-Abo
// Deploy: supabase functions deploy ics --no-verify-jwt
// URL:    https://<PROJEKT>.supabase.co/functions/v1/ics?token=<FEED_TOKEN>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...cors,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Nur GET erlaubt', 405);

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return text('Token fehlt. Aufruf: /functions/v1/ics?token=DEIN_TOKEN', 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return text('Server ist nicht konfiguriert.', 500);

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('calendar_feed', { p_token: token });

  if (error) {
    console.error('calendar_feed', error);
    return text('Kalender konnte nicht geladen werden.', 500);
  }
  if (!data) return text('Kalender nicht gefunden oder Token ungültig.', 404);

  return new Response(data, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="terminio.ics"',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
});
