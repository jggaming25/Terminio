// Terminio – zentrale Konfiguration
// Supabase Dashboard -> Project Settings -> API
// Der Publishable/anon Key darf öffentlich sein (Schutz erfolgt über RLS).

export const SUPABASE_URL = 'https://uzofkignqhcktbctoteb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_rwpvxEFbXFOEGpLeAdbX6g_EqTT_oHI';

// Web-Push (VAPID). Der öffentliche Schlüssel darf im Client stehen.
// Der private Schlüssel liegt in supabase/.env.local und wird NUR als
// Supabase-Secret für die Edge Function gesetzt.
export const VAPID_PUBLIC_KEY = 'BJbPrQJa8KDv9T7L27htny2EO3qbZ0-M1IXY9osXoUfOBazw_gmGIuC5flGWUK92b_IsMJBeOpyKbtsDD-JfIvk';

// Optional: eigene Feed-Domain (z. B. https://xyz.supabase.co/functions/v1/ics)
// Leer lassen -> wird automatisch aus SUPABASE_URL gebaut.
export const FEED_BASE_URL = '';

// Optional: Einladungslink zu deinem Discord-Server (wird auf der Login-Seite angezeigt)
export const DISCORD_INVITE = '';
