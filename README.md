# Terminio

Moderner, teilbarer Kalender als installierbare Web-App (PWA) mit Supabase-Backend.

**Login ausschließlich per Discord** · Serientermine · Freundeskalender · Live-ICS-Abo · Desktop- & Push-Benachrichtigungen · Admin-Menü · automatische Löschung nach 14 Tagen.

---

## 1. Was ist neu?

| Bereich | Umsetzung |
|---|---|
| Login | Nur Discord OAuth über Supabase Auth. Kein E-Mail-/Passwort-Login. |
| Serientermine | Täglich / wöchentlich / monatlich / jährlich, mit Intervall und Serienende. Ganze Serie wird in `.ics` als `RRULE` exportiert. |
| Aufbewahrung | Termine sind max. 14 Tage rückwirkend sichtbar. Ein `pg_cron`-Job löscht alles, was länger als 14 Tage zurückliegt. |
| Freunde | Anfragen senden/annehmen/ablehnen/blockieren. Freunde sehen alle Termine **außer privaten** (die erscheinen als „Belegt“). Freigabe pro Nutzer abschaltbar. |
| Live-Abo | Tokenisierte `.ics`-URL über die Edge Function `ics` – für Apple Kalender, Google Kalender, Outlook & Thunderbird. |
| Benachrichtigungen | Desktop-Benachrichtigungen direkt im Browser + echtes Web-Push über `push-notify` (auch bei geschlossener App). |
| Überschneidungen | Termine dürfen sich überschneiden, aber beim Speichern/Zusagen erscheint ein Bestätigungshinweis. |
| PWA | Installierbar auf Desktop, Android und iPhone. Website bleibt normal nutzbar. |
| Design | Neues Logo, System/Hell/Dunkel-Umschalter, Klick-Sounds für Buttons, moderne Glass-Optik. |
| Admin | Account deaktivieren, sperren, freischalten, Adminrechte vergeben/entziehen. |
| Sicherheit | RLS prüft Account-Status. Gesperrte/deaktivierte Nutzer sehen eine Sperrseite und keine Daten. |

---

## 2. Discord-Login einrichten

### Discord Developer Portal

1. https://discord.com/developers/applications → deine App öffnen.
2. **OAuth2 → Redirects** hinzufügen:
   ```
   https://uzofkignqhcktbctoteb.supabase.co/auth/v1/callback
   ```
3. Client ID und Client Secret notieren.

> Der „öffentliche Schlüssel“ aus dem Discord-Portal wird für den normalen OAuth-Login **nicht** benötigt. Er ist nur für einen Discord-Interactions-Bot relevant.

### Supabase

1. **Authentication → Providers → Discord** aktivieren.
2. Client ID und Client Secret eintragen.
3. **Authentication → Providers → Email** deaktivieren (damit Login wirklich nur über Discord läuft).
4. **Authentication → URL Configuration**
   - Site URL: `https://jggaming25.github.io/Terminio/`
   - Redirect URLs: `https://jggaming25.github.io/Terminio/**` und für lokal z. B. `http://localhost:8000/**`

> Wichtig: Das Client Secret wurde im Chat geteilt. Rotiere es im Discord-Portal und trage nur das neue Secret in Supabase ein. Es gehört **nicht** ins Repository.

---

## 3. Datenbank einrichten

1. Supabase → **SQL Editor** → `schema.sql` komplett einfügen → **Run**.
2. Das Skript ist idempotent und kann auch auf ein bestehendes Terminio-Projekt angewendet werden.
3. Nach dem ersten Discord-Login den ersten Admin setzen:
   ```sql
   update public.profiles
      set is_admin = true
    where username = 'dein-benutzername';
   ```
   Den Benutzernamen findest du in der Tabelle `profiles`.

Enthalten sind u. a.:
- `friendships`, `push_subscriptions`, Serienfelder in `events`
- RLS-Policies inkl. Statusprüfung (`active` / `disabled` / `banned`)
- `public_calendar`, `friend_calendar`, `calendar_feed`
- Admin-RPCs `admin_list_users`, `admin_set_status`, `admin_set_admin`
- `cleanup_old_events()` + täglicher `pg_cron`-Job um 03:15 Uhr

Falls `pg_cron` in deinem Projekt nicht verfügbar ist, kann der Job auch manuell im Dashboard unter **Database → Cron Jobs** angelegt werden:
```sql
select public.cleanup_old_events();
```
Zeitplan: täglich.

---

## 4. Edge Functions (Live-Abo & Push)

