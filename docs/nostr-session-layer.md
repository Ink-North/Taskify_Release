# Nostr Session Layer

This doc maps the **current implementation** in `taskify-pwa/src/nostr/` (branch: `docs/agent-onboarding-roadmap`) so agents can navigate quickly without guessing behavior.

## Scope & Reality Check

- Built on `@nostr-dev-kit/ndk`.
- Core session singleton: `NostrSession`.
- Relay health/backoff is implemented.
- Subscription dedupe/ref-count is implemented.
- Publish debouncing for replaceable events is implemented.
- **Not implemented in this layer:** startup event frame-budget throttling, publish retry loops, persisted event cache.

---

## File Map

## Fast Code Anchors (jump directly by function)

Use this when you need to verify behavior against code quickly.

| Concern | Anchor(s) |
|---|---|
| Session singleton boot path | `taskify-pwa/src/nostr/NostrSession.ts:74` (`init`), `:122` (`ensureRelays`), `:86` (`connect`) |
| Relay hook wiring + auth policy | `taskify-pwa/src/nostr/NostrSession.ts:186` (`setupRelayHooks`) |
| Relay health transitions | `taskify-pwa/src/nostr/RelayHealth.ts:38` (`markSuccess`), `:51` (`markFailure`) |
| NIP-11 refresh + failure accounting | `taskify-pwa/src/nostr/NostrSession.ts:136` (`fetchRelayInfo`), `:248` (`primeRelayInfo`) + `:143/:153` (low-severity failures) |
| Subscription dedupe/refcount | `taskify-pwa/src/nostr/SubscriptionManager.ts:153` (`subscribe`), `:219` (`release`) |
| Cursor injection/update | `taskify-pwa/src/nostr/SubscriptionManager.ts:141` (`since` injection), event handler path around `:192` |
| Replaceable publish coalescing | `taskify-pwa/src/nostr/PublishCoordinator.ts:117` (`publish`), `:143` (`shouldSkipReplaceable` gate), pending-map reuse around `:148` |
| SessionPool compatibility behavior | `taskify-pwa/src/nostr/SessionPool.ts:46` (`subscribe` async wrapper), `:83` (`sub`) |

### Session + coordination
- `NostrSession.ts`
  - Owns the singleton NDK instance.
  - Wires `RelayHealthTracker`, `RelayInfoCache`, `RelayAuthManager`, `EventCache`, `CursorStore`, `SubscriptionManager`, `PublishCoordinator`, `WalletNostrClient`, and `BoardKeyManager`.
  - Main APIs:
    - `init(relays)`
    - `subscribe(filters, options)`
    - `publish(template, options)`
    - `publishRaw(event, options)`
    - `fetchEvents(filters, relayUrls?)`
    - `shutdown()`

- `SessionPool.ts`
  - Compatibility wrapper for list/query/subscribe/get/publish style calls.
  - Internally routes through `NostrSession.init(...)`.

### Relay behavior
- `RelayHealth.ts`
  - `RelayHealthTracker` with per-relay state:
    - `consecutiveFailures`
    - `lastFailureAt`
    - `lastSuccessAt`
    - `nextAllowedAttemptAt`
  - Exponential backoff:
    - base: `5000ms`
    - max: `5min`
    - jitter: `±20%`
    - severity weights: `low=0.5`, `normal=1`, `high=1.5`

- `RelayInfoCache.ts`
  - Caches NIP-11 relay metadata/limits.
  - Used by `NostrSession.resolveRelayLimit(...)` to clamp subscription limits.

- `RelayAuth.ts`
  - Handles relay auth challenge response generation/reset/authed tracking.
  - Hooked in `NostrSession.setupRelayHooks()` via `ndk.relayAuthDefaultPolicy`.

### Subscriptions + dedupe
- `SubscriptionManager.ts`
  - Normalizes filters + relay list, computes stable subscription key.
  - Reuses existing subscription state when key matches (ref count).
  - Applies relay limit clamp if known.
  - Injects `since` from `CursorStore` unless `skipSince`.
  - Tracks per-subscription `seenIds` to avoid duplicate dispatch.
  - Updates cursor timestamps on events.

- `CursorStore.ts`
  - In-memory filter-signature → latest `since` timestamp.

- `EventCache.ts`
  - In-memory global event-id set with FIFO-style oldest-id eviction at capacity (default 2048).
  - Used as auxiliary cache; per-subscription dedupe is still handled by `seenIds` in `SubscriptionManager`.

