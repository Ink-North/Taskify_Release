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
