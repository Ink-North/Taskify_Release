# Worker Backend Layer (Cloudflare Worker)

This guide documents the **current production backend flow** implemented in `worker/src/index.ts`.

It is written for contributors/agents who need to safely modify reminder delivery, push registration, or encrypted backup behavior without introducing silent regressions.

---

## 1) Purpose and runtime boundaries

The Worker is responsible for three backend concerns:

1. **Push device + reminder orchestration** (HTTP APIs + cron)
2. **Encrypted backup object persistence**
3. **Static PWA asset serving** (`ASSETS` binding fallback)

Primary entry points:
- Fetch router: `worker/src/index.ts` (around lines 261–337)
- Cron scheduler: `worker/src/index.ts` (around lines 317–335)
- Schema bootstrapping: `worker/src/index.ts` (around lines 174–233)

---

## 2) Bindings and deployment contract

`wrangler.toml` defines the runtime contract:

- Cron cadence: `*/1 * * * *` (`wrangler.toml:16–17`)
- D1: `TASKIFY_DB` (`wrangler.toml:47–52`)
- R2: `TASKIFY_BACKUPS` (`wrangler.toml:42–45`)
- KV (legacy/compat): `TASKIFY_DEVICES`, `TASKIFY_REMINDERS`, `TASKIFY_PENDING` (`wrangler.toml:26–36`)
- VAPID key binding: `VAPID_PRIVATE_KEY` as string secret or KV namespace (`wrangler.toml:38–40`)

`Env` typing in code confirms mixed binding support:
- `TASKIFY_DB` required D1 source-of-truth
- KV namespaces optional fallback/migration path
- `VAPID_PRIVATE_KEY: string | KVNamespace`

Reference: `worker/src/index.ts:37–44`.

---

## 3) API surface (actual router behavior)

Router dispatch in `fetch()`:

- `GET /api/config` → exposes `workerBaseUrl` + VAPID public key
- `GET /api/preview` → URL preview proxy
- `GET /api/nip05` → NIP-05 lookup
- `PUT /api/devices` → register/update push device
- `DELETE /api/devices/:deviceId` → delete device + associated reminder/pending rows
- `PUT /api/reminders` → replace reminder set for a device
- `POST /api/reminders/poll` → drain pending reminder notifications for endpoint
- `PUT /api/backups` → write encrypted backup blob to R2
- `GET /api/backups?npub=...` → load backup blob metadata+payload

Reference: `worker/src/index.ts:290–307`.

### API contract anchors (agent quick-check table)

Use this table before changing handler logic so caller contracts stay aligned.

| Route | Request contract | Response contract | Primary caller(s) | Handler anchor |
|---|---|---|---|---|
| `GET /api/config` | none | `{ workerBaseUrl, vapidPublicKey }` | PWA bootstrap/config load | router branch in `fetch()` (`worker/src/index.ts:278`) |
| `PUT /api/devices` | `{ deviceId, platform, subscription{endpoint,keys{auth,p256dh}} }` | `{ subscriptionId, deviceId }` | `taskify-pwa/src/App.tsx:13237` | `worker/src/index.ts:608` (`handleRegisterDevice`) |
| `DELETE /api/devices/:deviceId` | path param `deviceId` | `204` empty body | `taskify-pwa/src/App.tsx:13321` | `worker/src/index.ts:2305` (`handleDeleteDevice`) |
| `PUT /api/reminders` | `{ deviceId, reminders[] }` | `204` empty body | reminder sync in PWA | `worker/src/index.ts:2335` (`handleSaveReminders`) |
| `POST /api/reminders/poll` | `{ endpoint }` or `{ deviceId }` | `PendingReminder[]` and drains rows | `taskify-pwa/public/sw.js:213` | `worker/src/index.ts:2404` (`handlePollReminders`) |
| `PUT /api/backups` | `{ npub, ciphertext, iv, version?, createdAt? }` | `{ ok: true }` | onboarding backup save | `worker/src/index.ts:347` (`handleSaveBackup`) |
| `GET /api/backups?npub=...` | query `npub` | `{ backup }` (payload has `ciphertext`, `iv`, metadata) | onboarding restore | `taskify-pwa/src/App.tsx:2295` | `worker/src/index.ts:381` (`handleLoadBackup`) |

---

## 4) Data model (D1 source-of-truth)

`ensureSchema()` creates/updates these core tables:

- `devices`
  - key: `device_id`
  - stores endpoint, endpoint hash, push keys
- `reminders`
  - key: `(device_id, reminder_key)`
  - stores due schedule (`send_at`) per reminder instance
- `pending_notifications`
  - queue-like rows consumed by `/api/reminders/poll`

Reference: `worker/src/index.ts:174–233`, plus migration baseline `worker/migrations/0001_init.sql`.

**Important invariant:** reminder rows are deleted once moved into pending notifications during cron processing; pending rows are later deleted on poll read.

---

## 5) Reminder lifecycle (authoritative control flow)

### 5.1 Save/update reminders

`PUT /api/reminders` (`handleSaveReminders`) validates payload and performs full replacement for device state.

