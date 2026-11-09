-- =====================================================
-- Terminio v2 – Supabase Schema & Migration
-- Im Supabase Dashboard: SQL Editor -> New query -> Inhalt einfügen -> Run
-- Das Skript ist idempotent und kann auch auf ein bestehendes Terminio-Projekt
-- angewendet werden.
-- =====================================================

create extension if not exists pgcrypto;

-- pg_cron ist auf Supabase verfügbar, kann aber je nach Projekt deaktiviert sein.
-- Fehler beim Aktivieren dürfen das restliche Schema nicht blockieren.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron konnte nicht aktiviert werden: %', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------
-- 1. Tabellen
-- -----------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null check (username ~ '^[a-z0-9_-]{3,30}$'),
  display_name  text not null,
  color         text not null default '#6366f1',
  share_enabled boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Neue Spalten für Discord, Freunde, Admin, Sicherheit & Einstellungen
alter table public.profiles add column if not exists discord_id      text;
alter table public.profiles add column if not exists avatar_url      text;
alter table public.profiles add column if not exists friends_can_view boolean not null default true;
alter table public.profiles add column if not exists is_admin        boolean not null default false;
alter table public.profiles add column if not exists status          text not null default 'active';
alter table public.profiles add column if not exists status_reason   text;
alter table public.profiles add column if not exists feed_token      uuid;
alter table public.profiles add column if not exists theme           text not null default 'system';
alter table public.profiles add column if not exists sound_enabled   boolean not null default true;
alter table public.profiles add column if not exists updated_at      timestamptz not null default now();

update public.profiles set feed_token = gen_random_uuid() where feed_token is null;
alter table public.profiles alter column feed_token set default gen_random_uuid();
alter table public.profiles alter column feed_token set not null;

create unique index if not exists profiles_feed_token_idx  on public.profiles(feed_token);
create unique index if not exists profiles_discord_idx     on public.profiles(discord_id) where discord_id is not null;
create index        if not exists profiles_status_idx      on public.profiles(status);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_status_chk') then
    alter table public.profiles add constraint profiles_status_chk
      check (status in ('active','disabled','banned'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_theme_chk') then
    alter table public.profiles add constraint profiles_theme_chk
      check (theme in ('system','light','dark'));
  end if;
end $$;

-- Termine inkl. Serien-Wiederholung
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  created_at  timestamptz not null default now(),
  check (end_at > start_at)
);

alter table public.events add column if not exists recurrence          text not null default 'none';
alter table public.events add column if not exists recurrence_interval integer not null default 1;
alter table public.events add column if not exists recurrence_until    timestamptz;
alter table public.events add column if not exists timezone            text not null default 'Europe/Berlin';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_recurrence_chk') then
    alter table public.events add constraint events_recurrence_chk
      check (recurrence in ('none','daily','weekly','monthly','yearly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_recurrence_interval_chk') then
    alter table public.events add constraint events_recurrence_interval_chk
      check (recurrence_interval between 1 and 52);
  end if;
end $$;

-- Teilnehmer + eigener Status + Privat-Schalter
create table if not exists public.event_participants (
  event_id     uuid not null references public.events(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  reason       text,
  is_private   boolean not null default false,
  responded_at timestamptz,
  primary key (event_id, user_id)
);

-- Migration für bestehende Terminio-Datenbanken
alter table public.event_participants add column if not exists is_private   boolean not null default false;
alter table public.event_participants add column if not exists responded_at timestamptz;

-- Freundschaften
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester    uuid not null references public.profiles(id) on delete cascade,
  addressee    uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','blocked')),
  message      text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester <> addressee)
);

create unique index if not exists friendships_pair_uidx
  on public.friendships (least(requester, addressee), greatest(requester, addressee))
  where status <> 'declined';
create index if not exists friendships_requester_idx on public.friendships(requester);
create index if not exists friendships_addressee_idx on public.friendships(addressee);

-- Wer hat blockiert? (nur diese Person darf die Blockierung aufheben)
alter table public.friendships add column if not exists blocked_by uuid references public.profiles(id) on delete set null;

-- Benachrichtigungen
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid references public.events(id) on delete cascade,
  text       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Web-Push-Abonnements
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ep_user   on public.event_participants(user_id);
create index if not exists idx_ev_start  on public.events(start_at);
create index if not exists idx_nt_user   on public.notifications(user_id, created_at desc);
create index if not exists idx_push_user on public.push_subscriptions(user_id);

-- -----------------------------------------------------
-- 2. Hilfsfunktionen (security definer = keine RLS-Rekursion)
-- -----------------------------------------------------

create or replace function public.is_active()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select status = 'active' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from public.profiles
                    where id = auth.uid() and status = 'active'), false);
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