Voraussetzungen: [Supabase CLI](https://supabase.com/docs/guides/cli) und ein verlinktes Projekt.

```bash
supabase login
supabase link --project-ref uzofkignqhcktbctoteb

# Secrets aus der lokalen Datei setzen (nicht committen!)
supabase secrets set --env-file supabase/.env.local

# Funktionen deployen
supabase functions deploy ics --no-verify-jwt
supabase functions deploy push-notify --no-verify-jwt
```

### Live-Abo testen

Nach dem Login in Terminio unter **Profil → Live-Abo → Abo einrichten** die URL kopieren:

```
https://uzofkignqhcktbctoteb.supabase.co/functions/v1/ics?token=DEIN_TOKEN
```

In Google Kalender: *Weitere Kalender → Per URL hinzufügen*.
In Apple Kalender: *Ablage → Neues Kalender-Abo*.

### Push-Benachrichtigungen aktivieren

1. Edge Function `push-notify` ist deployed.
2. Supabase → **Database → Webhooks** → **Create a new hook**
   - Tabelle: `notifications`
   - Event: `INSERT`
   - Typ: HTTP Request
   - URL: `https://uzofkignqhcktbctoteb.supabase.co/functions/v1/push-notify`
   - HTTP-Header: `x-webhook-secret: <PUSH_WEBHOOK_SECRET aus supabase/.env.local>`
3. In Terminio unter **Profil → Benachrichtigungen → Push aktivieren**.

Ohne diese Einrichtung funktionieren die **Desktop-Benachrichtigungen** trotzdem, solange Terminio im Browser geöffnet ist. Web-Push weckt die installierte App auch, wenn sie geschlossen ist.

---

## 5. Lokal starten

Da die App ES-Module und einen Service Worker nutzt, braucht sie einen HTTP-Server (kein Doppelklick auf `index.html`):

```bash
python -m http.server 8000
# oder
npx serve .
```

Dann `http://localhost:8000` öffnen.

---

## 6. GitHub Pages

1. Alle Dateien ins Repository `jggaming25/Terminio` pushen.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Die App läuft unter `https://jggaming25.github.io/Terminio/`.
4. Diese URL in Supabase als Site URL und Redirect URL eintragen.

`supabase/.env.local` ist per `.gitignore` ausgeschlossen und darf **niemals** hochgeladen werden.

---

## 7. Bedienung

- **Kalender**: Tag anklicken → Termin anlegen. Serienwiederholung im Formular wählen.
- **Freunde**: Anfrage senden. Nach Annahme erscheint der Kalender des anderen (private Termine als „Belegt“).
- **Freigabe**: Profil → „Freunde dürfen meinen Kalender sehen“.
- **Anfragen**: Eingehende Termine zusagen/ablehnen, gesendete verfolgen.
- **Live-Abo**: dauerhafte `.ics`-URL, inkl. Serienterminen.
- **Admin**: nur für Accounts mit `is_admin = true`. Deaktivieren = vorübergehend, Sperren = dauerhaft bis zur Freischaltung.
- **Design**: Standard = Systemeinstellung, manuell auf Hell/Dunkel umschaltbar.
- **Sounds**: Klick-Sounds für Buttons, in den Einstellungen abschaltbar.
- **App installieren**: Button in der Navigation bzw. im Browser-Menü. iPhone: Teilen → „Zum Home-Bildschirm“.

---

## 8. Wichtige Dateien

```
index.html                  App-Shell, PWA-Metadaten
app.js                      komplette Anwendung
style.css                   Design (Hell/Dunkel, responsive)
config.js                   Supabase-URL, Publishable Key, VAPID Public Key
schema.sql                  Datenbank, RLS, RPCs, Cron
sw.js                       Service Worker (PWA, Push, Offline)
manifest.webmanifest        Installierbare App
assets/                     Logo + Icons
vendor/supabase.js          Selbst gehosteter Supabase-Client (offline-fähig)
supabase/functions/ics/     Live-ICS-Abo
supabase/functions/push-notify/ Web-Push
supabase/.env.local         Secrets (gitignored)
```

---

## 9. Sicherheit & Grenzen

- Der Supabase **Publishable Key** ist öffentlich. Der Schutz erfolgt über RLS-Policies.
- Sensible Profilfelder (`feed_token`, `discord_id`, Theme/Sound) sind zusätzlich per Spaltenrechten geschützt. Das eigene vollständige Profil liefert nur die RPC `my_profile()`.
- Der Discord **Client Secret** und der **VAPID Private Key** gehören nur in Supabase/Discord, nie ins Repo.
- Gesperrte/deaktivierte Accounts werden durch RLS an allen Datenzugriffen gehindert. Die Auth-Session selbst bleibt bestehen, bis der Nutzer sich abmeldet.
- Die 14-Tage-Löschung läuft täglich per `pg_cron`. Zusätzlich filtern alle Kalender-RPCs und die UI auf 14 Tage Rückblick.
- Web-Push benötigt HTTPS (GitHub Pages/localhost erfüllen das).