### Publishing
- `PublishCoordinator.ts`
  - Signs events (if needed), resolves relay set, publishes.
  - For replaceable events, deduplicates by replaceable key and debounces (default `350ms`).
  - `skipIfIdentical` defaults to enabled (unless explicitly `false`), using a shape hash of `{kind, content, tags}`.
  - **Current behavior:** no explicit retry loop in this class; failures reject pending promises.

### Other
- `BoardKeyManager.ts` — deterministic per-board key derivation utilities.
- `WalletNostrClient.ts` — wallet-oriented fetch/subscribe/publish wrapper.
- `Nip96Client.ts`, `ProfilePublisher.ts`, `index.ts` — supporting modules.

---

## Control Flow Reference

## 1) Session initialization

Entry: `NostrSession.init(relays)`

1. Relay URLs are normalized/sorted.
2. On first init:
   - constructor creates NDK with:
     - `explicitRelayUrls`
     - `enableOutboxModel: true`
     - `autoConnectUserRelays: false`
   - internal managers are instantiated.
   - relay hooks are registered (`setupRelayHooks`).
3. `ensureRelays(...)` primes relay info + adds new explicit relays.
4. `connect()` calls `ndk.connect()` once.

## 2) Subscription path

Entry: `NostrSession.subscribe(...)` → `SubscriptionManager.subscribe(...)`

1. Normalize filters + relay list.
2. Clamp `limit` by relay limits when available.
3. Add `since` from `CursorStore` unless `skipSince`.
4. Compute subscription key.
5. If key exists:
   - increment ref count
   - attach handlers
   - return existing subscription wrapper
6. Else:
   - resolve relay set
   - create/store state before subscribe
   - create NDK subscription
   - on each event:
     - skip if id already in state `seenIds`
     - add to `EventCache`
     - update cursors via `updateMany`
     - call handlers
7. `release()` decrements ref count; stop subscription at zero.

## 3) Publish path

Entry: `NostrSession.publish(...)` / `publishRaw(...)` → `PublishCoordinator.publish(...)`

1. Resolve relay set.
2. Build/normalize NDK event + `created_at`.
3. Sign event when needed.
4. Compute replaceable key when applicable.
5. If `skipIfIdentical` and same shape hash as last replaceable event, short-circuit.
6. If replaceable and another pending publish exists for same key:
   - overwrite pending event
   - reset debounce timer
   - share pending promise resolution
7. On timer fire (or immediate for non-replaceable): `event.publish(relaySet)`.
8. On success: cache raw event id; resolve callers.
9. On failure: reject callers (no internal retry loop).

---

## Relay Auth + Reconnect State Machine (agent troubleshooting chunk)

This is the concrete event-driven behavior in `NostrSession.setupRelayHooks()`.

### Hook wiring and side effects

| NDK pool event/policy | Current behavior | Code anchor |
|---|---|---|
| `relayAuthDefaultPolicy(relay, challenge)` | Calls `RelayAuthManager.respond(...)`; returns signed auth event or `false`; logs failures without throwing | `taskify-pwa/src/nostr/NostrSession.ts:186–201` |
| `relay:connect` | Marks relay healthy, resets auth state, logs one-time debug summary in DEV | `taskify-pwa/src/nostr/NostrSession.ts:201–205` |
| `relay:ready` | Marks relay healthy (lightweight confirmation) | `taskify-pwa/src/nostr/NostrSession.ts:207–209` |
| `notice` containing "auth" | Emits informational auth notice log only | `taskify-pwa/src/nostr/NostrSession.ts:211–215` |
| `relay:disconnect` | Marks failure (`reason: "disconnect"`), resets auth state, schedules reconnect | `taskify-pwa/src/nostr/NostrSession.ts:217–221` |
| `relay:authed` | Marks relay authed + healthy | `taskify-pwa/src/nostr/NostrSession.ts:223–227` |

### Reconnect scheduling behavior

`NostrSession.scheduleRelayConnect(relayUrl)` uses `RelayHealthTracker.nextAttemptIn(...)` delay and enforces **one active timer per relay** via `relayRetryTimers` map.

Flow:
1. If a timer exists for relay, no-op.
2. Wait computed delay from relay health backoff.
3. On timer fire:
   - if relay still blocked by backoff, recursively reschedule
   - else call `ndk.pool.getRelay(relayUrl, true)` and `relay.connect()` best-effort
4. Failed reconnect attempts are swallowed (debug-only logging in DEV), leaving failure accounting to relay hooks.

Anchors:
- `taskify-pwa/src/nostr/NostrSession.ts:239–263` (`scheduleRelayConnect`)
- `taskify-pwa/src/nostr/RelayHealth.ts` (`nextAttemptIn`, failure counter/backoff math)

### Practical debugging implications