create or replace function public.is_event_member(eid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.event_participants where event_id = eid and user_id = auth.uid());
$$;

create or replace function public.is_event_creator(eid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.events where id = eid and created_by = auth.uid());
$$;

-- -----------------------------------------------------
-- 3. Trigger
-- -----------------------------------------------------

-- Profil automatisch bei Discord-Registrierung anlegen
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base  text;
  uname text;
  dname text;
  av    text;
  disc  text;
  n     int := 0;
begin
  base := lower(coalesce(
    meta->>'user_name',
    meta->>'preferred_username',
    meta->>'name',
    split_part(coalesce(new.email, ''), '@', 1),
    'user'
  ));
  base := regexp_replace(base, '[^a-z0-9_-]', '', 'g');
  base := trim(both '-' from base);
  if char_length(base) < 3 then base := 'user'; end if;
  base := left(base, 24);

  uname := base;
  while exists (select 1 from public.profiles where username = uname) loop
    n := n + 1;
    uname := left(base, 24) || '-' || substr(replace(new.id::text, '-', ''), 1, 4)
             || case when n > 1 then n::text else '' end;
  end loop;

  dname := coalesce(
    nullif(meta->>'full_name', ''),
    nullif(meta->>'global_name', ''),
    nullif(meta->>'name', ''),
    nullif(meta->>'user_name', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Discord-Nutzer'
  );
  av   := nullif(meta->>'avatar_url', '');
  disc := nullif(meta->>'provider_id', '');

  insert into public.profiles (id, username, display_name, avatar_url, discord_id)
  values (new.id, uname, left(dname, 60), av, disc)
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profil-Selbstbearbeitung absichern (Admin/Status/Token dürfen nicht per Client geändert werden)
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('terminio.internal', true), '') = 'on' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.is_admin        is distinct from old.is_admin
     or new.status       is distinct from old.status
     or new.status_reason is distinct from old.status_reason
     or new.feed_token   is distinct from old.feed_token
     or new.discord_id   is distinct from old.discord_id
     or new.username     is distinct from old.username
     or new.created_at   is distinct from old.created_at then
    raise exception 'Dieses Profilfeld darf nicht geändert werden';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Teilnehmer-Schlüssel unveränderlich
create or replace function public.lock_participant_keys()
returns trigger language plpgsql as $$
begin
  if new.event_id <> old.event_id or new.user_id <> old.user_id then
    raise exception 'event_id/user_id dürfen nicht geändert werden';
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_keys on public.event_participants;
create trigger trg_lock_keys before update on public.event_participants
  for each row execute function public.lock_participant_keys();

-- Freundschafts-Schlüssel unveränderlich + nur Empfänger darf annehmen
create or replace function public.lock_friendship_keys()
returns trigger language plpgsql as $$
begin
  if new.requester <> old.requester or new.addressee <> old.addressee then
    raise exception 'Freundschaftspartner dürfen nicht geändert werden';
  end if;
  if old.status = 'pending' and new.status = 'accepted' and auth.uid() <> old.addressee then
    raise exception 'Nur der Empfänger kann eine Freundschaftsanfrage annehmen';
  end if;
  if new.status = 'blocked' and old.status <> 'blocked' then
    new.blocked_by := auth.uid();
  end if;
  if old.status = 'blocked' and new.status <> 'blocked'
     and old.blocked_by is not null and auth.uid() <> old.blocked_by then
    raise exception 'Nur die blockierende Person kann die Blockierung aufheben';
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_friendship on public.friendships;
create trigger trg_lock_friendship before update on public.friendships
  for each row execute function public.lock_friendship_keys();

-- Benachrichtigungen bei Einladungen / Antworten
create or replace function public.notify_participant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev events;
  creator profiles;
  who profiles;
