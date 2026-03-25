# Google Calendar Integration — Implementation Spec
_Taskify v1 — Read-only, webhook push sync_

---

## 0. Guiding constraints

1. **User isolation is non-negotiable.** Every DB query, token lookup, and API response must be scoped to a verified `npub`. There must be no path where Worker code can accidentally return one user's events to another.
2. **No secrets on the client.** The PWA only ever knows: connection status, which calendars are enabled, sync health, and last-synced time. It never sees OAuth tokens.
3. **Tokens encrypted at rest.** Refresh tokens stored in D1 are AES-256-GCM encrypted using a `GCAL_TOKEN_ENCRYPTION_KEY` Worker secret. The Worker decrypts in-memory only.
4. **Read-only v1.** No write operations to Google Calendar. No creating/editing Google events from Taskify.
5. **Client-side merge.** The Worker caches normalized Google events in D1. The PWA merges them with its local Nostr/IDB data. The Worker never touches Nostr keys.

---

## 1. New Worker secrets (wrangler.toml / Cloudflare dashboard)

```toml
# Add to wrangler.toml [vars] section — values set as encrypted secrets in CF dashboard:
# GCAL_CLIENT_ID         — Google OAuth2 client ID
# GCAL_CLIENT_SECRET     — Google OAuth2 client secret (encrypted secret, not plain var)
# GCAL_TOKEN_ENC_KEY     — 32-byte hex AES key for encrypting refresh tokens at rest
# GCAL_WEBHOOK_SECRET    — random 32-byte hex token, validated on every push notification
```

Never commit values. Set via `wrangler secret put` or the Cloudflare dashboard.

---

## 2. D1 migrations

### `0003_gcal_integration.sql`

```sql
PRAGMA foreign_keys = ON;

-- ── OAuth connections ────────────────────────────────────────────────────────
-- One row per Taskify user who has connected Google Calendar.
-- refresh_token_enc: AES-256-GCM encrypted, base64url encoded.
-- token_iv + token_tag stored alongside for decryption.
CREATE TABLE IF NOT EXISTS gcal_connections (
  npub              TEXT    NOT NULL PRIMARY KEY,
  google_email      TEXT    NOT NULL,
  access_token_enc  TEXT    NOT NULL,   -- short-lived, encrypted
  refresh_token_enc TEXT    NOT NULL,   -- long-lived, encrypted
  token_iv          TEXT    NOT NULL,   -- base64url, 12 bytes
  token_tag         TEXT    NOT NULL,   -- base64url, 16 bytes (for refresh token)
  token_expiry      INTEGER NOT NULL,   -- unix seconds
  scopes            TEXT    NOT NULL,   -- space-separated
  status            TEXT    NOT NULL DEFAULT 'active',
  -- status values: active | token_expired | needs_reauth | sync_failed | disconnected
  last_sync_at      INTEGER,
  last_error        TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── External calendars ───────────────────────────────────────────────────────
-- One row per Google calendar visible to the connected account.
CREATE TABLE IF NOT EXISTS gcal_calendars (
  id                TEXT    NOT NULL PRIMARY KEY,  -- uuid, Taskify-generated
  npub              TEXT    NOT NULL,
  provider_cal_id   TEXT    NOT NULL,              -- Google calendarId
  name              TEXT    NOT NULL,
  primary_cal       INTEGER NOT NULL DEFAULT 0,    -- 1 = primary
  selected          INTEGER NOT NULL DEFAULT 1,    -- user toggle
  color             TEXT,
  timezone          TEXT,
  sync_token        TEXT,                          -- Google incremental sync token
  watch_channel_id  TEXT,                          -- Google push channel id
  watch_expiry      INTEGER,                       -- unix seconds, renew before expiry
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (npub, provider_cal_id),
  FOREIGN KEY (npub) REFERENCES gcal_connections(npub) ON DELETE CASCADE
);

-- ── Normalized external events ───────────────────────────────────────────────
-- Taskify-side cache of Google Calendar events.
-- Scoped by npub + calendar. Rebuilt/updated on incremental sync.
CREATE TABLE IF NOT EXISTS gcal_events (
  id                  TEXT    NOT NULL PRIMARY KEY,  -- uuid, Taskify-generated
  npub                TEXT    NOT NULL,
  calendar_id         TEXT    NOT NULL,              -- → gcal_calendars.id
  provider_event_id   TEXT    NOT NULL,
  title               TEXT    NOT NULL DEFAULT '',
  description         TEXT,
  location            TEXT,
  start_iso           TEXT    NOT NULL,
  end_iso             TEXT,
  all_day             INTEGER NOT NULL DEFAULT 0,
  source_timezone     TEXT,
  status              TEXT    NOT NULL DEFAULT 'confirmed',
  -- status: confirmed | tentative | cancelled
  html_link           TEXT,
  attendees_summary   TEXT,
  recurrence_id       TEXT,
  is_recurring        INTEGER NOT NULL DEFAULT 0,
  last_modified       TEXT,
  raw_json            TEXT,                          -- full Google event payload for future use
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (npub, calendar_id, provider_event_id),
  FOREIGN KEY (npub) REFERENCES gcal_connections(npub) ON DELETE CASCADE,
  FOREIGN KEY (calendar_id) REFERENCES gcal_calendars(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gcal_events_npub_start ON gcal_events(npub, start_iso);
CREATE INDEX IF NOT EXISTS idx_gcal_events_calendar   ON gcal_events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_gcal_calendars_npub    ON gcal_calendars(npub);
```

