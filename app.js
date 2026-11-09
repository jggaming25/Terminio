import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, FEED_BASE_URL, DISCORD_INVITE } from './config.js';

/* =====================================================================
   Terminio v2
   - Login ausschließlich per Discord
   - Serientermine, Freundeskalender, Live-ICS-Abo
   - Desktop- & Push-Benachrichtigungen, PWA
   - Admin-Menü, 14-Tage-Aufbewahrung
   ===================================================================== */

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce'
  }
});

const app = document.getElementById('app');

/* ================= State ================= */
const S = {
  user: null,
  me: null,
  profiles: [],
  events: [],
  friendships: [],
  notifs: [],
  notifSeen: null,
  cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  tab: 'in',
  poll: null,
  swReg: null,
  soundEnabled: true,
  pushEnabled: false
};

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DAYS = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const STATUS = { pending: 'Offen', accepted: 'Zugesagt', declined: 'Abgelehnt' };
const USER_STATUS = { active: 'Aktiv', disabled: 'Deaktiviert', banned: 'Gesperrt' };
const RECUR = { none: 'Einmalig', daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich', yearly: 'Jährlich' };
const THEME_KEY = 'terminio-theme';
const RETENTION_DAYS = 14;

/* ================= Basics ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = d => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDate = d => new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const fmtShort = d => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
const fmtDateTime = d => new Date(d).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const som = d => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const P = id => S.profiles.find(p => p.id === id);
const initials = n => (n || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
const pubLink = u => `${location.origin}${location.pathname}#/u/${u}`;
const friendLink = id => `${location.origin}${location.pathname}#/f/${id}`;

function avatar(p) {
  const color = esc(p?.color || '#6366f1');
  if (p?.avatar_url) {
    return `<span class="avatar has-img" style="--c:${color}"><img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
  }
  return `<span class="avatar" style="--c:${color}">${esc(initials(p?.display_name))}</span>`;
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3600);
}

/* ================= Theme (System / Hell / Dunkel) ================= */
const darkMedia = matchMedia('(prefers-color-scheme: dark)');
function themePref() {
  try {
    let p = localStorage.getItem(THEME_KEY);
    if (!p) {
      p = localStorage.getItem('theme');
      if (p) localStorage.setItem(THEME_KEY, p);
    }
    return p || 'system';
  } catch (e) { return 'system'; }
}
function isDark() {
  const p = themePref();
  return p === 'dark' || (p === 'system' && darkMedia.matches);
}
function applyTheme() {
  const p = themePref();
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = p;
  const meta = document.getElementById('meta-theme');
  if (meta) meta.setAttribute('content', dark ? '#0a0c18' : '#6366f1');
  $$('.theme-label').forEach(el => { el.textContent = p === 'system' ? 'System' : p === 'dark' ? 'Dunkel' : 'Hell'; });
  $$('[data-theme-choice]').forEach(b => b.classList.toggle('on', b.dataset.themeChoice === p));
  const toggle = document.getElementById('theme');
  if (toggle) toggle.textContent = p === 'system' ? '🖥️' : p === 'dark' ? '🌙' : '☀️';
}
darkMedia.addEventListener?.('change', () => { if (themePref() === 'system') applyTheme(); });
function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
  applyTheme();
  if (S.user) sb.from('profiles').update({ theme: pref }).eq('id', S.user.id).then(() => {});
}
function themeIcon() {
  const p = themePref();
  return p === 'system' ? '🖥️' : p === 'dark' ? '🌙' : '☀️';
}
function openTheme() {
  const m = openModal(`
    <h3>Design</h3>
    <p class="muted" style="margin-bottom:16px">Standardmäßig folgt Terminio deiner Systemeinstellung.</p>
    <div class="seg big" role="group" aria-label="Design wählen">
      <button data-theme-choice="system">🖥️ System</button>
      <button data-theme-choice="light">☀️ Hell</button>
      <button data-theme-choice="dark">🌙 Dunkel</button>
    </div>
    <p class="hint" style="margin-top:14px">Die Auswahl wird auf diesem Gerät gespeichert.</p>`);
  applyTheme();
  $$('[data-theme-choice]', m).forEach(b => b.onclick = () => {
    setTheme(b.dataset.themeChoice);
    applyTheme();
    const old = $('#theme');
    if (old) old.textContent = themeIcon();
  });
}

/* ================= Klick-Sounds (WebAudio, keine Dateien) ================= */
let audioCtx = null;
function playSfx(kind = 'click') {
  if (!S.soundEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const map = {
      click:   [620, 0.045, 0.10],
      success: [780, 0.09, 0.13],
      pop:     [880, 0.05, 0.09],
      error:   [220, 0.14, 0.16]
    };
    const [freq, dur, vol] = map[kind] || map.click;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = kind === 'error' ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * (kind === 'error' ? 0.7 : 1.35), now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.02);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  } catch (e) {}
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-sfx],.btn,.icon,.chip,.person,.tabs button,.seg button,.friend-card [data-act]');
  if (!el || el.dataset.sfx === 'none') return;
  playSfx(el.dataset.sfx || 'click');
}, true);

/* ================= Modal ================= */
function openModal(html, wide, onClose) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="x" aria-label="Schließen">✕</button>${html}</div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  back.close = () => {
    if (back._closed) return;
    back._closed = true;
    back.classList.remove('show');
    setTimeout(() => back.remove(), 220);
    if (onClose) onClose();
  };
  back.addEventListener('mousedown', e => { if (e.target === back) back.close(); });
  $('.x', back).onclick = back.close;
  return back;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = $$('.modal-back').pop();
    if (m) m.close();
    else {
      const p = $('.theme-pop');
      if (p) p.remove();
    }
  }
});

function confirmDialog({ title = 'Bestätigen', text = '', ok = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal(`
      <h3>${esc(title)}</h3>
      <p class="muted" style="margin:0 0 18px;white-space:pre-wrap">${esc(text)}</p>
      <div class="mrow">
        <button class="btn ${danger ? 'danger' : ''}" id="yes">${esc(ok)}</button>
        <button class="ghost" id="no">Abbrechen</button>
      </div>`, false, () => finish(false));
    $('#yes', m).onclick = () => { finish(true); m.close(); };
    $('#no', m).onclick = () => m.close();
  });
}

/* ================= Serien-Helfer ================= */
function addInterval(base, recurrence, steps) {
  const d = new Date(base);
  if (recurrence === 'daily') { d.setDate(d.getDate() + steps); return d; }
  if (recurrence === 'weekly') { d.setDate(d.getDate() + 7 * steps); return d; }
  if (recurrence === 'monthly' || recurrence === 'yearly') {
    const day = d.getDate();
    d.setDate(1);
    if (recurrence === 'monthly') d.setMonth(d.getMonth() + steps);
    else d.setFullYear(d.getFullYear() + steps);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
    return d;
  }
  return d;
}

function occurrences(ev, from, to) {
  const out = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const baseStart = new Date(ev.start_at);
  const baseEnd = new Date(ev.end_at);
  const dur = Math.max(0, baseEnd - baseStart);
  const rec = ev.recurrence || 'none';
  const until = ev.recurrence_until ? new Date(ev.recurrence_until) : null;
  const untilMs = until
    ? new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59, 999).getTime()
    : null;

  const push = (s, e) => {
    if (e.getTime() > fromMs && s.getTime() < toMs) {
      out.push({
        ...ev,
        occStart: s.toISOString(),
        occEnd: e.toISOString(),
        start_at: s.toISOString(),
        end_at: e.toISOString(),
        occKey: ev.id + ':' + s.toISOString()
      });
    }
  };

  if (rec === 'none') { push(baseStart, baseEnd); return out; }

  const interval = Math.max(1, ev.recurrence_interval || 1);
  let i = 0;
  if (rec === 'daily' || rec === 'weekly') {
    const stepMs = (rec === 'daily' ? 864e5 : 7 * 864e5) * interval;
    const diff = Math.floor((fromMs - baseStart.getTime()) / stepMs);
    if (diff > 1) i = diff - 1;
  }

  let guard = 0;
  while (guard++ < 5000) {
    const s = addInterval(baseStart, rec, i * interval);
    if (s.getTime() > toMs) break;
    if (untilMs !== null && s.getTime() > untilMs) break;
    push(s, new Date(s.getTime() + dur));
    i++;
  }
  return out;
}

function recurrenceText(ev) {
  if (!ev.recurrence || ev.recurrence === 'none') return '';
  const n = ev.recurrence_interval || 1;
  let s = ev.recurrence === 'daily' ? (n === 1 ? 'Täglich' : `Alle ${n} Tage`)
    : ev.recurrence === 'weekly' ? (n === 1 ? 'Wöchentlich' : `Alle ${n} Wochen`)
    : ev.recurrence === 'monthly' ? (n === 1 ? 'Monatlich' : `Alle ${n} Monate`)
    : (n === 1 ? 'Jährlich' : `Alle ${n} Jahre`);
  if (ev.recurrence_until) s += ` bis ${new Date(ev.recurrence_until).toLocaleDateString('de-DE')}`;
  return s;
}

function occurrenceAt(ev, iso) {
  const s = new Date(iso || ev.start_at);
  const dur = Math.max(0, new Date(ev.end_at) - new Date(ev.start_at));
  return {
    ...ev,
    occStart: s.toISOString(),
    occEnd: new Date(s.getTime() + dur).toISOString(),
    start_at: s.toISOString(),
    end_at: new Date(s.getTime() + dur).toISOString()
  };
}

function calendarRange(cursor) {
  const off = (cursor.getDay() + 6) % 7;
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - off);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
  return { start, end };
}