- If relays appear "stuck," inspect whether they are in backoff (`nextAttemptIn > 0`) before assuming subscription logic is broken.
- Reconnect attempts are timer-driven and do not force immediate reconnect on every disconnect.
- Auth failures and transport failures are intentionally non-fatal to the session singleton; degraded relay sets are expected behavior.

## SessionPool compatibility contract (agent verification chunk)

`SessionPool` intentionally preserves legacy call signatures while delegating to `NostrSession`. Its subscribe APIs are **async-initialized but sync-returning**, which creates subtle close/release behavior that callers depend on.

### 1) Relay normalization is deterministic

All public methods normalize relays with:
- trim
- drop empty values
- dedupe via `Set`
- lexicographic sort

Anchor: `taskify-pwa/src/nostr/SessionPool.ts:11–19`

Implication: relay order differences from callers should not create duplicate session bootstrap paths.

### 2) Subscribe returns a close handle before init completes

`subscribe(...)` and `subscribeMany(...)`:
1. return a close/teardown function immediately,
2. then asynchronously call `NostrSession.init(...)` and `session.subscribe(...)`,
3. then capture `managed.release` when ready.

Anchors:
- `subscribe`: `taskify-pwa/src/nostr/SessionPool.ts:46–79`
- `subscribeMany`: `taskify-pwa/src/nostr/SessionPool.ts:81–111`

If caller closes before `managed.release` exists, close is a no-op (safe). Once `managed.release` is assigned, close forwards to it.

### 3) Failure handling is intentionally non-throwing

Subscribe init failures are swallowed (DEV log only), so legacy callers do not crash synchronously.

Anchors:
- `subscribe` catch: `taskify-pwa/src/nostr/SessionPool.ts:67–71`
- `subscribeMany` catch: `taskify-pwa/src/nostr/SessionPool.ts:96–100`

Operational consequence: failed async subscribe can look like a silent subscription stall unless DEV logs are visible.

### 4) Query/list/get/publish route through singleton session

- `list` and `querySync` both call `NostrSession.init(relays)` then `fetchEvents(...)`
- `get` reduces fetched results to latest `created_at`
- `publish` calls `publishRaw(..., { returnEvent: false })`

Anchors:
- list/query: `taskify-pwa/src/nostr/SessionPool.ts:22–44`
- get: `taskify-pwa/src/nostr/SessionPool.ts:113–120`
- publish: `taskify-pwa/src/nostr/SessionPool.ts:122–131`

### 5) Safe-edit guardrails

If modifying `SessionPool`, preserve:
- immediate close-handle return for subscribe APIs,
- non-throwing async failure behavior (or document/roll out breaking changes),
- deterministic relay normalization before session init,
- compatibility alias `publishEvent(...) -> publish(...)`.

## Security & Reliability Notes (current code)

- Relay auth challenges are handled via NDK auth policy hook and `RelayAuthManager`.
- Relay disconnects call `markFailure(...)` and schedule reconnect attempts according to health backoff.
- NIP-11 fetch failures are tracked as low-severity relay failures.
- Subscription dedupe prevents duplicate callback fan-out for identical filter/relay signatures.
- Event dedupe is in-memory only; cache/cursors are not persisted here.

---

## Gaps / Pending Improvements

- No startup event frame-budget dispatcher in this directory currently.
- No explicit publish retry loop inside `PublishCoordinator`.
- `SessionPool.subscribe(...)` may return a close function before async setup completes; it safely no-ops if not yet ready.

---

## SubscriptionManager dedupe + cursor contract (agent verification chunk)

This section captures the exact subscription-key and dedupe behavior that downstream callers implicitly rely on.

### 1) Subscription keys include injected `since`

`normalizeFilters(...)` computes the dedupe key **after** optional cursor injection, so two otherwise-identical filters can map to different keys when `CursorStore` has advanced.

Anchors:
- `taskify-pwa/src/nostr/SubscriptionManager.ts:132–151` (`normalizeFilters`)
- Cursor injection line: `:140–143`
- Key materialization line: `:148–150`

Implication: if you need key-stable dedupe across re-subscribes regardless of cursor progress, caller must set `skipSince: true`.

### 2) Relay-limit clamping applies only when resolver + relays exist

`clampFilters(...)` is a conditional transform:
- no-op when `relayLimitResolver` is missing,
- no-op when relay list is empty,
- clamps only `f.limit > safeLimit` (default fallback `5000`).

Anchors:
- `taskify-pwa/src/nostr/SubscriptionManager.ts:116–129`

Operational note: subscriptions without explicit relay URLs can bypass relay-specific limit clamping in this layer.

### 3) Handler race prevention is deliberate