High-level flow:
1. Parse `{ deviceId, subscriptionId?, reminders[] }`
2. Validate reminder item shape inline (`taskId`, `title`, `dueISO`, `minutesBefore[]`) and compute `sendAt`
3. Resolve/verify device record
4. Replace existing device reminder rows in D1
5. Clear existing pending rows for the device to avoid stale deliveries

Reference:
- `handleSaveReminders`: `worker/src/index.ts:2335+`

### 5.2 Cron dispatch

`scheduled()` runs once per minute and calls `processDueReminders()`.

`processDueReminders` behavior:
1. Query due rows from `reminders` where `send_at <= now` in batches
2. Delete processed reminder rows
3. Group by device
4. Insert mapped reminder payload rows into `pending_notifications` (`appendPending`)
5. Resolve device subscription (D1 first, KV migration fallback)
6. Send lightweight Web Push ping (`sendPushPing`) so SW wakes and polls
7. If push endpoint expired (410), remove device state

References:
- `scheduled`: `worker/src/index.ts:317–335`
- `processDueReminders`: `worker/src/index.ts:2443+`
- `appendPending`: `worker/src/index.ts:2498+`
- `sendPushPing`: `worker/src/index.ts:2779+`

### 5.3 Client poll + drain

Service worker flow:
- On push event, call `POST /api/reminders/poll` with subscription endpoint
- Retry with exponential backoff if needed
- Show one notification per returned item

References:
- `taskify-pwa/public/sw.js:175–235`
- `handlePollReminders`: `worker/src/index.ts:2404+`

**Why poll after push:** payload delivery and wake-up are decoupled; pending rows provide reliability when push payload limits/network variability occur.

---

## 6) Device registration + deletion semantics

### Register (`PUT /api/devices`)

`handleRegisterDevice` upserts device subscription into D1, tracks endpoint hash, and supports endpoint collision handling/migration.

Reference: `worker/src/index.ts:608+`.

### Delete (`DELETE /api/devices/:deviceId`)

`handleDeleteDevice` removes:
- device row
- reminders for device
- pending notifications for device
- legacy KV mirrors (best-effort)

Reference: `worker/src/index.ts:2305–2333`.

---

## 7) Backup storage flow (R2)

### Save (`PUT /api/backups`)

`handleSaveBackup`:
- Validates `npub`, `ciphertext`, `iv`
- Writes JSON envelope to `TASKIFY_BACKUPS` object key
- Stores metadata (`updatedAt`, etc.)

Reference: `worker/src/index.ts:347+`.

### Load (`GET /api/backups?npub=...`)

`handleLoadBackup`:
- Validates `npub`
- Reads object from R2
- Returns parsed backup payload

Reference: `worker/src/index.ts:381+`.

---

## 8) VAPID key resolution and signing

Push ping signing uses ES256 JWT + VAPID headers.

Key loading sequence in `resolvePrivateKeyPem`:
1. If `env.VAPID_PRIVATE_KEY` is a non-empty string, use it
2. Else if it behaves like KV, try keys: `VAPID_PRIVATE_KEY`, `private-key`, `key`
3. Else throw configuration error

References:
- `resolvePrivateKeyPem`: `worker/src/index.ts:2859+`
- `getPrivateKey`: `worker/src/index.ts:2833+`

**Security note:** private key material is never sent to clients. Client receives public key only via `/api/config`.

---

## 9) Failure modes and operator signals

Common failure classes:

1. **Misconfigured bindings**
   - Missing `TASKIFY_DB` or VAPID key → runtime errors
   - Mitigation: validate env setup and secrets before deploy

2. **Stale push subscriptions**
   - 410 from push service during ping
   - Worker cleanup path removes stale device registrations

3. **Reminder drift / late delivery**
   - Cron granularity is 1 minute + network/runtime latency
   - System is at-least-once wake + at-most-once queue drain per row

4. **Schema mismatch in older environments**
   - `ensureSchema()` runs at request/scheduled entry to reduce cold migration issues

Operational references:
- Error wrappers/logging in `fetch` and `scheduled`: `worker/src/index.ts:309–333`

---

## 10) Agent change checklist (safe edits)

Before changing reminder/backend logic, verify:

1. API path + method still match PWA callers
   - `App.tsx` reminder sync: `taskify-pwa/src/App.tsx:20024–20071`
   - SW poll path: `taskify-pwa/public/sw.js:213–217`
2. D1 write/read/delete semantics remain consistent across:
   - `handleSaveReminders`
   - `processDueReminders`
   - `handlePollReminders`
3. Device deletion still clears all three stores (D1 + optional KV mirrors)
4. VAPID key resolution still supports both string and KV binding modes
5. Any behavior change is mirrored in docs (`architecture-overview.md`, this file)

---

## 11) Known limitations (current state)

- Worker implementation is monolithic (`worker/src/index.ts`), so cross-cutting edits are easy to miss in review.
- Legacy KV migration paths increase branch complexity and testing surface.
- Reminder dispatch relies on minute-level cron cadence, not real-time scheduling.
- There is no dedicated worker unit test suite yet for reminder/push paths (roadmap gap).

This is intentional documentation of **present reality**, not a proposal.