/* ================= ICS / Export / Live-Abo ================= */
const icsDate = d => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, '');
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
function rruleFor(ev) {
  if (!ev.recurrence || ev.recurrence === 'none') return null;
  const map = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
  let r = `FREQ=${map[ev.recurrence] || 'WEEKLY'};INTERVAL=${ev.recurrence_interval || 1}`;
  if (ev.recurrence_until) r += ';UNTIL=' + icsDate(ev.recurrence_until);
  return r;
}
function buildICS(list) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terminio//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Terminio'];
  list.forEach(e => {
    L.push('BEGIN:VEVENT', `UID:${e.id}@terminio`, `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(e.start_at)}`, `DTEND:${icsDate(e.end_at)}`, `SUMMARY:${icsEsc(e.title)}`,
      `DESCRIPTION:${icsEsc(e.description)}`);
    const rr = rruleFor(e);
    if (rr) L.push('RRULE:' + rr);
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const googleLink = e => `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${icsDate(e.start_at)}/${icsDate(e.end_at)}&details=${encodeURIComponent(e.description || '')}`;
function exportAll() {
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  const list = S.events.filter(e => {
    if (!e.mine || e.mine.status !== 'accepted') return false;
    if (e.recurrence && e.recurrence !== 'none') {
      return !e.recurrence_until || new Date(e.recurrence_until).getTime() >= cutoff;
    }
    return new Date(e.end_at).getTime() >= cutoff;
  });
  if (!list.length) return toast('Keine zugesagten Termine zum Exportieren', 'err');
  download('terminio-kalender.ics', buildICS(list));
  toast('.ics heruntergeladen ✓');
  playSfx('success');
}
function feedUrl() {
  if (!S.me?.feed_token) return '';
  const base = FEED_BASE_URL || `${SUPABASE_URL}/functions/v1/ics`;
  return `${base}?token=${S.me.feed_token}`;
}
function openFeed() {
  const url = feedUrl();
  const webcal = url.replace(/^https?:\/\//, 'webcal://');
  const m = openModal(`
    <h3>📡 Live-Abo</h3>
    <p class="muted">Abonniere deinen Terminio-Kalender einmal in Apple Kalender, Google Kalender, Outlook oder Thunderbird. Neue und geänderte Termine landen automatisch dort.</p>
    <div class="label" style="margin-top:14px">Deine Abo-URL</div>
    <div class="linkbox"><input readonly value="${esc(url)}" id="feed-url"><button class="ghost" id="feed-copy">Kopieren</button></div>
    <div class="mrow">
      <a class="ghost sm" href="${esc(webcal)}">Apple Kalender öffnen</a>
      <a class="ghost sm" href="${esc(url)}" target="_blank" rel="noopener">Feed testen</a>
      <button class="ghost sm" id="feed-reset">Token erneuern</button>
    </div>
    <div class="notice" style="margin-top:16px">
      <b>So geht's:</b> In Google Kalender → „Weitere Kalender“ → „Per URL hinzufügen“ die obige HTTPS-URL einfügen.
      In Apple Kalender → „Ablage“ → „Neues Kalender-Abo“. Die URL enthält ein geheimes Token – bitte nicht öffentlich teilen.
    </div>`, true);
  $('#feed-copy', m).onclick = () => copy(url);
  $('#feed-url', m).onclick = e => e.target.select();
  $('#feed-reset', m).onclick = async () => {
    const ok = await confirmDialog({ title: 'Abo-Token erneuern?', text: 'Das alte Abo funktioniert danach nicht mehr und muss neu eingerichtet werden.', ok: 'Token erneuern', danger: true });
    if (!ok) return;
    const { data, error } = await sb.rpc('reset_feed_token');
    if (error) return toast(error.message, 'err');
    S.me.feed_token = data;
    m.close();
    toast('Neuer Abo-Token erstellt ✓');
    setTimeout(openFeed, 260);
  };
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link kopiert ✓'); }
  catch (e) { prompt('Link kopieren:', text); }
}

/* ================= Daten ================= */
async function loadMe() {
  const { data, error } = await sb.rpc('my_profile');
  if (error) throw error;
  if (data) {
    S.me = data;
    applyProfilePrefs();
    return data;
  }
  await new Promise(r => setTimeout(r, 1200));
  const retry = await sb.rpc('my_profile');
  if (retry.data) {
    S.me = retry.data;
    applyProfilePrefs();
    return retry.data;
  }
  throw new Error('Dein Profil konnte noch nicht geladen werden. Bitte lade die Seite neu.');
}

function applyProfilePrefs() {
  if (!S.me) return;
  if (!localStorage.getItem(THEME_KEY) && !localStorage.getItem('theme') && S.me.theme) {
    try { localStorage.setItem(THEME_KEY, S.me.theme); } catch (e) {}
  }
  S.soundEnabled = S.me.sound_enabled !== false;
  applyTheme();
}

async function loadAll() {
  const uid = S.user?.id;
  if (!uid) return false;
  const [pr, ev, fr, nt] = await Promise.all([
    sb.from('profiles').select('id, username, display_name, color, avatar_url, share_enabled, friends_can_view, status, is_admin, created_at').order('display_name'),
    sb.from('events').select('*, event_participants(*)').order('start_at'),
    sb.from('friendships').select('*').order('created_at', { ascending: false }),
    sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60)
  ]);
  const err = pr.error || ev.error || fr.error || nt.error;
  if (err) {
    toast('Ladefehler: ' + err.message, 'err');
    return false;
  }
  S.profiles = pr.data || [];
  S.me = { ...(S.me || {}), ...(P(uid) || {}) };
  S.events = (ev.data || []).map(e => ({
    ...e,
    parts: e.event_participants || [],
    mine: (e.event_participants || []).find(p => p.user_id === uid)
  }));
  S.friendships = fr.data || [];
  S.notifs = nt.data || [];
  if (S.me) applyProfilePrefs();
  processNotifications(false);
  return true;
}

async function refresh() {
  if (!S.user) return route();
  const ok = await loadAll();
  if (!ok) return;
  route();
}

/* ================= Benachrichtigungen / Push ================= */
function unreadCount() { return S.notifs.filter(n => !n.read).length; }
function pendingEventCount() {
  return S.events.filter(e => e.created_by !== S.user?.id && e.mine?.status === 'pending').length;
}
function pendingFriendCount() {
  return S.friendships.filter(f => f.status === 'pending' && f.addressee === S.user?.id).length;
}

function updateBadges() {
  const unread = unreadCount();
  const bell = $('#bell');
  if (bell) {
    let b = $('.badge', bell);
    if (unread > 0) {
      if (!b) { b = document.createElement('i'); b.className = 'badge'; bell.appendChild(b); }
      b.textContent = String(unread);
    } else if (b) b.remove();
  }
  const navReq = $('#nav-requests .badge');
  const pend = pendingEventCount();
  if (navReq) navReq.textContent = String(pend);
  const navFri = $('#nav-friends .badge');
  const pf = pendingFriendCount();
  if (navFri) navFri.textContent = String(pf);
  try {
    if (navigator.setAppBadge) navigator.setAppBadge(unread > 0 ? unread : 0);
  } catch (e) {}
}

function processNotifications(show) {
  const ids = new Set(S.notifs.map(n => n.id));
  if (S.notifSeen && show) {
    S.notifs.filter(n => !S.notifSeen.has(n.id) && !n.read).forEach(showLocalNotification);
  }
  S.notifSeen = ids;
  updateBadges();
}

function showLocalNotification(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const url = n.event_id ? `#/event/${n.event_id}` : (n.text.includes('befreundet') || n.text.includes('Freundschaft') ? '#/friends' : '#/requests');
  const opts = {
    body: n.text,
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    tag: 'terminio-' + n.id,
    data: { url }
  };
  try {
    const reg = S.swReg;
    if (reg && reg.showNotification) reg.showNotification('Terminio', opts).catch(() => {});
    else {
      const x = new Notification('Terminio', opts);
      x.onclick = () => { window.focus(); location.hash = url; x.close(); };
    }
  } catch (e) {}
}

async function requestDesktopNotifications(silent = false) {
  if (!('Notification' in window)) {
    if (!silent) toast('Dieser Browser unterstützt keine Desktop-Benachrichtigungen', 'err');
    return false;
  }
  if (Notification.permission === 'granted') {
    if (!silent) toast('Desktop-Benachrichtigungen sind aktiv ✓');
    return true;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    if (!silent) {
      toast('Desktop-Benachrichtigungen aktiviert ✓');
      new Notification('Terminio', { body: 'Alles klar – du erhältst jetzt Hinweise zu Terminen und Anfragen.', icon: 'assets/icon-192.png' });
    }
    return true;
  }
  if (!silent) toast('Benachrichtigungen wurden nicht erlaubt', 'err');
  return false;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function enablePush() {
  if (!S.user) return toast('Bitte zuerst anmelden', 'err');
  if (!VAPID_PUBLIC_KEY) return toast('Web-Push ist noch nicht konfiguriert', 'err');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return toast('Dieser Browser unterstützt kein Web-Push', 'err');
  }
  try {
    const ok = await requestDesktopNotifications(true);
    if (!ok) return toast('Benachrichtigungen wurden nicht erlaubt', 'err');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const json = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      user_id: S.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    S.pushEnabled = true;
    toast('Push-Benachrichtigungen aktiviert ✓');
    return true;
  } catch (e) {
    toast('Push konnte nicht aktiviert werden: ' + (e.message || e), 'err');
    return false;
  }
}

async function disablePush() {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
    }
    S.pushEnabled = false;
    toast('Push-Benachrichtigungen deaktiviert');
  } catch (e) {
    toast('Konnte nicht deaktiviert werden: ' + (e.message || e), 'err');
  }
}

async function syncPush() {
  if (!S.user || !VAPID_PUBLIC_KEY) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const json = sub.toJSON();
    await sb.from('push_subscriptions').upsert({
      user_id: S.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent
    }, { onConflict: 'endpoint' });
    S.pushEnabled = true;
  } catch (e) {}
}

function startPolling() {
  clearInterval(S.poll);
  S.poll = setInterval(async () => {
    if (!S.user || document.hidden) return;
    const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    if (!data) return;
    const oldIds = new Set(S.notifs.map(n => n.id));
    const fresh = data.filter(n => !oldIds.has(n.id));
    S.notifs = data;
    if (fresh.length) {
      processNotifications(true);
      if (!$('.modal-back')) {
        await loadAll();
        route();
      }
    } else {
      updateBadges();
    }
  }, 25000);
}
function stopPolling() { clearInterval(S.poll); S.poll = null; }