begin
  select * into ev from public.events where id = new.event_id;
  if not found then return new; end if;

  if tg_op = 'INSERT' then
    if new.user_id <> ev.created_by then
      select * into creator from public.profiles where id = ev.created_by;
      insert into public.notifications (user_id, event_id, text)
      values (new.user_id, new.event_id,
        coalesce(creator.display_name, 'Jemand') || ' hat dich zu „' || ev.title || '“ eingeladen'
        || case when ev.recurrence <> 'none' then ' (Serientermin)' else '' end);
    end if;
  elsif tg_op = 'UPDATE' and new.status <> old.status and new.user_id <> ev.created_by then
    select * into who from public.profiles where id = new.user_id;
    insert into public.notifications (user_id, event_id, text)
    values (ev.created_by, new.event_id,
      coalesce(who.display_name, 'Jemand') || case new.status
        when 'accepted' then ' hat „' || ev.title || '“ angenommen'
        when 'declined' then ' hat „' || ev.title || '“ abgelehnt'
        else ' hat den Status von „' || ev.title || '“ zurückgesetzt' end);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_ins on public.event_participants;
drop trigger if exists trg_notify_upd on public.event_participants;
create trigger trg_notify_ins after insert on public.event_participants
  for each row execute function public.notify_participant();
create trigger trg_notify_upd after update on public.event_participants
  for each row execute function public.notify_participant();

-- Benachrichtigungen für Freundschaftsanfragen
create or replace function public.notify_friendship()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req profiles;
  addr profiles;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select * into req from public.profiles where id = new.requester;
    insert into public.notifications (user_id, text)
    values (new.addressee, coalesce(req.display_name, 'Jemand') || ' möchte mit dir befreundet sein');
  elsif tg_op = 'UPDATE' and new.status <> old.status and old.status = 'pending' then
    if new.status = 'accepted' then
      select * into addr from public.profiles where id = new.addressee;
      insert into public.notifications (user_id, text)
      values (new.requester, coalesce(addr.display_name, 'Jemand') || ' hat deine Freundschaftsanfrage angenommen');
    elsif new.status = 'declined' then
      select * into addr from public.profiles where id = new.addressee;
      insert into public.notifications (user_id, text)
      values (new.requester, coalesce(addr.display_name, 'Jemand') || ' hat deine Freundschaftsanfrage abgelehnt');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_friendship_ins on public.friendships;
drop trigger if exists trg_notify_friendship_upd on public.friendships;
create trigger trg_notify_friendship_ins after insert on public.friendships
  for each row execute function public.notify_friendship();
create trigger trg_notify_friendship_upd after update on public.friendships
  for each row execute function public.notify_friendship();

-- -----------------------------------------------------
-- 4. RPCs
-- -----------------------------------------------------

-- Öffentlicher Kalender (ohne Login, private Termine maskiert, 14 Tage Rückblick)
create or replace function public.public_calendar(p_username text)
returns json language plpgsql security definer stable set search_path = public as $$
declare p profiles; res json;
begin
  select * into p from public.profiles
   where username = lower(p_username) and status = 'active';
  if not found or not p.share_enabled then return null; end if;

  select json_build_object(
    'profile', json_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name,
      'color', p.color, 'avatar_url', p.avatar_url),
    'events', coalesce((
      select json_agg(json_build_object(
        'id', e.id,
        'title', case when ep.is_private then 'Belegt' else e.title end,
        'description', case when ep.is_private then '' else e.description end,
        'start_at', e.start_at,
        'end_at', e.end_at,
        'recurrence', e.recurrence,
        'recurrence_interval', e.recurrence_interval,
        'recurrence_until', e.recurrence_until,
        'is_private', ep.is_private) order by e.start_at)
      from public.event_participants ep
      join public.events e on e.id = ep.event_id
      where ep.user_id = p.id and ep.status = 'accepted'
        and (case when e.recurrence = 'none'
                  then e.end_at > now() - interval '14 days'
                  else e.recurrence_until is null
                       or e.recurrence_until > now() - interval '14 days' end)
    ), '[]'::json)
  ) into res;
  return res;
end $$;
grant execute on function public.public_calendar(text) to anon, authenticated;

-- Freundeskalender: nur akzeptierte Freunde, nur wenn freigegeben, private maskiert
create or replace function public.friend_calendar(p_friend uuid)
returns json language plpgsql security definer stable set search_path = public as $$
declare
  p profiles;
  me uuid := auth.uid();
  prof json;