State is inserted into `subs` before `ndk.subscribe(...)` to prevent early event delivery from racing handler registration.

Anchors:
- pre-store comment and map set: `taskify-pwa/src/nostr/SubscriptionManager.ts:188–190`
- actual subscribe call: `:192`

Do not reorder this without adding equivalent race protection.

### 4) Dedupe scope is per-subscription-state lifetime

`seenIds` is held on each `SubscriptionState` and is reset when refcount reaches zero and state is deleted.

Anchors:
- `seenIds` initialization: `taskify-pwa/src/nostr/SubscriptionManager.ts:186`
- duplicate gate: `:197–199`
- teardown path: `:219–231`

Implication: dedupe survives handler churn while at least one subscriber remains, but not across full unsubscribe/re-subscribe cycles.

### 5) EOSE callback does not include relay metadata

`sub.on("eose")` invokes handlers with no relay argument (`h.onEose?.()`).

Anchor:
- `taskify-pwa/src/nostr/SubscriptionManager.ts:206–208`

Boundary: callers expecting per-relay EOSE context must derive it elsewhere (or update this contract intentionally).

### Safe-edit guardrails

When changing subscription internals, preserve:
- deterministic keying over normalized filters + normalized relay list,
- explicit `skipSince` escape hatch,
- pre-subscribe state registration race guard,
- ref-count semantics where final release stops the underlying NDK subscription,
- cursor updates happening only after a non-duplicate event passes the `seenIds` gate.

---

## WalletNostrClient + BoardKey derivation contract (agent verification chunk)

This section documents wallet-facing Nostr behavior that sits on top of `NostrSession` internals and is easy to break during relay/publish refactors.

### 1) Wallet state publishes are replaceable + debounced by default

`WalletNostrClient.publishWalletState(...)` computes a replaceable key and publishes with:
- `debounceMs: 400`
- `returnEvent: true`
- relay set supplied by caller

Anchor:
- `taskify-pwa/src/nostr/WalletNostrClient.ts` (`publishWalletState`)

Implication: rapid consecutive wallet-state writes for the same replaceable key are coalesced by `PublishCoordinator` instead of flooding relays.

### 2) Replaceable-key derivation depends on signer pubkey and optional `d` tag

`buildReplaceableKey(...)` emits:
- `replaceable:<kind>:<pubkey>:<dTag>` when a `d` tag exists
- otherwise `replaceable:<kind>:<pubkey>`

If `kind` or signer-derived pubkey is unavailable, it returns `undefined` and publish falls back to non-coalesced behavior.

Anchors:
- `taskify-pwa/src/nostr/WalletNostrClient.ts` (`buildReplaceableKey`, `derivePubkey`)

### 3) Signer parsing accepts both raw hex and `nsec`

`derivePubkey(...)` accepts:
- `Uint8Array` private key
- 64-char hex private key string
- `nsec...` input decoded via `nip19.decode`

Any parse failure is swallowed and treated as no signer/pubkey.

Anchor:
- `taskify-pwa/src/nostr/WalletNostrClient.ts` (`derivePubkey`)

Boundary to preserve: signer parse failures should not crash publish paths.

### 4) Wallet fetch path always returns raw Nostr events with ids

`fetchEvents(...)` calls `ndk.fetchEvents(..., { closeOnEose: true }, relaySet)` and maps each entry to `rawEvent()` fallback; events lacking `id` are filtered out.

Anchor:
- `taskify-pwa/src/nostr/WalletNostrClient.ts` (`fetchEvents`)

Operational consequence: callers can rely on normalized `NostrEvent` payloads rather than NDK wrapper instances.

### 5) Wallet subscribe path is delegated to `SubscriptionManager`

`subscribe(...)` and `initWalletSubscriptions(...)` are thin wrappers over `SubscriptionManager.subscribe(...)`, passing relay URLs and optional handlers (`onEvent`, `onEose`, `closeOnEose`).

Anchors:
- `taskify-pwa/src/nostr/WalletNostrClient.ts` (`subscribe`, `initWalletSubscriptions`)

### 6) Board key derivation is deterministic per board id

`BoardKeyManager.getBoardKeys(boardId)` derives key material as:
1. `sha256("taskify-board-nostr-key-v1" || boardId)`
2. Treat hash output as private key bytes/hex
3. Derive pubkey via `getPublicKey`
4. Construct `NDKPrivateKeySigner(skHex)`

Anchors:
- `taskify-pwa/src/nostr/BoardKeyManager.ts` (`BOARD_KEY_LABEL`, `getBoardKeys`)

### 7) Key objects are memoized by board id (promise cache)