/* ================= PWA / Service Worker ================= */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    S.swReg = await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('Service Worker:', e);
  }
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButtons();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  toast('Terminio wurde installiert ✓');
  document.querySelectorAll('.install-only').forEach(el => el.remove());
});

function showInstallButtons() {
  $$('.install-only').forEach(el => el.classList.remove('hidden'));
}

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') toast('Installation gestartet …');
    deferredPrompt = null;
    return;
  }
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return toast('iPhone/iPad: Teilen-Symbol → „Zum Home-Bildschirm“.');
  }
  toast('Browser-Menü → „App installieren“ / „Terminio installieren“.');
}

/* ================= Layout ================= */
function logo() {
  return `<img class="logo-img" src="assets/logo.svg" alt="" width="36" height="36">`;
}

function shell(active, inner) {
  const unread = unreadCount();
  const pend = pendingEventCount();
  const friendReq = pendingFriendCount();
  const admin = !!S.me?.is_admin;
  app.innerHTML = `
  <header class="nav">
    <a class="brand" href="#/">${logo()}<span>Terminio</span></a>
    <nav class="mainnav" aria-label="Hauptnavigation">
      <a href="#/" class="${active === 'cal' ? 'on' : ''}">Kalender</a>
      <a href="#/friends" id="nav-friends" class="${active === 'friends' ? 'on' : ''}">Freunde${friendReq ? `<i class="badge">${friendReq}</i>` : ''}</a>
      <a href="#/requests" id="nav-requests" class="${active === 'req' ? 'on' : ''}">Anfragen${pend ? `<i class="badge">${pend}</i>` : ''}</a>
      ${admin ? `<a href="#/admin" class="${active === 'admin' ? 'on' : ''}">Admin</a>` : ''}
    </nav>
    <div class="nav-r">
      <button id="installBtn" class="icon install-only hidden" title="App installieren" aria-label="App installieren">⬇</button>
      <button id="bell" class="icon" title="Benachrichtigungen" aria-label="Benachrichtigungen">🔔${unread ? `<i class="badge">${unread}</i>` : ''}</button>
      <button id="theme" class="icon" title="Design wechseln" aria-label="Design">${themeIcon()}</button>
      <a href="#/settings" class="icon profile-btn ${active === 'set' ? 'on' : ''}" title="Profil & Einstellungen" aria-label="Profil">${avatar(S.me)}</a>
    </div>
  </header>
  <main class="page">${inner}</main>`;

  $('#theme').onclick = openTheme;
  $('#bell').onclick = openNotifs;
  $('#installBtn')?.addEventListener('click', installApp);
  if (deferredPrompt) $('#installBtn')?.classList.remove('hidden');
  applyTheme();
}

function anonShell(inner) {
  app.innerHTML = `
  <header class="nav">
    <a class="brand" href="#/">${logo()}<span>Terminio</span></a>
    <div class="nav-r">
      <button id="theme" class="icon" title="Design" aria-label="Design">${themeIcon()}</button>
      <a class="btn sm" href="#/login">Mit Discord anmelden</a>
    </div>
  </header>
  <main class="page">${inner}</main>`;
  $('#theme').onclick = openTheme;
  applyTheme();
}

const page = (active, inner) => S.user ? shell(active, inner) : anonShell(inner);

async function openNotifs() {
  const list = S.notifs;
  const m = openModal(`
    <h3>Benachrichtigungen</h3>
    <div class="nlist">${list.length ? list.map(n => `
      <div class="nitem ${n.read ? '' : 'new'}" data-ev="${n.event_id || ''}" data-txt="${esc(n.text)}">
        <span>${esc(n.text)}</span>
        <small>${fmtDateTime(n.created_at)}</small>
      </div>`).join('') : '<div class="empty"><b>🔕</b>Keine Benachrichtigungen</div>'}</div>
    ${list.length ? '<div class="mrow"><button class="ghost sm" id="nt-all">Alle als gelesen markieren</button></div>' : ''}`);
  $$('.nitem', m).forEach(el => el.onclick = () => {
    m.close();
    setTimeout(() => {
      if (el.dataset.ev) showEvent(el.dataset.ev);
      else if (el.dataset.txt.includes('befreundet') || el.dataset.txt.includes('Freundschaft')) { location.hash = '#/friends'; }
      else { location.hash = '#/requests'; }
    }, 240);
  });
  $('#nt-all', m)?.addEventListener('click', async () => {
    await sb.from('notifications').update({ read: true }).eq('user_id', S.user.id).eq('read', false);
    S.notifs.forEach(n => n.read = true);
    updateBadges();
    m.close();
    toast('Alle als gelesen markiert');
  });
  if (list.some(n => !n.read)) {
    await sb.from('notifications').update({ read: true }).eq('user_id', S.user.id).eq('read', false);
    S.notifs.forEach(n => n.read = true);
    updateBadges();
  }
}

/* ================= Monatsraster ================= */
function monthGrid(items, range) {
  const first = S.cursor;
  const start = range.start;
  const today = ymd(new Date());
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = ymd(d);
    const list = items
      .filter(e => ymd(new Date(e.start_at)) === key)
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    cells += `<div class="day ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${key === today ? 'today' : ''}" data-day="${key}" style="--i:${i}">
      <span class="dn">${d.getDate()}</span>
      ${list.slice(0, 3).map(e => `<button class="chip ${e.cls || ''}" data-ev="${e.id}" data-occ="${esc(e.occStart)}" style="--c:${esc(e.color || '#6366f1')}" title="${esc(e.title)}"><b>${fmtTime(e.start_at)}</b> ${esc(e.title)}</button>`).join('')}
      ${list.length > 3 ? `<span class="more">+${list.length - 3} weitere</span>` : ''}</div>`;
  }
  return `<div class="cal-head">
      <button class="icon" data-nav="-1" aria-label="Zurück">‹</button>
      <h2>${MONTHS[first.getMonth()]} ${first.getFullYear()}</h2>
      <button class="ghost sm" data-nav="0">Heute</button>
      <button class="icon" data-nav="1" aria-label="Weiter">›</button>
    </div>
    <div class="grid dow">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div>`;
}

function bindCal(box, getItems, { onDay, onEvent } = {}) {
  const draw = () => {
    const range = calendarRange(S.cursor);
    box.innerHTML = monthGrid(getItems(range), range);
  };
  draw();
  box.onclick = e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const v = +nav.dataset.nav;
      S.cursor = v === 0 ? som(new Date()) : new Date(S.cursor.getFullYear(), S.cursor.getMonth() + v, 1);
      draw();
      return;
    }
    const chip = e.target.closest('[data-ev]');
    if (chip) { onEvent && onEvent(chip.dataset.ev, chip.dataset.occ); return; }
    const day = e.target.closest('[data-day]');
    if (day && onDay) onDay(day.dataset.day);
  };
}

/* ================= Eigener Kalender ================= */
function myOccurrences(from, to) {
  const out = [];
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  for (const ev of S.events) {
    if (!ev.mine || ev.mine.status === 'declined') continue;
    for (const o of occurrences(ev, from, to)) {
      if (new Date(o.end_at).getTime() < cutoff) continue;
      out.push({
        ...o,
        color: S.me?.color || '#6366f1',
        cls: (ev.mine.status === 'pending' ? 'pending ' : '') + (ev.mine.is_private ? 'priv' : '')
      });
    }
  }
  return out.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
}

function findConflict(start, end, excludeId = null) {
  const from = new Date(start.getTime() - 2 * 864e5);
  const to = new Date(end.getTime() + 2 * 864e5);
  for (const ev of S.events) {
    if (ev.id === excludeId || ev.mine?.status !== 'accepted') continue;
    for (const o of occurrences(ev, from, to)) {
      if (new Date(o.start_at) < end && new Date(o.end_at) > start) return o;
    }
  }
  return null;
}

function viewCalendar() {
  const now = new Date();
  const upcoming = myOccurrences(now, addDays(now, 365)).slice(0, 6);
  const firstName = (S.me.display_name || 'du').split(' ')[0];
  shell('cal', `
    <section class="hero-row">
      <div>
        <h1>Hallo ${esc(firstName)} <span class="wave">👋</span></h1>
        <p class="muted">Dein Kalender – gestrichelt = noch offen · Serien mit ↻ markiert</p>
      </div>
      <div class="actions">
        <button class="btn" id="new" data-sfx="success">＋ Neuer Termin</button>
        <button class="ghost" id="feed">📡 Live-Abo</button>
        <button class="ghost" id="ics">⬇ .ics Export</button>
      </div>
    </section>
    <div class="card cal-card" id="cal"></div>
    <div class="cal-foot">
      <span class="muted">🔒 Privat</span>
      <span class="muted">◌ Ausstehend</span>
      <span class="muted">↻ Serientermin</span>
      <span class="muted">⏳ Termine werden ${RETENTION_DAYS} Tage nach Ende automatisch gelöscht</span>
    </div>
    <h3 class="section-t">Nächste Termine <span class="pill">${upcoming.length}</span></h3>
    <div class="list">${upcoming.length
      ? upcoming.map((e, i) => itemRow(e, i)).join('')
      : '<div class="card empty"><b>🗓️</b>Noch nichts geplant – klicke auf einen Tag im Kalender.</div>'}</div>`);

  $('#new').onclick = () => eventForm();
  $('#feed').onclick = openFeed;
  $('#ics').onclick = exportAll;
  bindCal($('#cal'), (range) => myOccurrences(range.start, range.end), {
    onDay: d => eventForm({ date: d }),
    onEvent: (id, occ) => showEvent(id, occ)
  });
  bindList();
}

function itemRow(e, i = 0) {
  const d = new Date(e.start_at);
  const org = P(e.created_by);
  return `<div class="item" style="animation-delay:${i * 60}ms" data-open="${e.id}" data-occ="${esc(e.occStart)}">
    <div class="date-pill"><small>${MONTHS[d.getMonth()].slice(0, 3)}</small><span>${d.getDate()}</span></div>
    <div class="grow">
      <h4>${esc(e.title)}${e.mine?.is_private ? ' 🔒' : ''}${e.recurrence && e.recurrence !== 'none' ? ' <span class="rec-mark" title="' + esc(recurrenceText(e)) + '">↻</span>' : ''}</h4>
      <p>${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}${e.created_by !== S.user.id ? ' · von ' + esc(org?.display_name || '?') : ''}${e.recurrence && e.recurrence !== 'none' ? ' · ' + esc(recurrenceText(e)) : ''}</p>
    </div>
    ${e.mine ? `<span class="badge-s ${e.mine.status}">${STATUS[e.mine.status]}</span>` : ''}
  </div>`;
}

