// Terminio – Web-Push
// Deploy: supabase functions deploy push-notify
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET, PUBLIC_APP_URL
//
// Supabase Dashboard -> Database -> Webhooks:
//   Table: notifications, Event: INSERT
//   URL: https://<PROJEKT>.supabase.co/functions/v1/push-notify
//   Header: x-webhook-secret: <PUSH_WEBHOOK_SECRET>
//
// Optionaler Direktaufruf (z. B. für Tests):
// { "user_id": "...", "title": "Terminio", "body": "Hallo", "url": "#/requests" }

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const subject = Deno.env.get('VAPID_SUBJECT') || 'https://jggaming25.github.io/Terminio/';
const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
const appUrl = Deno.env.get('PUBLIC_APP_URL') || '/';

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Nur POST erlaubt' }, 405);

  if (!publicKey || !privateKey) {
    return json({ error: 'VAPID-Schlüssel sind nicht gesetzt.' }, 500);
  }

  const provided = req.headers.get('x-webhook-secret')
    || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!webhookSecret || provided !== webhookSecret) {
    return json({ error: 'Nicht autorisiert.' }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch (e) {
    return json({ error: 'Ungültiges JSON.' }, 400);
  }

  let userId: string | null = null;
  let title = 'Terminio';
  let message = '';
  let link = appUrl;
  let tag = 'terminio';

  if (body.type === 'INSERT' && body.table === 'notifications' && body.record) {
    userId = body.record.user_id;
    message = body.record.text || 'Neue Benachrichtigung';
    tag = 'terminio-' + (body.record.id || Date.now());
    if (body.record.event_id) {
      link = appUrl + '#/event/' + body.record.event_id;
    } else if (/befreundet|Freundschaft/i.test(message)) {
      link = appUrl + '#/friends';
    } else {
      link = appUrl + '#/requests';
    }
  } else if (body.user_id) {
    userId = body.user_id;
    title = body.title || title;
    message = body.body || message;
    link = body.url || link;
    tag = body.tag || tag;
  } else {
    return json({ error: 'Kein Empfänger angegeben.' }, 400);
  }

  if (!userId) return json({ error: 'user_id fehlt.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase ist nicht konfiguriert.' }, 500);

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: subs, error } = await sb
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) return json({ error: error.message }, 500);
  if (!subs || !subs.length) return json({ sent: 0, reason: 'Keine Abonnements' });

  const payload = JSON.stringify({
    title,
    body: message || 'Neue Benachrichtigung',
    url: link,
    tag
  });

  let sent = 0;
  const dead: string[] = [];

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 3600, urgency: 'high' }
      );
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub.id);
      else console.error('push error', sub.endpoint, err?.statusCode, err?.body || err?.message);
    }
  }));

  if (dead.length) await sb.from('push_subscriptions').delete().in('id', dead);

  return json({ sent, removed: dead.length, total: subs.length });
});