`BoardKeyManager` caches the in-flight promise per `boardId` in a `Map`, so concurrent lookups reuse one derivation path.

Anchor:
- `taskify-pwa/src/nostr/BoardKeyManager.ts` (`cache`, `getBoardKeys`)

### 8) NIP-19 encoding failures degrade gracefully

`npub`/`nsec` encoding attempts are wrapped in try/catch; failures keep raw hex forms instead of throwing.

Anchor:
- `taskify-pwa/src/nostr/BoardKeyManager.ts` (`getBoardKeys`)

### Safe-edit guardrails

When touching wallet-facing nostr code, preserve:
- deterministic replaceable-key shape (`kind + pubkey + optional d-tag`),
- wallet-state publish debounce default (`400ms`) unless intentionally changed,
- signer parse compatibility (`Uint8Array` + hex + `nsec`),
- fetch normalization to raw events with valid ids,
- deterministic board-key derivation label and per-board promise memoization.

## RelayAuthManager challenge-response contract (agent verification chunk)

`RelayAuthManager` in `taskify-pwa/src/nostr/RelayAuth.ts` is the concrete NIP-42 auth responder behind `NostrSession.setupRelayHooks()`.

### 1) Auth dedupe is per relay connection, not global relay URL

Connection identity key is `"<relay.url>|<connectedAt>"`, so a reconnect creates a new auth namespace even for the same relay URL.

Anchors:
- `taskify-pwa/src/nostr/RelayAuth.ts` (`connectionKey`)
- `taskify-pwa/src/nostr/NostrSession.ts` (`relay:connect` / `relay:disconnect` hooks call `authManager.reset`)

Operational implication: auth challenge suppression does not leak across connection generations.

### 2) Signer loading is strict and storage-gated

`loadSigner()` returns `null` unless:
- browser kv storage is available,
- `LS_NOSTR_SK` exists,
- key is exactly 64 hex chars.

When missing/invalid, auth policy returns `false` (no auth event), not a thrown error.

Anchors:
- `taskify-pwa/src/nostr/RelayAuth.ts` (`loadSigner`)
- `taskify-pwa/src/nostr/NostrSession.ts` (`relayAuthDefaultPolicy`)

### 3) Challenge replay suppression window is 15 seconds

`respond(...)` skips rebuilding/re-signing auth events when the same connection key and same challenge were already handled in the last `15_000ms`.

Anchor:
- `taskify-pwa/src/nostr/RelayAuth.ts` (`respond`)

Why this matters: relays that emit duplicate challenge frames do not trigger repeated signing work or noisy duplicate auth publishes.

### 4) Auth event shape is fixed ClientAuth with empty content

`buildAuthEvent(...)` constructs:
- kind: `NDKKind.ClientAuth`
- tags: `["relay", relayUrl]`, `["challenge", challenge]`
- content: empty string
- signature: client secret signer (`NDKPrivateKeySigner`)

Anchor:
- `taskify-pwa/src/nostr/RelayAuth.ts` (`buildAuthEvent`)

### 5) Authed timestamp updates on both response + relay authed hook

- `respond(...)` writes `authedAt=Date.now()` when issuing an auth event.
- `markAuthed(...)` refreshes timestamp again on `relay:authed` pool event.

Anchors:
- `taskify-pwa/src/nostr/RelayAuth.ts` (`respond`, `markAuthed`)
- `taskify-pwa/src/nostr/NostrSession.ts` (`relay:authed` hook)

This keeps dedupe timing aligned with real relay confirmation rather than request send time alone.

### Safe-edit guardrails

When editing auth behavior, preserve:
- connection-scoped auth state keying (`relay.url|connectedAt`) so reconnects do not inherit stale challenge state,
- strict signer validation before signing (do not silently accept malformed key storage),
- 15s duplicate-challenge suppression semantics unless rollout notes call out behavior changes,
- `relayAuthDefaultPolicy` failure mode of returning `false` (non-throwing) to avoid crashing session bootstrap.

## Agent Jump-Start Checklist

When debugging or extending Nostr behavior, read in this order:
1. `taskify-pwa/src/nostr/NostrSession.ts`
2. `taskify-pwa/src/nostr/SubscriptionManager.ts`
3. `taskify-pwa/src/nostr/PublishCoordinator.ts`
4. `taskify-pwa/src/nostr/RelayHealth.ts`
5. `taskify-pwa/src/nostr/CursorStore.ts`
6. `taskify-pwa/src/nostr/EventCache.ts`
7. `taskify-pwa/src/nostr/SessionPool.ts`

This ordering matches runtime impact (session wiring → sub path → publish path → relay behavior).