function bindList() {
  $$('[data-open]').forEach(el => el.onclick = () => showEvent(el.dataset.open, el.dataset.occ));
}

/* ================= Termin anlegen / anfragen ================= */
function eventForm({ date = ymd(new Date()), target = null } = {}) {
  const others = S.profiles.filter(p => p.id !== S.user.id && p.id !== target?.id);
  const m = openModal(`
    <h3>${target ? `Termin anfragen bei ${esc(target.display_name)}` : 'Neuer Termin'}</h3>
    <form id="ef" class="form">
      <label>Titel<input name="title" required maxlength="120" placeholder="z. B. Kaffee & Planung" autofocus></label>
      <label>Beschreibung<textarea name="description" rows="3" placeholder="Worum geht es?"></textarea></label>
      <div class="row3">
        <label>Datum<input type="date" name="date" value="${esc(date)}" required></label>
        <label>Von<input type="time" name="start" value="10:00" required></label>
        <label>Bis<input type="time" name="end" value="11:00" required></label>
      </div>
      <div class="row2">
        <label>Wiederholung
          <select name="recurrence">
            ${Object.entries(RECUR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </label>
        <label class="recur-fields hidden">Intervall
          <input type="number" name="interval" min="1" max="52" value="1">
        </label>
      </div>
      <div class="recur-fields hidden">
        <label>Serie endet am <small>(optional)</small><input type="date" name="until"></label>
      </div>
      <div class="label">Teilnehmer <small>(optional, alle registrierten Nutzer)</small></div>
      <input id="psearch" placeholder="Nutzer suchen…" autocomplete="off">
      <div class="people" id="people">${others.map(p => `<button type="button" class="person" data-id="${p.id}" data-n="${esc((p.display_name + ' ' + p.username).toLowerCase())}">${avatar(p)} ${esc(p.display_name)} <small>@${esc(p.username)}</small></button>`).join('') || '<span class="muted">Noch keine weiteren Nutzer</span>'}</div>
      ${target ? '' : '<label class="check"><input type="checkbox" name="priv"> 🔒 Privat – Freunde sehen nur „Belegt“</label>'}
      <div class="notice">Serientermine gelten für die ganze Serie. Teilnehmer erhalten eine Einladung für alle Termine.</div>
      <button class="btn" type="submit" data-sfx="success">${target ? 'Anfrage senden' : 'Speichern'}</button>
    </form>`, true);

  const recSel = $('[name=recurrence]', m);
  const toggleRec = () => {
    const active = recSel.value !== 'none';
    $$('.recur-fields', m).forEach(el => el.classList.toggle('hidden', !active));
  };
  recSel.onchange = toggleRec;
  toggleRec();

  $$('.person', m).forEach(b => b.onclick = () => b.classList.toggle('on'));
  $('#psearch', m).oninput = e => {
    const q = e.target.value.toLowerCase();
    $$('.person', m).forEach(b => b.style.display = b.dataset.n.includes(q) ? '' : 'none');
  };

  $('#ef', m).onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = $('.btn', m);
    btn.disabled = true;

    const start = new Date(`${f.get('date')}T${f.get('start')}`);
    const end = new Date(`${f.get('date')}T${f.get('end')}`);
    if (!(end > start)) { toast('Ende muss nach dem Start liegen', 'err'); btn.disabled = false; return; }

    const recurrence = f.get('recurrence') || 'none';
    const interval = recurrence === 'none' ? 1 : Math.min(52, Math.max(1, parseInt(f.get('interval') || '1', 10) || 1));
    let until = null;
    if (recurrence !== 'none' && f.get('until')) {
      until = new Date(`${f.get('until')}T23:59:59`);
      if (until < start) { toast('Das Serienende muss nach dem Start liegen', 'err'); btn.disabled = false; return; }
    }

    const conflict = findConflict(start, end);
    if (conflict) {
      const ok = await confirmDialog({
        title: 'Überschneidung',
        text: `„${conflict.title}“ liegt im selben Zeitraum (${fmtTime(conflict.start_at)} – ${fmtTime(conflict.end_at)}).\n\nMöchtest du den Termin trotzdem speichern?`,
        ok: 'Trotzdem speichern'
      });
      if (!ok) { btn.disabled = false; return; }
    }

    const { data: e, error } = await sb.from('events').insert({
      created_by: S.user.id,
      title: f.get('title').trim(),
      description: (f.get('description') || '').trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      recurrence,
      recurrence_interval: interval,
      recurrence_until: until ? until.toISOString() : null
    }).select().single();
    if (error) { toast(error.message, 'err'); btn.disabled = false; return; }

    const ids = $$('.person.on', m).map(b => b.dataset.id);
    if (target) ids.unshift(target.id);
    const rows = [
      { event_id: e.id, user_id: S.user.id, status: 'accepted', is_private: !!f.get('priv'), responded_at: new Date().toISOString() },
      ...ids.map(id => ({ event_id: e.id, user_id: id, status: 'pending' }))
    ];
    const { error: e2 } = await sb.from('event_participants').insert(rows);
    if (e2) {
      await sb.from('events').delete().eq('id', e.id);
      toast(e2.message, 'err');
      btn.disabled = false;
      return;
    }
    m.close();
    toast(target ? 'Anfrage gesendet ✓' : (recurrence === 'none' ? 'Termin gespeichert ✓' : 'Serientermin gespeichert ✓'));
    playSfx('success');
    refresh();
  };
}

/* ================= Termin-Details & Aktionen ================= */
async function respond(eid, status, reason = null) {
  const { error } = await sb.from('event_participants')
    .update({ status, reason, responded_at: new Date().toISOString() })
    .eq('event_id', eid)
    .eq('user_id', S.user.id);
  if (error) return toast(error.message, 'err');
  toast(status === 'accepted' ? 'Zugesagt ✓' : 'Abgelehnt');
  playSfx(status === 'accepted' ? 'success' : 'error');
  refresh();
}

async function accept(eid, occStart) {
  const ev = S.events.find(x => x.id === eid);
  if (!ev) return;
  const occ = occurrenceAt(ev, occStart);
  const c = findConflict(new Date(occ.start_at), new Date(occ.end_at), eid);
  if (c) {
    const ok = await confirmDialog({
      title: 'Termin überschneidet sich',
      text: `„${c.title}“ liegt im selben Zeitraum (${fmtTime(c.start_at)} – ${fmtTime(c.end_at)}).\n\nMöchtest du trotzdem zusagen?`,
      ok: 'Trotzdem zusagen'
    });
    if (!ok) return;
  }
  respond(eid, 'accepted');
}

function askReason(eid, parentModal) {
  if (parentModal) parentModal.close();
  const m = openModal(`<h3>Termin ablehnen</h3>
    <form class="form" id="rf">
      <label>Begründung<textarea name="reason" rows="3" required placeholder="Warum passt es nicht?"></textarea></label>
      <button class="btn danger" type="submit" data-sfx="error">Ablehnen</button>
    </form>`);
  $('#rf', m).onsubmit = async ev => {
    ev.preventDefault();
    const r = new FormData(ev.target).get('reason').trim();
    if (!r) return;
    m.close();
    respond(eid, 'declined', r);
  };
}

async function removeEvent(eid, m) {
  const ok = await confirmDialog({
    title: 'Termin wirklich löschen?',
    text: 'Der Termin verschwindet bei allen Teilnehmern. Bei einem Serientermin wird die gesamte Serie gelöscht.',
    ok: 'Löschen',
    danger: true
  });
  if (!ok) return;
  const { error } = await sb.from('events').delete().eq('id', eid);
  if (error) return toast(error.message, 'err');
  if (m) m.close();
  toast('Gelöscht');
  playSfx('error');
  refresh();
}

function showEvent(id, occStart) {
  const e = S.events.find(x => x.id === id);
  if (!e) return;
  if (e.recurrence === 'none' && new Date(e.end_at).getTime() < Date.now() - RETENTION_DAYS * 864e5) {
    return toast('Dieser Termin ist nicht mehr verfügbar (älter als 14 Tage)', 'err');
  }
  const occ = occurrenceAt(e, occStart || e.start_at);
  const me = S.user.id;
  const isCreator = e.created_by === me;
  const mine = e.mine;
  const org = P(e.created_by);
  const series = e.recurrence && e.recurrence !== 'none';

  const parts = e.parts.map(p => {
    const pr = P(p.user_id);
    return `<li>${avatar(pr)}
      <span>${esc(pr?.display_name || 'Unbekannt')}${p.user_id === e.created_by ? ' <small>(Organisator)</small>' : ''}${p.status === 'declined' && p.reason ? `<em class="reason">„${esc(p.reason)}“</em>` : ''}</span>
      <span class="badge-s ${p.status}">${STATUS[p.status]}</span></li>`;
  }).join('');

  const m = openModal(`
    <h3>${esc(e.title)}</h3>
    <div class="meta">
      <span>📅 <b>${fmtDate(occ.start_at)}</b></span>
      <span>🕒 <b>${fmtTime(occ.start_at)} – ${fmtTime(occ.end_at)}</b></span>
      ${series ? `<span>↻ <b>${esc(recurrenceText(e))}</b> · Serientermin</span>` : ''}
      <span>👤 ${isCreator ? 'Von dir erstellt' : 'Von ' + esc(org?.display_name || '?')}</span>
    </div>
    ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
    <div class="label">Teilnehmer</div>
    <ul class="plist">${parts}</ul>
    ${mine?.status === 'accepted' ? `<label class="check" style="display:flex;gap:10px;align-items:center;margin-top:8px"><input type="checkbox" id="priv" ${mine.is_private ? 'checked' : ''} style="accent-color:var(--pr);width:18px;height:18px"> 🔒 Für mich privat (Freunde sehen nur „Belegt“)</label>` : ''}
    <div class="mrow">
      ${mine?.status === 'pending' ? '<button class="btn ok" id="acc">✓ Zusagen</button><button class="btn danger" id="dec">✕ Ablehnen</button>' : ''}
      ${mine?.status === 'accepted' && !isCreator ? '<button class="ghost" id="dec">Absagen</button>' : ''}
      ${mine?.status === 'declined' ? '<button class="btn ok" id="acc">Doch zusagen</button>' : ''}
      ${isCreator ? '<button class="ghost danger-text" id="del">🗑 Löschen</button>' : ''}
    </div>
    <div class="mrow">
      <a class="ghost sm" target="_blank" rel="noopener" href="${googleLink(e)}">Google Kalender</a>
      <button class="ghost sm" id="oneics">⬇ .ics (Apple/Outlook)</button>
    </div>`);

  $('#acc', m) && ($('#acc', m).onclick = () => { m.close(); accept(id, occ.occStart); });
  $('#dec', m) && ($('#dec', m).onclick = () => askReason(id, m));
  $('#del', m) && ($('#del', m).onclick = () => removeEvent(id, m));
  $('#oneics', m).onclick = () => download('termin.ics', buildICS([e]));
  $('#priv', m) && ($('#priv', m).onchange = async ev => {
    const { error } = await sb.from('event_participants')
      .update({ is_private: ev.target.checked })
      .eq('event_id', id).eq('user_id', me);
    if (error) return toast(error.message, 'err');
    if (e.mine) e.mine.is_private = ev.target.checked;
    toast(ev.target.checked ? 'Termin ist privat 🔒' : 'Termin ist sichtbar');
    playSfx('success');
  });
}