begin
  if me is null or not public.is_active() then return null; end if;

  select * into p from public.profiles where id = p_friend and status = 'active';
  if not found then return null; end if;
  if not public.are_friends(me, p_friend) then return null; end if;

  prof := json_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'color', p.color, 'avatar_url', p.avatar_url);

  if not p.friends_can_view then
    return json_build_object('allowed', false, 'profile', prof, 'events', '[]'::json);
  end if;

  return json_build_object(
    'allowed', true,
    'profile', prof,
    'events', coalesce((
      select json_agg(json_build_object(
        'id', e.id,
        'title', case when ep.is_private then 'Belegt' else e.title end,
        'description', case when ep.is_private then '' else e.description end,
        'start_at', e.start_at,
        'end_at', e.end_at,
        'recurrence', e.recurrence,
        'recurrence_interval', e.recurrence_interval,
        'recurrence_until', e.recurrence_until,
        'is_private', ep.is_private) order by e.start_at)
      from public.event_participants ep
      join public.events e on e.id = ep.event_id
      where ep.user_id = p.id and ep.status = 'accepted'
        and (case when e.recurrence = 'none'
                  then e.end_at > now() - interval '14 days'
                  else e.recurrence_until is null
                       or e.recurrence_until > now() - interval '14 days' end)
    ), '[]'::json)
  );
end $$;
grant execute on function public.friend_calendar(uuid) to authenticated;

-- ICS-Hilfsfunktionen
create or replace function public.ics_escape(p text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(
    coalesce(p, ''),
    E'\\', E'\\\\'),
    E'\r\n', E'\\n'),
    E'\n', E'\\n'),
    ',', E'\\,'),
    ';', E'\\;');
$$;