---

## 3. Normalized event shape (PWA contract)

This is the shape the PWA receives from `/api/gcal/events`. It is also used internally for client-side merge.

```ts
// shared type — lives in taskify-core or a new taskify-calendar-types package
type ExternalCalendarEvent = {
  kind: "calendar_event";
  source: "google";                // future: "apple" | "outlook"
  id: string;                      // Taskify-generated uuid
  providerEventId: string;
  calendarId: string;              // Taskify gcal_calendars.id
  calendarName: string;
  calendarColor?: string;
  title: string;
  description?: string;
  location?: string;
  startISO: string;                // ISO 8601, UTC
  endISO?: string;
  allDay: boolean;
  sourceTimezone?: string;
  status: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  isRecurring: boolean;
  readonly: true;                  // v1 always true
};
```

---

## 4. Worker API endpoints

### Auth flow

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/gcal/auth/url` | Generate Google OAuth URL. Returns `{ url }`. Requires authenticated npub in `X-Taskify-Npub` header. |
| `GET`  | `/api/gcal/auth/callback` | OAuth redirect target. Exchanges code for tokens, encrypts, stores in D1. Redirects to PWA with `?gcal=connected`. |
| `DELETE` | `/api/gcal/connection` | Disconnect. Deletes connection + all calendars + all events for the npub. |

### Connection status

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/gcal/status` | Returns connection status for authenticated npub: `{ connected, status, googleEmail, lastSyncAt, lastError }` |

### Calendars

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/gcal/calendars` | List calendars for npub. Returns array of `{ id, name, primary, selected, color, timezone }` |
| `PATCH` | `/api/gcal/calendars/:id` | Toggle `selected` for a calendar. Body: `{ selected: boolean }` |

### Events

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/gcal/events` | Return cached events for npub's selected calendars. Query params: `?from=ISO&to=ISO`. Default window: today − 7d to today + 90d. |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/gcal/sync` | Trigger incremental sync for npub. Returns `{ synced, errors }`. |
| `POST` | `/api/gcal/webhook/:channelId` | Google push notification endpoint. Validates `X-Goog-Channel-Token` against `GCAL_WEBHOOK_SECRET`. Enqueues sync for the affected npub/calendar. |

---

## 5. Security model — detailed

### User identity / auth

Every `/api/gcal/*` endpoint (except `/callback` and `/webhook`) requires:
- `X-Taskify-Npub` header: the user's Nostr public key (npub or hex)
- `X-Taskify-Sig` header: signature of the request body (or empty string) with the user's Nostr key, verified by the Worker using NIP-01 event signing

This is the same auth pattern already used by the voice quota endpoints. The Worker verifies the signature before touching any DB row. If verification fails → `401`.

**Every D1 query that touches `gcal_connections`, `gcal_calendars`, or `gcal_events` must include `WHERE npub = ?` with the verified npub.** No exceptions.

### Token encryption

```
key    = hex.decode(env.GCAL_TOKEN_ENC_KEY)  // 32 bytes from CF secret
iv     = crypto.getRandomValues(12 bytes)
cipher = AES-256-GCM(key, iv)
enc    = cipher.encrypt(token_bytes)
tag    = cipher.getAuthTag()  // 16 bytes

stored as:
  access_token_enc  = base64url(enc)
  refresh_token_enc = base64url(enc)   // separate encryption per token
  token_iv          = base64url(iv)
  token_tag         = base64url(tag)
```

Decryption is in-memory only, never logged, never returned to the client.

### Webhook validation

Google push notifications arrive at `/api/gcal/webhook/:channelId`.

Validation steps:
1. Check `X-Goog-Channel-Token` === `GCAL_WEBHOOK_SECRET` → else `403`
2. Verify `X-Goog-Channel-Id` matches a known `watch_channel_id` in `gcal_calendars` → else `404`
3. Look up the `npub` from `gcal_calendars WHERE watch_channel_id = ?` → scoped sync
4. Only sync the specific calendar that triggered the notification

### Isolation invariant

The Worker must never have a code path where:
- a token from user A could be used to fetch data for user B
- events from user A could appear in user B's `/api/gcal/events` response

Enforcement: every helper function that touches D1 takes `npub` as a required first argument. No global state, no shared token cache.