/* ================= Anfragen ================= */
function viewRequests() {
  const me = S.user.id;
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  const visible = S.events.filter(e => e.recurrence !== 'none' || new Date(e.end_at).getTime() >= cutoff);
  const incoming = visible.filter(e => e.created_by !== me && e.mine?.status === 'pending');
  const sent = visible.filter(e => e.created_by === me && e.parts.length > 1);
  const hist = visible.filter(e => e.created_by !== me && e.mine && e.mine.status !== 'pending');
  const tabs = { in: ['Eingehend', incoming], out: ['Gesendet', sent], hist: ['Verlauf', hist] };
  const cur = tabs[S.tab] || tabs.in;
  const list = cur[1];

  shell('req', `
    <section class="hero-row">
      <div><h1>Anfragen</h1><p class="muted">Termine annehmen, ablehnen und verfolgen</p></div>
      <div class="actions"><button class="ghost" id="req-friends">👥 Freunde</button></div>
    </section>
    <div class="tabs">
      ${Object.entries(tabs).map(([k, [n, l]]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${n}${l.length && k === 'in' ? ` <i class="badge">${l.length}</i>` : ''}</button>`).join('')}
    </div>
    <div class="list">${list.length ? list.map((e, i) => reqRow(e, i)).join('') : `<div class="card empty"><b>${S.tab === 'in' ? '🎉' : '📭'}</b>Hier ist nichts.</div>`}</div>`);

  $('#req-friends').onclick = () => { location.hash = '#/friends'; };
  $$('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; viewRequests(); });
  $$('[data-act]').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const id = b.dataset.id;
    const a = b.dataset.act;
    if (a === 'acc') accept(id);
    else if (a === 'dec') askReason(id);
    else if (a === 'del') removeEvent(id);
  });
  bindList();
}

function reqRow(e, i) {
  const me = S.user.id;
  const d = new Date(e.start_at);
  const org = P(e.created_by);
  const others = e.parts.filter(p => p.user_id !== e.created_by);
  const series = e.recurrence && e.recurrence !== 'none';
  let right = '';
  if (S.tab === 'in') {
    right = `<div class="btns"><button class="btn ok sm" data-act="acc" data-id="${e.id}">✓ Zusagen</button><button class="btn danger sm" data-act="dec" data-id="${e.id}">✕ Ablehnen</button></div>`;
  } else if (S.tab === 'out') {
    right = `<div class="btns">${others.map(p => `<span class="badge-s ${p.status}" title="${esc(p.reason || '')}">${esc(P(p.user_id)?.display_name || '?')}: ${STATUS[p.status]}</span>`).join('')}<button class="ghost sm" data-act="del" data-id="${e.id}">Zurückziehen</button></div>`;
  } else {
    right = `<span class="badge-s ${e.mine.status}">${STATUS[e.mine.status]}</span>`;
  }
  return `<div class="item" style="animation-delay:${i * 60}ms" data-open="${e.id}" data-occ="${esc(e.start_at)}">
    <div class="date-pill"><small>${MONTHS[d.getMonth()].slice(0, 3)}</small><span>${d.getDate()}</span></div>
    <div class="grow">
      <h4>${esc(e.title)}${series ? ' <span class="rec-mark" title="' + esc(recurrenceText(e)) + '">↻</span>' : ''}</h4>
      <p>${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}${e.created_by !== me ? ' · von ' + esc(org?.display_name || '?') : ''}${series ? ' · ' + esc(recurrenceText(e)) : ''}</p>
      ${e.description ? `<p>${esc(e.description.slice(0, 120))}</p>` : ''}
    </div>${right}</div>`;
}

/* ================= Freunde ================= */
function friendOther(f) {
  const uid = S.user.id;
  return f.requester === uid ? f.addressee : f.requester;
}

function viewFriends() {
  const uid = S.user.id;
  const accepted = S.friendships.filter(f => f.status === 'accepted');
  const incoming = S.friendships.filter(f => f.status === 'pending' && f.addressee === uid);
  const outgoing = S.friendships.filter(f => f.status === 'pending' && f.requester === uid);
  const blocked = S.friendships.filter(f => f.status === 'blocked');

  const friendCards = accepted.map(f => {
    const other = P(friendOther(f));
    if (!other) return '';
    return `<div class="friend-card">
      ${avatar(other)}
      <div class="grow">
        <h4>${esc(other.display_name)}</h4>
        <p>@${esc(other.username)}</p>
        <span class="badge-s ${other.friends_can_view ? 'accepted' : 'declined'}">${other.friends_can_view ? 'Kalender geteilt' : 'Kalender privat'}</span>
      </div>
      <div class="btns">
        <button class="ghost sm" data-friend-view="${other.id}">📅 Kalender</button>
        <button class="ghost sm" data-friend-remove="${f.id}">Entfernen</button>
        <button class="ghost sm danger-text" data-friend-block="${f.id}">Blockieren</button>
      </div>
    </div>`;
  }).join('');

  const incomingCards = incoming.map(f => {
    const other = P(f.requester);
    return `<div class="friend-card">
      ${avatar(other)}
      <div class="grow"><h4>${esc(other?.display_name || 'Unbekannt')}</h4><p>@${esc(other?.username || '')} möchte mit dir befreundet sein</p></div>
      <div class="btns">
        <button class="btn ok sm" data-friend-accept="${f.id}">✓ Annehmen</button>
        <button class="btn danger sm" data-friend-decline="${f.id}">✕ Ablehnen</button>
      </div>
    </div>`;
  }).join('');

  const outgoingCards = outgoing.map(f => {
    const other = P(f.addressee);
    return `<div class="friend-card">
      ${avatar(other)}
      <div class="grow"><h4>${esc(other?.display_name || 'Unbekannt')}</h4><p>Anfrage gesendet · @${esc(other?.username || '')}</p></div>
      <button class="ghost sm" data-friend-cancel="${f.id}">Zurückziehen</button>
    </div>`;
  }).join('');

  const blockedCards = blocked.map(f => {
    const other = P(friendOther(f));
    const mine = f.blocked_by === uid;
    return `<div class="friend-card blocked">
      ${avatar(other)}
      <div class="grow"><h4>${esc(other?.display_name || 'Unbekannt')}</h4><p>Blockiert · @${esc(other?.username || '')}</p></div>
      ${mine
        ? `<button class="ghost sm" data-friend-unblock="${f.id}">Blockierung aufheben</button>`
        : '<span class="badge-s declined">Von dieser Person blockiert</span>'}
    </div>`;
  }).join('');

  shell('friends', `
    <section class="hero-row">
      <div><h1>Freunde</h1><p class="muted">Freunde sehen deinen Kalender – außer private Termine.</p></div>
      <div class="actions">
        <button class="btn" id="add-friend" data-sfx="success">＋ Freund hinzufügen</button>
        <button class="ghost" id="friend-settings">⚙️ Freigabe</button>
      </div>
    </section>

    ${incoming.length ? `<h3 class="section-t">Neue Anfragen <span class="pill">${incoming.length}</span></h3><div class="friend-grid">${incomingCards}</div>` : ''}

    <h3 class="section-t">Deine Freunde <span class="pill">${accepted.length}</span></h3>
    <div class="friend-grid">${friendCards || '<div class="card empty"><b>👥</b>Noch keine Freunde. Füge jemanden hinzu – dann könnt ihr eure Kalender teilen.</div>'}</div>

    ${outgoing.length ? `<h3 class="section-t">Gesendete Anfragen <span class="pill">${outgoing.length}</span></h3><div class="friend-grid">${outgoingCards}</div>` : ''}
    ${blocked.length ? `<h3 class="section-t">Blockiert</h3><div class="friend-grid">${blockedCards}</div>` : ''}
  `);

  $('#add-friend').onclick = openAddFriend;
  $('#friend-settings').onclick = () => { location.hash = '#/settings'; };
  $$('[data-friend-view]').forEach(b => b.onclick = () => { location.hash = '#/f/' + b.dataset.friendView; });
  $$('[data-friend-accept]').forEach(b => b.onclick = () => respondFriend(b.dataset.friendAccept, 'accepted'));
  $$('[data-friend-decline]').forEach(b => b.onclick = () => respondFriend(b.dataset.friendDecline, 'declined'));
  $$('[data-friend-cancel]').forEach(b => b.onclick = () => removeFriend(b.dataset.friendCancel, 'Anfrage zurückgezogen'));
  $$('[data-friend-remove]').forEach(b => b.onclick = () => removeFriend(b.dataset.friendRemove, 'Freund entfernt'));
  $$('[data-friend-block]').forEach(b => b.onclick = () => blockFriend(b.dataset.friendBlock));
  $$('[data-friend-unblock]').forEach(b => b.onclick = () => removeFriend(b.dataset.friendUnblock, 'Blockierung aufgehoben'));
}

function openAddFriend() {
  const uid = S.user.id;
  const related = new Map();
  S.friendships.forEach(f => {
    const other = friendOther(f);
    if (f.status !== 'declined') related.set(other, f.status);
  });
  const candidates = S.profiles.filter(p => p.id !== uid && p.status === 'active');
  const m = openModal(`
    <h3>Freund hinzufügen</h3>
    <p class="muted" style="margin-bottom:12px">Sende eine Anfrage. Erst nach der Annahme seht ihr eure Kalender.</p>
    <input id="friend-search" placeholder="Name oder @Benutzername suchen…" autocomplete="off">
    <div class="people friend-picker" id="friend-picker">
      ${candidates.map(p => {
        const st = related.get(p.id);
        const label = st === 'accepted' ? 'Befreundet' : st === 'pending' ? 'Angefragt' : st === 'blocked' ? 'Blockiert' : '＋ Anfragen';
        return `<div class="person friend-pick" data-id="${p.id}" data-n="${esc((p.display_name + ' ' + p.username).toLowerCase())}">
          ${avatar(p)}<span class="grow">${esc(p.display_name)} <small>@${esc(p.username)}</small></span>
          <button class="ghost sm" data-send="${p.id}" ${st ? 'disabled' : ''}>${label}</button>
        </div>`;
      }).join('') || '<span class="muted">Keine weiteren Nutzer gefunden.</span>'}
    </div>`, true);
  $('#friend-search', m).oninput = e => {
    const q = e.target.value.toLowerCase();
    $$('.friend-pick', m).forEach(el => { el.style.display = el.dataset.n.includes(q) ? '' : 'none'; });
  };
  $$('[data-send]', m).forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from('friendships').insert({ requester: uid, addressee: b.dataset.send, status: 'pending' });
    if (error) {
      b.disabled = false;
      if (error.code === '23505') return toast('Es gibt bereits eine Anfrage oder Freundschaft', 'err');
      return toast(error.message, 'err');
    }
    b.textContent = 'Angefragt';
    toast('Freundschaftsanfrage gesendet ✓');
    playSfx('success');
    await loadAll();
    updateBadges();
  });
}

async function respondFriend(id, status) {
  const { error } = await sb.from('friendships')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return toast(error.message, 'err');
  toast(status === 'accepted' ? 'Freundschaft angenommen ✓' : 'Anfrage abgelehnt');
  playSfx(status === 'accepted' ? 'success' : 'error');
  refresh();
}

async function removeFriend(id, msg) {
  const ok = await confirmDialog({ title: 'Wirklich entfernen?', text: 'Die Verbindung wird gelöscht. Ihr könnt später erneut anfragen.', ok: 'Entfernen', danger: true });
  if (!ok) return;
  const { error } = await sb.from('friendships').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  toast(msg || 'Entfernt');
  refresh();
}

async function blockFriend(id) {
  const ok = await confirmDialog({
    title: 'Nutzer blockieren?',
    text: 'Die Person kann dir keine neue Freundschaftsanfrage schicken und sieht deinen Kalender nicht mehr.',
    ok: 'Blockieren',
    danger: true
  });
  if (!ok) return;
  const { error } = await sb.from('friendships')
    .update({ status: 'blocked', responded_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return toast(error.message, 'err');
  toast('Nutzer blockiert');
  refresh();
}

/* ================= Freundes-/öffentlicher Kalender ================= */
function calendarItemsFor(events, color, range, maskPrivate = true) {
  const out = [];
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  for (const ev of events) {
    for (const o of occurrences(ev, range.start, range.end)) {
      if (new Date(o.end_at).getTime() < cutoff) continue;
      out.push({
        ...o,
        color,
        cls: ev.is_private && maskPrivate ? 'busy' : '',
        title: ev.is_private && maskPrivate ? 'Belegt' : ev.title
      });
    }
  }
  return out.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
}

async function viewFriendCalendar(id) {
  app.innerHTML = '<div class="boot"><span class="spinner"></span></div>';
  const { data, error } = await sb.rpc('friend_calendar', { p_friend: id });
  if (error) {
    toast(error.message, 'err');
    return page('friends', `<div class="card empty"><b>⚠️</b>Kalender konnte nicht geladen werden.<br><br><a class="btn" href="#/friends">Zurück</a></div>`);
  }
  if (!data) {
    return page('friends', `<div class="card empty"><b>🔒</b>Ihr seid nicht befreundet oder der Kalender existiert nicht.<br><br><a class="btn" href="#/friends">Zurück zu Freunden</a></div>`);
  }

  const p = data.profile;
  if (!data.allowed) {
    return page('friends', `
      <section class="hero-row">
        <div style="display:flex;gap:16px;align-items:center">${avatar(p)}
          <div><h1>${esc(p.display_name)}</h1><p class="muted">@${esc(p.username)}</p></div>
        </div>
      </section>
      <div class="card empty"><b>🔒</b>${esc(p.display_name)} hat den Kalender für Freunde deaktiviert.<br><br><a class="btn" href="#/friends">Zurück zu Freunden</a></div>`);
  }

  const events = data.events || [];
  const request = date => eventForm({ date: date || ymd(new Date()), target: p });
  shell('friends', `
    <section class="hero-row">
      <div style="display:flex;gap:16px;align-items:center">
        ${avatar(p)}
        <div><h1>${esc(p.display_name)}</h1><p class="muted">@${esc(p.username)} · Freundeskalender</p></div>
      </div>
      <div class="actions"><button class="btn" id="friend-request" data-sfx="success">📩 Termin anfragen</button></div>
    </section>
    <div class="card cal-card" id="cal"></div>
    <div class="cal-foot"><span class="muted">🔒 Private Termine werden nur als „Belegt“ angezeigt</span><span class="muted">↻ Serientermin</span></div>
    <p class="muted" style="margin-top:14px;text-align:center">Klicke auf einen Tag, um dort eine Anfrage zu stellen.</p>`);
  $('#friend-request').onclick = () => request();
  bindCal($('#cal'), (range) => calendarItemsFor(events, p.color || '#6366f1', range), {
    onDay: request,
    onEvent: (eid, occ) => {
      const base = events.find(e => e.id === eid);
      if (base) showSharedEvent(occurrenceAt(base, occ), p);
    }
  });
}

async function viewPublic(username) {
  app.innerHTML = '<div class="boot"><span class="spinner"></span></div>';
  const { data } = await sb.rpc('public_calendar', { p_username: username });
  if (!data) {
    return page('', `<div class="card empty"><b>🕵️</b>Dieser Kalender existiert nicht oder ist nicht öffentlich.<br><br><a class="btn" href="#/">Zur Startseite</a></div>`);
  }
  const p = data.profile;
  const own = S.user?.id === p.id;
  const events = data.events || [];
  const request = date => {
    if (own) return toast('Das ist dein eigener Kalender');
    if (!S.user) {
      sessionStorage.setItem('terminio-redirect', location.hash);
      toast('Bitte zuerst mit Discord anmelden', 'err');
      location.hash = '#/login';
      return;
    }
    eventForm({ date: date || ymd(new Date()), target: p });
  };

  page('', `
    <section class="hero-row">
      <div style="display:flex;gap:16px;align-items:center">
        ${avatar(p)}
        <div><h1>${esc(p.display_name)}</h1><p class="muted">@${esc(p.username)} · öffentlicher Kalender</p></div>
      </div>
      <div class="actions">${own ? '<a class="btn" href="#/">Zu meinem Kalender</a>' : '<button class="btn" id="pub-request">📩 Termin anfragen</button>'}</div>
    </section>
    <div class="card cal-card" id="pub-cal"></div>
    <p class="muted" style="margin-top:14px;text-align:center">Gestreifte Blöcke = belegt. Klicke auf einen Tag, um eine Anfrage zu stellen.</p>`);
  $('#pub-request')?.addEventListener('click', () => request());
  bindCal($('#pub-cal'), (range) => calendarItemsFor(events, p.color || '#6366f1', range), {
    onDay: request,
    onEvent: (eid, occ) => {
      const base = events.find(e => e.id === eid);
      if (base) showSharedEvent(occurrenceAt(base, occ), p);
    }
  });
}

function showSharedEvent(e, p) {
  if (e.is_private) {
    openModal(`<h3>Belegt</h3><div class="meta"><span>📅 <b>${fmtDate(e.start_at)}</b></span><span>🕒 <b>${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}</b></span></div><p class="muted">Dieser Termin ist privat.</p>`);
    return;
  }
  const series = e.recurrence && e.recurrence !== 'none';
  openModal(`
    <h3>${esc(e.title)}</h3>
    <div class="meta">
      <span>📅 <b>${fmtDate(e.start_at)}</b></span>
      <span>🕒 <b>${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}</b></span>
      ${series ? `<span>↻ <b>${esc(recurrenceText(e))}</b></span>` : ''}
      <span>👤 ${esc(p.display_name)}</span>
    </div>
    ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
    <div class="mrow">
      <button class="btn" id="shared-request">📩 Für diesen Tag anfragen</button>
    </div>`);
  $('#shared-request').onclick = () => {
    const d = ymd(new Date(e.start_at));
    const m = $('.modal-back');
    if (m) m.close();
    setTimeout(() => eventForm({ date: d, target: p }), 240);
  };
}

/* ================= Profil & Einstellungen ================= */
function notifPermissionText() {
  if (!('Notification' in window)) return 'Nicht unterstützt';
  return ({ granted: 'Aktiv', denied: 'Blockiert', default: 'Noch nicht erlaubt' })[Notification.permission] || 'Unbekannt';
}

function viewSettings() {
  const link = pubLink(S.me.username);
  const feed = feedUrl();
  const perm = notifPermissionText();
  shell('set', `
    <section class="hero-row">
      <div style="display:flex;gap:16px;align-items:center">
        ${avatar(S.me)}
        <div><h1>Profil & Einstellungen</h1><p class="muted">@${esc(S.me.username)} · angemeldet mit Discord</p></div>
      </div>
    </section>
    <div class="settings-grid">

      <div class="card">
        <h3>Profil</h3>
        <form id="sf" class="form">
          <label>Anzeigename<input name="display_name" value="${esc(S.me.display_name)}" required maxlength="60"></label>
          <label>Farbe<input type="color" name="color" value="${esc(S.me.color)}"></label>
          <label class="check"><input type="checkbox" name="share" ${S.me.share_enabled ? 'checked' : ''}> Öffentlichen Kalender-Link aktivieren</label>
          <label class="check"><input type="checkbox" name="friends" ${S.me.friends_can_view ? 'checked' : ''}> Freunde dürfen meinen Kalender sehen (außer private Termine)</label>
          <div class="label">Dein öffentlicher Link</div>
          <div class="linkbox"><input readonly value="${esc(link)}" id="lnk"><button type="button" class="ghost" id="cp">Kopieren</button></div>
          <button class="btn" type="submit" data-sfx="success">Speichern</button>
        </form>
      </div>

      <div class="card">
        <h3>Darstellung</h3>
        <p class="muted" style="margin-bottom:12px">Standard ist deine Systemeinstellung.</p>
        <div class="seg big" id="theme-seg">
          <button data-theme-choice="system">🖥️ System</button>
          <button data-theme-choice="light">☀️ Hell</button>
          <button data-theme-choice="dark">🌙 Dunkel</button>
        </div>
        <div class="divider"></div>
        <label class="switch-row">
          <span><b>Klick-Sounds</b><small>Kurze Töne bei Buttons</small></span>
          <input type="checkbox" id="sound-toggle" ${S.soundEnabled ? 'checked' : ''}>
        </label>
        <button class="ghost sm" id="sound-test" style="margin-top:10px">🔊 Ton testen</button>
      </div>

      <div class="card">
        <h3>Benachrichtigungen</h3>
        <div class="info-row"><span>Desktop</span><span class="badge-s ${('Notification' in window && Notification.permission === 'granted') ? 'accepted' : 'pending'}">${perm}</span></div>
        <div class="info-row"><span>Push (auch bei geschlossener App)</span><span class="badge-s ${S.pushEnabled ? 'accepted' : 'pending'}">${S.pushEnabled ? 'Aktiv' : 'Inaktiv'}</span></div>
        <div class="mrow">
          <button class="btn sm" id="desktop-btn">🖥️ Desktop aktivieren</button>
          <button class="btn sm" id="push-btn" ${VAPID_PUBLIC_KEY ? '' : 'disabled'}>📲 Push aktivieren</button>
          <button class="ghost sm" id="push-off">Push aus</button>
        </div>
        <div class="notice" style="margin-top:14px">Push benötigt die einmalige Einrichtung der Supabase Edge Function. Die Desktop-Benachrichtigung funktioniert direkt im Browser.</div>
      </div>

      <div class="card">
        <h3>Live-Abo</h3>
        <p class="muted" style="margin-bottom:12px">Dein Kalender als dauerhafte .ics-URL für Apple, Google, Outlook & Thunderbird.</p>
        <div class="linkbox"><input readonly value="${esc(feed)}" id="feed-lnk"><button class="ghost" id="feed-copy2">Kopieren</button></div>
        <div class="mrow">
          <button class="ghost sm" id="feed-open">📡 Abo einrichten</button>
          <button class="ghost sm" id="feed-reset2">Token erneuern</button>
        </div>
      </div>

      <div class="card">
        <h3>App installieren</h3>
        <p class="muted">Terminio als App auf Desktop, Android oder iPhone – die Website bleibt zusätzlich verfügbar.</p>
        <div class="mrow"><button class="btn" id="install-app">⬇ App installieren</button></div>
        <div class="notice" style="margin-top:14px">iPhone/iPad: Teilen → „Zum Home-Bildschirm“. Desktop/Android: Browser-Menü → „App installieren“.</div>
      </div>

      <div class="card">
        <h3>Discord & Account</h3>
        <div class="info-row"><span>Discord</span><b>${esc(S.me.discord_id || 'verbunden')}</b></div>
        <div class="info-row"><span>Status</span><span class="badge-s ${S.me.status === 'active' ? 'accepted' : 'declined'}">${USER_STATUS[S.me.status] || S.me.status}</span></div>
        <div class="mrow">
          <a class="ghost sm" href="${esc(pubLink(S.me.username))}" target="_blank" rel="noopener">Öffentliche Seite</a>
          <button class="ghost sm danger-text" id="logout">Abmelden</button>
        </div>
      </div>

    </div>`);

  applyTheme();
  $('#cp').onclick = () => copy(link);
  $('#lnk').onclick = e => e.target.select();
  $('#feed-copy2').onclick = () => copy(feed);
  $('#feed-lnk').onclick = e => e.target.select();
  $('#feed-open').onclick = openFeed;
  $('#feed-reset2').onclick = openFeed;
  $('#install-app').onclick = installApp;
  $('#logout').onclick = logout;

  $$('#theme-seg [data-theme-choice]').forEach(b => b.onclick = () => {
    setTheme(b.dataset.themeChoice);
    applyTheme();
  });

  $('#sound-test').onclick = () => playSfx('success');
  $('#sound-toggle').onchange = async e => {
    S.soundEnabled = e.target.checked;
    if (S.me) S.me.sound_enabled = S.soundEnabled;
    if (S.soundEnabled) playSfx('success');
    await sb.from('profiles').update({ sound_enabled: S.soundEnabled }).eq('id', S.user.id);
  };

  $('#desktop-btn').onclick = async () => {
    await requestDesktopNotifications(false);
    viewSettings();
  };
  $('#push-btn').onclick = async () => {
    const ok = await enablePush();
    if (ok) viewSettings();
  };
  $('#push-off').onclick = async () => { await disablePush(); viewSettings(); };

  $('#sf').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const { error } = await sb.from('profiles').update({
      display_name: f.get('display_name').trim(),
      color: f.get('color'),
      share_enabled: !!f.get('share'),
      friends_can_view: !!f.get('friends')
    }).eq('id', S.user.id);
    if (error) return toast(error.message, 'err');
    toast('Gespeichert ✓');
    playSfx('success');
    refresh();
  };
}

/* ================= Admin ================= */
function viewAdmin() {
  if (!S.me?.is_admin) { location.hash = '#/'; return; }
  shell('admin', `
    <section class="hero-row">
      <div><h1>Admin-Menü</h1><p class="muted">Accounts deaktivieren, sperren und Rechte verwalten</p></div>
    </section>
    <div class="admin-stats" id="admin-stats"></div>
    <div class="card">
      <div class="admin-tools">
        <input id="admin-search" placeholder="Nutzer suchen…" autocomplete="off">
        <button class="ghost" id="admin-reload">↻ Aktualisieren</button>
      </div>
      <div id="admin-box"><div class="boot small"><span class="spinner"></span></div></div>
    </div>`);
  $('#admin-reload').onclick = loadAdmin;
  $('#admin-search').oninput = e => {
    const q = e.target.value.toLowerCase();
    $$('.admin-row').forEach(r => { r.style.display = r.dataset.name.includes(q) ? '' : 'none'; });
  };
  loadAdmin();
}

async function loadAdmin() {
  const box = $('#admin-box');
  if (!box) return;
  box.innerHTML = '<div class="boot small"><span class="spinner"></span></div>';
  const { data, error } = await sb.rpc('admin_list_users');
  if (error) {
    box.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    return;
  }
  const users = data || [];
  const stats = {
    total: users.length,
    active: users.filter(u => u.status === 'active').length,
    disabled: users.filter(u => u.status === 'disabled').length,
    banned: users.filter(u => u.status === 'banned').length,
    admins: users.filter(u => u.is_admin).length
  };
  const st = $('#admin-stats');
  if (st) st.innerHTML = `
    <div class="stat"><b>${stats.total}</b><span>Accounts</span></div>
    <div class="stat ok"><b>${stats.active}</b><span>Aktiv</span></div>
    <div class="stat warn"><b>${stats.disabled}</b><span>Deaktiviert</span></div>
    <div class="stat err"><b>${stats.banned}</b><span>Gesperrt</span></div>
    <div class="stat"><b>${stats.admins}</b><span>Admins</span></div>`;

  box.innerHTML = users.map(u => {
    const self = u.id === S.user.id;
    return `<div class="admin-row" data-name="${esc((u.display_name + ' ' + u.username).toLowerCase())}">
      ${avatar(u)}
      <div class="grow">
        <h4>${esc(u.display_name)} ${u.is_admin ? '<span class="badge-s accepted">Admin</span>' : ''} ${self ? '<span class="badge-s pending">Du</span>' : ''}</h4>
        <p>@${esc(u.username)} · ${u.event_count} Termine · ${u.friend_count} Freunde · seit ${fmtShort(u.created_at)}</p>
        ${u.status_reason ? `<p class="reason">Grund: ${esc(u.status_reason)}</p>` : ''}
      </div>
      <span class="badge-s ${u.status === 'active' ? 'accepted' : 'declined'}">${USER_STATUS[u.status] || u.status}</span>
      <div class="btns">
        ${u.status !== 'active' ? `<button class="btn ok sm" data-admin-status="active" data-id="${u.id}" data-name="${esc(u.display_name)}" ${self ? 'disabled' : ''}>Freischalten</button>` : ''}
        ${u.status !== 'disabled' ? `<button class="ghost sm" data-admin-status="disabled" data-id="${u.id}" data-name="${esc(u.display_name)}" ${self ? 'disabled' : ''}>Deaktivieren</button>` : ''}
        ${u.status !== 'banned' ? `<button class="btn danger sm" data-admin-status="banned" data-id="${u.id}" data-name="${esc(u.display_name)}" ${self ? 'disabled' : ''}>Sperren</button>` : ''}
        ${!self ? `<button class="ghost sm" data-admin-flag="${u.is_admin ? '0' : '1'}" data-id="${u.id}" data-name="${esc(u.display_name)}">${u.is_admin ? 'Admin entziehen' : 'Zum Admin'}</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<div class="empty">Keine Nutzer gefunden.</div>';

  $$('[data-admin-status]', box).forEach(b => b.onclick = () => adminStatus(b.dataset.id, b.dataset.adminStatus, b.dataset.name));
  $$('[data-admin-flag]', box).forEach(b => b.onclick = () => adminFlag(b.dataset.id, b.dataset.adminFlag === '1', b.dataset.name));
}

async function adminStatus(id, status, name) {
  let reason = '';
  if (status !== 'active') {
    const result = await new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const m = openModal(`<h3>${status === 'banned' ? 'Account sperren' : 'Account deaktivieren'}</h3>
        <p class="muted" style="margin-bottom:14px">${esc(name)}</p>
        <form class="form" id="asf">
          <label>Grund <small>(optional, wird dem Nutzer angezeigt)</small><textarea name="reason" rows="3"></textarea></label>
          <button class="btn ${status === 'banned' ? 'danger' : ''}" type="submit">${status === 'banned' ? 'Sperren' : 'Deaktivieren'}</button>
        </form>`, false, () => finish(null));
      $('#asf', m).onsubmit = ev => {
        ev.preventDefault();
        const r = new FormData(ev.target).get('reason').trim();
        finish({ reason: r });
        m.close();
      };
    });
    if (!result) return;
    reason = result.reason;
  } else {
    const ok = await confirmDialog({ title: 'Account freischalten?', text: `${name} erhält wieder vollen Zugriff.`, ok: 'Freischalten' });
    if (!ok) return;
  }
  const { error } = await sb.rpc('admin_set_status', { p_user: id, p_status: status, p_reason: reason || null });
  if (error) return toast(error.message, 'err');
  toast(status === 'active' ? 'Account freigeschaltet' : status === 'banned' ? 'Account gesperrt' : 'Account deaktiviert');
  playSfx(status === 'active' ? 'success' : 'error');
  loadAdmin();
}

async function adminFlag(id, flag, name) {
  const ok = await confirmDialog({
    title: flag ? 'Zum Admin machen?' : 'Adminrechte entziehen?',
    text: flag ? `${name} erhält Zugriff auf das Admin-Menü.` : `${name} verliert den Zugriff auf das Admin-Menü.`,
    ok: flag ? 'Zum Admin machen' : 'Rechte entziehen',
    danger: !flag
  });
  if (!ok) return;
  const { error } = await sb.rpc('admin_set_admin', { p_user: id, p_flag: flag });
  if (error) return toast(error.message, 'err');
  toast(flag ? 'Adminrechte vergeben ✓' : 'Adminrechte entzogen');
  loadAdmin();
}

/* ================= Login / Registrierung (nur Discord) ================= */
function viewAuth() {
  app.innerHTML = `
  <button class="icon auth-theme" id="theme" title="Design wechseln" aria-label="Design">${themeIcon()}</button>
  <main class="auth-wrap">
    <section class="hero">
      <a class="brand" href="#/">${logo()}<span>Terminio</span></a>
      <h1>Dein Kalender.<br><span class="grad">Deine Leute.</span></h1>
      <p>Ein Kalender, der mit deinen Freunden denkt: Serientermine, Freundeskalender, Live-Abo und Erinnerungen – direkt in deinem Browser und als App.</p>
      <ul class="features">
        <li>🎮 Login ausschließlich mit Discord</li>
        <li>🔁 Serientermine – täglich, wöchentlich, monatlich</li>
        <li>👥 Freundeskalender – private Termine bleiben privat</li>
        <li>📡 Live-Abo für Apple, Google & Outlook</li>
        <li>🔔 Desktop- & Push-Benachrichtigungen</li>
        <li>📱 Installierbar auf Handy und Desktop</li>
      </ul>
    </section>
    <section class="card auth">
      <div class="auth-logo">${logo()}</div>
      <h2>Willkommen bei Terminio</h2>
      <p class="muted" style="margin:8px 0 22px">Melde dich mit deinem Discord-Account an. Kein Passwort, keine E-Mail-Registrierung.</p>
      <button class="btn discord" id="discord-login" data-sfx="success">
        <span class="discord-icon">${discordIcon()}</span> Mit Discord anmelden
      </button>
      ${DISCORD_INVITE ? `<a class="ghost" style="margin-top:12px;display:flex;justify-content:center" href="${esc(DISCORD_INVITE)}" target="_blank" rel="noopener">Discord-Server öffnen</a>` : ''}
      <div class="notice" style="margin-top:20px">
        Beim ersten Login wird automatisch dein Terminio-Profil aus deinem Discord-Namen erstellt.
        Deine Termine werden nach ${RETENTION_DAYS} Tagen automatisch gelöscht.
      </div>
      <p class="hint" style="margin-top:18px">Mit der Anmeldung stimmst du zu, dass dein Discord-Anzeigename und Profilbild in Terminio verwendet werden.</p>
    </section>
  </main>`;
  $('#discord-login').onclick = loginDiscord;
  $('#theme').onclick = openTheme;
  applyTheme();
}

function discordIcon() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.2a18.3 18.3 0 0 0-5.6 0L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.7 9.1-.1 13.7.3 18.2a20 20 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 11.8 0l.5.4a12.7 12.7 0 0 1-2 1l1.3 2a20 20 0 0 0 6-3c.5-5.2-.8-9.8-3.4-13.8ZM8.1 15.5c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7.8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>`;
}