create or replace function public.ics_dt(p_ts timestamptz)
returns text language sql immutable as $$
  select to_char(p_ts at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"');
$$;

-- Live-Abo: tokenisierter ICS-Feed
create or replace function public.calendar_feed(p_token uuid)
returns text language plpgsql security definer stable set search_path = public as $$
declare
  p profiles;
  ev record;
  res text;
  rrule text;
begin
  select * into p from public.profiles where feed_token = p_token and status = 'active';
  if not found then return null; end if;

  res := 'BEGIN:VCALENDAR' || E'\r\n'
      || 'VERSION:2.0' || E'\r\n'
      || 'PRODID:-//Terminio//DE' || E'\r\n'
      || 'CALSCALE:GREGORIAN' || E'\r\n'
      || 'METHOD:PUBLISH' || E'\r\n'
      || 'X-WR-CALNAME:' || public.ics_escape('Terminio – ' || p.display_name) || E'\r\n'
      || 'X-WR-TIMEZONE:Europe/Berlin' || E'\r\n';

  for ev in
    select e.*, ep.is_private
    from public.event_participants ep
    join public.events e on e.id = ep.event_id
    where ep.user_id = p.id and ep.status = 'accepted'
      and (case when e.recurrence = 'none'
                then e.end_at > now() - interval '14 days'
                else e.recurrence_until is null
                     or e.recurrence_until > now() - interval '14 days' end)
    order by e.start_at
  loop
    rrule := case ev.recurrence
      when 'daily'   then 'FREQ=DAILY;INTERVAL='   || ev.recurrence_interval
      when 'weekly'  then 'FREQ=WEEKLY;INTERVAL='  || ev.recurrence_interval
      when 'monthly' then 'FREQ=MONTHLY;INTERVAL=' || ev.recurrence_interval
      when 'yearly'  then 'FREQ=YEARLY;INTERVAL='  || ev.recurrence_interval
      else null end;
    if rrule is not null and ev.recurrence_until is not null then
      rrule := rrule || ';UNTIL=' || public.ics_dt(ev.recurrence_until);
    end if;

    res := res || 'BEGIN:VEVENT' || E'\r\n'
        || 'UID:' || ev.id || '@terminio' || E'\r\n'
        || 'DTSTAMP:' || public.ics_dt(now()) || E'\r\n'
        || 'DTSTART:' || public.ics_dt(ev.start_at) || E'\r\n'
        || 'DTEND:' || public.ics_dt(ev.end_at) || E'\r\n'
        || 'SUMMARY:' || public.ics_escape(ev.title) || E'\r\n'
        || 'DESCRIPTION:' || public.ics_escape(ev.description) || E'\r\n';
    if rrule is not null then
      res := res || 'RRULE:' || rrule || E'\r\n';
    end if;
    res := res || 'END:VEVENT' || E'\r\n';
  end loop;

  return res || 'END:VCALENDAR' || E'\r\n';
end $$;
grant execute on function public.calendar_feed(uuid) to anon, authenticated;

-- Feed-Token zurücksetzen
create or replace function public.reset_feed_token()
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not public.is_active() then raise exception 'Account ist nicht aktiv'; end if;
  perform set_config('terminio.internal', 'on', true);
  update public.profiles set feed_token = gen_random_uuid()
   where id = auth.uid() returning feed_token into t;
  return t;
end $$;
grant execute on function public.reset_feed_token() to authenticated;

-- Aufräumen: alles, was mehr als 14 Tage zurückliegt
create or replace function public.cleanup_old_events()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  with del as (
    delete from public.events e
    where (e.recurrence = 'none' and e.end_at < now() - interval '14 days')
       or (e.recurrence <> 'none'
           and e.recurrence_until is not null
           and e.recurrence_until < now() - interval '14 days')
    returning 1
  )
  select count(*) into n from del;

  delete from public.notifications where created_at < now() - interval '60 days';
  return n;
end $$;
revoke all on function public.cleanup_old_events() from public;

-- Admin: Nutzerliste
create or replace function public.admin_list_users()
returns json language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Keine Admin-Rechte'; end if;
  return coalesce((
    select json_agg(row_to_json(x) order by x.created_at desc)
    from (
      select p.id, p.username, p.display_name, p.avatar_url, p.color,
             p.status, p.status_reason, p.is_admin, p.created_at,
             (select count(*) from public.events e where e.created_by = p.id) as event_count,
             (select count(*) from public.friendships f
                where f.status = 'accepted'
                  and (f.requester = p.id or f.addressee = p.id)) as friend_count
      from public.profiles p
    ) x
  ), '[]'::json);
end $$;
grant execute on function public.admin_list_users() to authenticated;

-- Admin: Account deaktivieren / sperren / reaktivieren
create or replace function public.admin_set_status(p_user uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare who profiles;
begin
  if not public.is_admin() then raise exception 'Keine Admin-Rechte'; end if;
  if p_status not in ('active','disabled','banned') then raise exception 'Ungültiger Status'; end if;
  if p_user = auth.uid() then raise exception 'Der eigene Account kann nicht geändert werden'; end if;

  select * into who from public.profiles where id = p_user;
  if not found then raise exception 'Nutzer nicht gefunden'; end if;

  update public.profiles
     set status = p_status,
         status_reason = case when p_status = 'active' then null else nullif(p_reason, '') end,
         updated_at = now()
   where id = p_user;

  insert into public.notifications (user_id, text)
  values (p_user, case p_status
    when 'disabled' then 'Dein Account wurde vom Admin deaktiviert.'
    when 'banned'   then 'Dein Account wurde vom Admin gesperrt.'
    else 'Dein Account wurde vom Admin wieder freigeschaltet.' end);
end $$;
grant execute on function public.admin_set_status(uuid, text, text) to authenticated;

-- Admin: Adminrechte vergeben/entziehen
create or replace function public.admin_set_admin(p_user uuid, p_flag boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Keine Admin-Rechte'; end if;
  if p_user = auth.uid() then raise exception 'Eigene Adminrechte können hier nicht geändert werden'; end if;
  update public.profiles set is_admin = p_flag, updated_at = now() where id = p_user;
end $$;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;

-- Profil sicherstellen (falls Trigger bei OAuth minimal verzögert)
create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if found then return p; end if;
  raise exception 'Profil wird noch angelegt – bitte in wenigen Sekunden erneut versuchen';
end $$;
grant execute on function public.ensure_profile() to authenticated;

-- Eigenes vollständiges Profil (inkl. feed_token/theme/discord_id).
-- Die Tabelle selbst gibt für andere Nutzer nur unkritische Spalten frei.
create or replace function public.my_profile()
returns public.profiles language sql security definer stable set search_path = public as $$
  select * from public.profiles where id = auth.uid();
$$;
grant execute on function public.my_profile() to authenticated;

-- -----------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.events              enable row level security;
alter table public.event_participants  enable row level security;
alter table public.friendships         enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_subscriptions  enable row level security;

-- profiles
drop policy if exists "profiles_read"   on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or status = 'active');
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active())
  with check (id = auth.uid() and public.is_active());

-- events
drop policy if exists "events_read"   on public.events;
drop policy if exists "events_insert" on public.events;
drop policy if exists "events_update" on public.events;
drop policy if exists "events_delete" on public.events;
create policy "events_read" on public.events for select to authenticated
  using (public.is_active() and (created_by = auth.uid() or public.is_event_member(id)));
create policy "events_insert" on public.events for insert to authenticated
  with check (public.is_active() and created_by = auth.uid());
create policy "events_update" on public.events for update to authenticated
  using (public.is_active() and created_by = auth.uid())
  with check (created_by = auth.uid());
create policy "events_delete" on public.events for delete to authenticated
  using (public.is_active() and created_by = auth.uid());

-- event_participants
drop policy if exists "ep_read"   on public.event_participants;
drop policy if exists "ep_insert" on public.event_participants;
drop policy if exists "ep_update" on public.event_participants;
drop policy if exists "ep_delete" on public.event_participants;
create policy "ep_read" on public.event_participants for select to authenticated
  using (public.is_active() and (user_id = auth.uid() or public.is_event_member(event_id) or public.is_event_creator(event_id)));
create policy "ep_insert" on public.event_participants for insert to authenticated
  with check (public.is_active() and public.is_event_creator(event_id));
create policy "ep_update" on public.event_participants for update to authenticated
  using (public.is_active() and user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "ep_delete" on public.event_participants for delete to authenticated
  using (public.is_active() and (public.is_event_creator(event_id) or user_id = auth.uid()));

-- friendships
drop policy if exists "friendships_read"   on public.friendships;
drop policy if exists "friendships_insert" on public.friendships;
drop policy if exists "friendships_update" on public.friendships;
drop policy if exists "friendships_delete" on public.friendships;
create policy "friendships_read" on public.friendships for select to authenticated
  using (public.is_active() and (requester = auth.uid() or addressee = auth.uid() or public.is_admin()));
create policy "friendships_insert" on public.friendships for insert to authenticated
  with check (public.is_active() and requester = auth.uid() and status = 'pending');
create policy "friendships_update" on public.friendships for update to authenticated
  using (
    public.is_active() and (
      (status <> 'blocked' and (requester = auth.uid() or addressee = auth.uid()))
      or (status = 'blocked' and blocked_by = auth.uid())
    )
  )
  with check (requester = auth.uid() or addressee = auth.uid());
create policy "friendships_delete" on public.friendships for delete to authenticated
  using (
    public.is_active() and (
      (status <> 'blocked' and (requester = auth.uid() or addressee = auth.uid()))
      or (status = 'blocked' and blocked_by = auth.uid())
    )
  );

-- notifications
drop policy if exists "nt_read"   on public.notifications;
drop policy if exists "nt_update" on public.notifications;
drop policy if exists "nt_delete" on public.notifications;
create policy "nt_read" on public.notifications for select to authenticated
  using (public.is_active() and user_id = auth.uid());
create policy "nt_update" on public.notifications for update to authenticated
  using (public.is_active() and user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "nt_delete" on public.notifications for delete to authenticated
  using (public.is_active() and user_id = auth.uid());

-- push_subscriptions
drop policy if exists "push_read"   on public.push_subscriptions;
drop policy if exists "push_insert" on public.push_subscriptions;
drop policy if exists "push_update" on public.push_subscriptions;
drop policy if exists "push_delete" on public.push_subscriptions;
create policy "push_read" on public.push_subscriptions for select to authenticated
  using (public.is_active() and user_id = auth.uid());
create policy "push_insert" on public.push_subscriptions for insert to authenticated
  with check (public.is_active() and user_id = auth.uid());
create policy "push_update" on public.push_subscriptions for update to authenticated
  using (public.is_active() and user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "push_delete" on public.push_subscriptions for delete to authenticated
  using (public.is_active() and user_id = auth.uid());

-- Spaltenrechte: feed_token, discord_id, theme, sound_enabled usw. dürfen
-- nicht über die öffentliche Tabelle abrufbar sein. Das eigene Profil inkl.
-- Token liefert die RPC my_profile().
revoke select on public.profiles from anon, authenticated;
grant select (id, username, display_name, color, avatar_url, share_enabled,
              friends_can_view, status, is_admin, created_at)
  on public.profiles to authenticated;

-- -----------------------------------------------------
-- 6. Realtime (optional, für Live-Aktualisierung)
-- -----------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when others then null;
    end;
    begin
      alter publication supabase_realtime add table public.friendships;
    exception when others then null;
    end;
  end if;
end $$;

-- -----------------------------------------------------
-- 7. Automatische Löschung nach 14 Tagen (pg_cron)
-- -----------------------------------------------------

do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'terminio-cleanup') then
      perform cron.unschedule('terminio-cleanup');
    end if;
    perform cron.schedule(
      'terminio-cleanup',
      '15 3 * * *',
      'select public.cleanup_old_events();'
    );
  end if;
end $$;

-- -----------------------------------------------------
-- 8. Erster Admin
-- Nach dem ersten Discord-Login einmal ausführen:
--   update public.profiles set is_admin = true where username = 'DEIN_NAME';
-- -----------------------------------------------------