---

## 6. Token refresh lifecycle

On every request that uses an access token:
1. Check `token_expiry` (from D1) vs `Date.now()`
2. If expiry < now + 5 min → refresh using stored refresh token
3. Re-encrypt and update D1: `access_token_enc`, `token_iv`, `token_tag`, `token_expiry`
4. On refresh failure (400/401 from Google) → set `status = 'needs_reauth'`, clear access token
5. Return `401` with `{ error: 'reauth_required' }` to client

---

## 7. Sync strategy

### Initial sync (on connect)

1. Fetch Google calendar list → upsert into `gcal_calendars`
2. For each calendar: fetch events in window (today − 7d to today + 90d)
3. Store sync token per calendar
4. Register push watch channel per calendar (expiry: 7 days; renew via cron)
5. Upsert events into `gcal_events`

### Incremental sync (on push notification or manual trigger)

1. Use stored `sync_token` to fetch only changed events since last sync
2. Upsert new/updated events; mark `status = 'cancelled'` for deleted events
3. Update `sync_token`
4. Update `last_sync_at` and clear `last_error` on success

### Cron (existing `*/1 * * * *` trigger, extend `scheduled()`)

- Renew expiring watch channels (watch_expiry < now + 24h)
- Sweep for connections with `status = 'sync_failed'` → retry once
- No full re-fetch unless sync_token is invalid (Google returns 410 Gone → re-init)

### Event edge cases

| Case | Handling |
|------|----------|
| All-day event | `all_day = 1`, `start_iso` = date string (`2026-03-26`), `end_iso` = date string. Never treat as midnight UTC. |
| Recurring event | Store each instance separately with `is_recurring = 1`, `recurrence_id` = master event id |
| Cancelled instance | Upsert with `status = 'cancelled'`; PWA filters these out of Upcoming |
| Multi-day event | `end_iso` > `start_iso`; PWA renders on all spanning days |
| No end time | `end_iso = NULL`; PWA renders as point-in-time |
| Timezone | Store `source_timezone` from Google; `start_iso`/`end_iso` always in UTC |

---

## 8. PWA integration points

### Client-side merge (Upcoming view)

The PWA already builds the Upcoming timeline from:
- Tasks (Nostr/IDB)
- Taskify calendar events (Nostr kind 30310/30311)

After this integration, it additionally:
1. On mount: `GET /api/gcal/events?from=...&to=...`
2. Receives `ExternalCalendarEvent[]`
3. Merges into existing timeline items (same sort-by-date logic)
4. Renders with `source: 'google'` tag and `readonly: true` indicator

### Settings — Connected Calendars section

New settings section: **Connected Calendars**

States:
- Not connected → "Connect Google Calendar" button → opens OAuth URL
- Connected → shows `googleEmail`, `lastSyncAt`, `status`
  - If `status = 'needs_reauth'` → "Reconnect" CTA
  - If `status = 'sync_failed'` → "Sync failed" + last error summary
- Calendar list: toggle switches per calendar (`PATCH /api/gcal/calendars/:id`)
- Disconnect button → `DELETE /api/gcal/connection`

### OAuth redirect handling

PWA watches for `?gcal=connected` or `?gcal=error` on app load and shows appropriate toast.

---

## 9. Build order

1. **D1 migration** (`0003_gcal_integration.sql`)
2. **Worker: token encryption helpers** (AES-256-GCM, isolated module)
3. **Worker: auth endpoints** (`/auth/url`, `/auth/callback`, `/connection`)
4. **Worker: sync engine** (initial sync, incremental sync, edge cases)
5. **Worker: webhook endpoint** + cron renewal
6. **Worker: `/status`, `/calendars`, `/events` endpoints**
7. **Worker tests** (user isolation is primary test target)
8. **PWA: `useGoogleCalendar` hook** (status fetch, events fetch, calendar toggles)
9. **PWA: Upcoming view merge**
10. **PWA: Settings — Connected Calendars section**
11. **PWA: OAuth redirect handling**

---

## 10. Open questions (resolve before implementation)

1. **Nostr auth for Worker endpoints** — confirm: use same NIP-01 sig pattern as voice quota, or session cookie? Voice quota currently uses `npub` header but without sig verification — needs hardening for calendar (tokens are higher value).
2. **OAuth redirect URI** — must be a stable URL registered in Google Cloud Console: `https://taskify.solife.me/api/gcal/auth/callback` (Worker handles it, serves PWA assets on same domain).
3. **Google Cloud project** — does one exist for Taskify already, or needs to be created?
4. **Event window** — confirm: 7d back / 90d ahead as default? Should users be able to extend?
5. **`GCAL_TOKEN_ENC_KEY` rotation** — out of scope for v1 but note: if key changes, all refresh tokens need re-encryption. Plan for it.

---

_Spec version: 2026-03-24. Ready for implementation once open questions are resolved._