async function loginDiscord() {
  sessionStorage.setItem('terminio-redirect', location.hash || '#/');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: location.origin + location.pathname,
      scopes: 'identify email'
    }
  });
  if (error) toast('Discord-Login fehlgeschlagen: ' + error.message, 'err');
}

/* ================= Gesperrter Account ================= */
function renderBlocked() {
  stopPolling();
  const banned = S.me.status === 'banned';
  app.innerHTML = `
    <main class="blocked-wrap">
      <div class="card blocked-card">
        <a class="brand" href="#/">${logo()}<span>Terminio</span></a>
        <div class="blocked-icon">${banned ? '🚫' : '⏸️'}</div>
        <h1>${banned ? 'Account gesperrt' : 'Account deaktiviert'}</h1>
        <p class="muted">${banned
          ? 'Dein Zugang wurde von einem Administrator gesperrt.'
          : 'Dein Zugang wurde vorübergehend deaktiviert.'}</p>
        ${S.me.status_reason ? `<div class="notice">Grund: ${esc(S.me.status_reason)}</div>` : ''}
        <p class="hint">Bei Fragen wende dich an einen Administrator.</p>
        <button class="btn danger" id="blocked-logout">Abmelden</button>
      </div>
    </main>`;
  $('#blocked-logout').onclick = logout;
  applyTheme();
}

async function logout() {
  stopPolling();
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
    }
  } catch (e) {}
  try { await sb.auth.signOut(); } catch (e) {}
  S.user = null; S.me = null; S.profiles = []; S.events = []; S.friendships = []; S.notifs = []; S.notifSeen = null;
  location.hash = '#/';
  viewAuth();
}

/* ================= Router ================= */
function closeAllModals() {
  $$('.modal-back').forEach(m => m.close && m.close());
}

function route() {
  const h = location.hash.slice(1) || '/';
  const [, a, b] = h.split('/');

  closeAllModals();

  if (S.user && S.me && S.me.status !== 'active') return renderBlocked();

  if (a === 'u' && b) return viewPublic(decodeURIComponent(b).toLowerCase());

  if (!S.user) {
    if (a === 'f') sessionStorage.setItem('terminio-redirect', location.hash);
    return viewAuth();
  }
  if (a === 'login') { location.hash = '#/'; return; }
  if (a === 'f' && b) return viewFriendCalendar(b);
  if (a === 'friends') return viewFriends();
  if (a === 'requests') return viewRequests();
  if (a === 'settings') return viewSettings();
  if (a === 'admin') return viewAdmin();
  if (a === 'event' && b) {
    viewCalendar();
    history.replaceState(null, '', '#/');
    showEvent(b);
    return;
  }
  if (a === 'new') {
    viewCalendar();
    history.replaceState(null, '', '#/');
    eventForm();
    return;
  }
  return viewCalendar();
}
window.addEventListener('hashchange', route);

/* ================= Boot ================= */
async function boot() {
  registerSW();

  const u = new URL(location.href);
  const oauthError = u.searchParams.get('error_description') || u.searchParams.get('error');
  if (oauthError) {
    toast('Discord-Anmeldung: ' + oauthError, 'err');
    history.replaceState(null, '', u.pathname + (u.hash || '#/'));
  }

  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null;

  if (!S.user) { route(); return; }

  try {
    await loadMe();
    if (!S.me || S.me.status !== 'active') return renderBlocked();
    await loadAll();
    startPolling();
    syncPush();

    const back = sessionStorage.getItem('terminio-redirect');
    if (back) {
      sessionStorage.removeItem('terminio-redirect');
      if (!location.hash || location.hash === '#/' || location.hash === '#/login') {
        location.hash = back;
        return;
      }
    }
    route();
  } catch (e) {
    app.innerHTML = `<main class="blocked-wrap"><div class="card blocked-card">
      <a class="brand" href="#/">${logo()}<span>Terminio</span></a>
      <div class="blocked-icon">⚠️</div>
      <h1>Etwas ist schiefgelaufen</h1>
      <p class="muted">${esc(e.message || e)}</p>
      <div class="mrow" style="justify-content:center">
        <button class="btn" id="retry-boot">Erneut versuchen</button>
        <button class="ghost" id="boot-logout">Abmelden</button>
      </div>
    </div></main>`;
    $('#retry-boot').onclick = () => { app.innerHTML = '<div class="boot"><span class="spinner"></span></div>'; boot(); };
    $('#boot-logout').onclick = logout;
  }
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && S.user) {
    S.user = null; S.me = null; S.events = []; S.notifs = []; S.friendships = [];
    stopPolling();
    route();
  }
});

boot();





