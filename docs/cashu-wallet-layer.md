# Cashu Wallet Layer

This doc maps the **current wallet + mint implementation** in `taskify-pwa/src/wallet/` and `taskify-pwa/src/mint/` for agent onboarding on branch `docs/agent-onboarding-roadmap`.

## Scope & Reality Check

- Core wallet operations are centralized in `wallet/CashuManager.ts`.
- Per-mint orchestration and request-control wrappers are in `mint/MintConnection.ts`.
- Multi-mint singleton/session routing is in `mint/MintSession.ts`.
- DLEQ proof validation is actively enforced after mint/receive/send/melt change paths.
- Request dedupe, batching, and local throttling are implemented (cache + rate limiter + queued proof-state checks).
- No server-side wallet custody: proofs and seed metadata are local only.

---

## File Map

### Wallet core (`taskify-pwa/src/wallet/`)

- `CashuManager.ts`
  - Core flows: init, mint quote/claim, send, receive, melt, partial invoice payment.
  - Tracks local proof cache + persistence sync via `storage.ts` (`getProofs` / `setProofs`).
  - Supports P2PK lock/send and auto-signing of proofs when a private-key resolver is configured.
  - Handles mint keyset refresh/retry on known keyset drift error codes (`11005`, `12001`, `12002`) and keyset-related error strings.
  - Maintains in-memory `pendingMeltBlanks` to recover `change` proofs if a melt is paid but response handling is interrupted.

- `storage.ts`
  - IndexedDB-backed wallet store via `idbKeyValue` (`TASKIFY_STORE_WALLET`) with localStorage-style keys (`cashu_proofs_v1`, `cashu_tracked_mints_v1`, etc.).
  - Proof persistence helpers (`getProofs`, `setProofs`) plus mint-list and pending-token queue helpers (`addPendingToken`, `markPendingTokenAttempt`, `replacePendingTokens`, etc.).

- `seed.ts`
  - Seed lifecycle: `getWalletSeedMnemonic`, `getWalletSeedBytes`, backup/restore helpers, counter persistence.
  - Counter persistence via `persistWalletCounter` + `persistWalletCounterSnapshot` to avoid deterministic wallet replay collisions.

- `dleq.ts`
  - `verifyProofDleq` and `assertValidProofsDleq` for blind-signature proof integrity checks.

- `p2pk.ts`
  - P2PK helper checks (`extractPubkeysFromP2PKSecret`, `proofIsLockedToPubkey`).

- `nwc.ts`
  - NWC URI parsing + client wrapper (`NwcClient`) for NIP-47 style wallet connect.

- `mintBackup.ts`
  - Encrypted mint state backup payload helpers.
  - Backup event constants: `MINT_BACKUP_KIND = 30078`, `MINT_BACKUP_D_TAG = "mint-list"`.

- `lightning.ts`, `nut16.ts`, `npubCash.ts`, `peanut.ts`
  - Supporting adapters/utilities for invoice parsing, NUT-16 frame handling, NPub cash claims, and Peanut token helpers.

### Mint orchestration (`taskify-pwa/src/mint/`)

- `MintSession.ts`
  - Singleton coordinator over `MintConnection` instances keyed by normalized mint URL.
  - Public static helpers route to connection managers (`requestMintQuote`, `executeMelt`, `checkTokenStates`, etc.).
  - Hook propagation (`getP2PKPrivkey`, `onP2PKUsage`) across existing connections.

- `MintConnection.ts`
  - Composition root for per-mint services:
    - `MintQuoteManager`
    - `SwapManager`
    - `StateCheckManager`
    - `PaymentRequestManager`
    - `LockedTokenManager`
  - Owns request controls:
    - `MintRequestCache` (in-flight + short TTL dedupe)
    - `MintRateLimiter` (min interval + adaptive backoff)
  - Wraps `CashuManager` and re-validates returned proofs with DLEQ checks.

- `MintQuoteManager.ts`
  - Quote-level memoization and status checks.
  - Avoids repeated quote calls when state is already terminal (`PAID`, `ISSUED`).

- `StateCheckManager.ts`
  - Batches `checkstate` calls (25ms queue window), dedupes proofs, remaps results per caller.

- `PaymentRequestManager.ts`
  - Request-id idempotency guard for in-flight melt payment execution.

- `SwapManager.ts`
  - Wallet swap passthrough with request-keying and DLEQ validation.

- `MintCapabilityStore.ts`
  - Mint info capability cache across connections.

- `MintRequestCache.ts`
  - Stable-key cache wrapper around async factory functions with TTL and failure eviction.

- `MintRateLimiter.ts`
  - Local scheduler (`minIntervalMs` default `120`, `maxBackoffMs` default `5000`) with 429-aware backoff behavior.

- `LockedTokenManager.ts`
  - Locked-token bookkeeping helper tied to `MintConnection`.

---

## Agent Code Anchors (spot-check map)

Use this table when verifying docs against code. Anchors are function-level and stable enough for grep-based navigation.

| Area | Code anchor |
|---|---|
| Wallet bootstrap + proof hydration | `taskify-pwa/src/wallet/CashuManager.ts:427` (`init`) + `:440` (`getProofs`) + `:470` (`setProofs`) |
| Mint-claim path | `taskify-pwa/src/wallet/CashuManager.ts:563` (`claimMint`) |
| Receive token path | `taskify-pwa/src/wallet/CashuManager.ts:574` (`receiveToken`) |
| Send token path | `taskify-pwa/src/wallet/CashuManager.ts:632` (`createSendToken`) |
| Melt quote + execute | `taskify-pwa/src/wallet/CashuManager.ts:746` (`createMeltQuote`) + `:757` (`executeMeltQuote`) + `:843` (`payMeltQuote`) |
| Interrupted melt recovery | `taskify-pwa/src/wallet/CashuManager.ts:145` (`wallet.completeMelt(blanks)`) |
| DLEQ verification gates | `taskify-pwa/src/wallet/dleq.ts:57` (`assertValidProofsDleq`) + callsites in `CashuManager.ts:98` and `MintConnection.ts:107` |
| Per-mint connection bootstrap | `taskify-pwa/src/mint/MintSession.ts:53` (`getConnection`) + `taskify-pwa/src/mint/MintConnection.ts:62` (`init`) |
| Request dedupe + rate-limit wrapper | `taskify-pwa/src/mint/MintConnection.ts:75` (`runWithRateLimit`) + `taskify-pwa/src/mint/MintRequestCache.ts:26` (`buildKey`) + `taskify-pwa/src/mint/MintRateLimiter.ts:16` (constructor defaults) |
| Quote orchestration | `taskify-pwa/src/mint/MintQuoteManager.ts:43` (`requestMintQuote`) |
| Proof-state batching | `taskify-pwa/src/mint/StateCheckManager.ts:30` (`flush`) + `:73` (`checkStates`) |
| Wallet persistence primitives | `taskify-pwa/src/wallet/storage.ts:247` (`getProofs`) + `:252` (`setProofs`) |
| Seed counter persistence | `taskify-pwa/src/wallet/seed.ts:192` (`persistWalletCounter`) + `:203` (`persistWalletCounterSnapshot`) |

### Quick verification recipe (agents)

1. Confirm every outward wallet mutation re-checks DLEQ (`claimMint`, `receiveToken`, `createSendToken`, `payMeltQuote`).
2. Confirm every networked mint call enters through `MintConnection.runWithRateLimit(...)` unless explicitly local-only.
3. Confirm persistence writes happen after proof normalization (`setProofs`) rather than raw mint response storage.
4. Confirm melt-recovery path still uses `pendingMeltBlanks` + `completeMelt` before final proof commit.

## Control Flow Reference

## 1) Session and connection lifecycle

Entry: `MintSession.getConnection(mintUrl)`

1. Normalize URL (`trim` + trailing slash strip).
2. Reuse existing `MintConnection` or construct a new one with shared `MintCapabilityStore` + hooks.
3. `connection.init()`:
   - runs `CashuManager.init()` once,
   - best-effort caches mint info via `getMintInfo()`.

## 2) Mint quote -> claim flow

Entry: `MintSession.requestMintQuote(...)` / `MintSession.executeMint(...)`

1. Quote request routes through `MintQuoteManager.requestMintQuote`.
2. Request key built via `MintRequestCache.buildKey(...)`.
3. Execution wrapped by `MintConnection.runWithRateLimit(...)` (cache + scheduler).
4. Quote cached by quote ID.
5. Claim path calls `CashuManager.claimMint(...)`:
   - retries once with mint refresh when keyset drift errors are detected,
   - validates DLEQ,
   - merges/persists proofs.

## 3) Send / receive token flow

### Send (`createSendToken`)

1. `CashuManager.createSendToken(amount, options)` validates amount.
2. Optional P2PK lock metadata translated to output config.
3. `wallet.send(...)` splits proofs into `keep` and `send`.
4. DLEQ check runs on resulting proofs.
5. `keep` proofs persisted; `send` proofs encoded into Cashu token string.

### Receive (`receiveToken`)

1. Resolve potential P2PK private keys from incoming token proofs.
2. `wallet.receive(encoded, receiveConfig)` executes (with mint refresh retry wrapper).
3. Auto-signs P2PK proofs when resolver keys are available.
4. DLEQ validates received proofs.
5. Proof cache is merged + persisted.

## 4) Melt / pay invoice flow

Entry: `CashuManager.payInvoice(...)` / `payMeltQuote(...)`

1. Create melt quote (`wallet.createMeltQuote`).
2. Compute required amount (`quote.amount + quote.fee_reserve`); abort if insufficient balance.
3. Pre-split proofs with `wallet.send(required, ...)` into `keep` and `send`.
4. Execute `wallet.meltProofs(quote, send, { onChangeOutputsCreated })`.
5. If payment is paid but response handling fails, attempt recovery:
   - check quote status,
   - finalize stored melt blanks via `completeMelt(...)`.
6. Persist resulting proof set:
   - paid: `keep + change`
   - unpaid/error: restore `keep + send`.

## 5) Proof-state check batching

Entry: `StateCheckManager.checkStates(proofs)`

1. Request enqueued.
2. 25ms delayed flush batches concurrent calls.
3. Deduped proof list submitted once (`MintConnection.checkProofStates`).
4. Results mapped back to each request's original proof order.

---

## Mint refresh retry matrix (keyset drift resilience)

`CashuManager.withMintRefreshRetry(...)` is the core one-retry guard used by claim/receive/send/melt quote and melt execution paths.

Anchors:
- Retry wrapper: `taskify-pwa/src/wallet/CashuManager.ts:415–424`
- Refresh trigger classifier: `:376–390`
- Refresh implementation + rebuild fallback: `:402–413`

### Trigger conditions (current code)

The retry path runs once when either of these matches:

1. **Known numeric error codes**: `11005`, `12001`, `12002`
   - Anchor: `REFRESH_RETRY_CODES` (`taskify-pwa/src/wallet/CashuManager.ts:54`)
2. **Message/detail text contains** keyset-drift hints:
   - `"no keyset found"`
   - `"keyset"`
   - `"input_fee_ppk"`
   - `"transaction is not balanced"`
   - `"wallet keyset has no keys"`
   - Anchor: `shouldRefreshMintState(...)` (`taskify-pwa/src/wallet/CashuManager.ts:376–390`)

If `wallet.loadMint(true)` itself fails with specific keyset-loading messages, manager rebuilds wallet state via `init()` before the second attempt.

Operationally: this is a **single refresh + single retry** strategy (not unbounded retry).

## Melt idempotency + recovery deep slice

This is the highest-risk wallet mutation path and should be preserved during refactors.

Anchors:
- Main melt flow: `taskify-pwa/src/wallet/CashuManager.ts:757–828`
- Pending blank-change store: `:107–137`
- Change finalization: `:139–159`
- Request-id idempotency wrapper: `taskify-pwa/src/mint/MintConnection.ts:205–224`

### Sequence (exact behavior)

1. `MintConnection.payMeltQuote(...)` computes deterministic request id from quote/request and calls `PaymentRequestManager.executeOnce(...)`.
2. `CashuManager.executeMeltQuote(...)` pre-splits proofs (`keep`, `send`) and validates DLEQ on both sets before melt.
3. During `wallet.meltProofs(...)`, `onChangeOutputsCreated` stores melt blanks by quote key in `pendingMeltBlanks`.
4. On thrown melt error:
   - restore unpaid state (`keep + send`) immediately,
   - check melt quote status,
   - if quote is actually paid, finalize stored blanks via `completeMelt(...)`, DLEQ-validate change, then persist paid state (`keep + change`).
5. On successful melt response:
   - DLEQ-validate returned change when present,
   - if response has no change but stored blanks exist and quote is paid, finalize from stored blanks,
   - persist paid (`keep + change`) or unpaid (`keep + send`) proof set accordingly.

### Invariants to protect

- Never persist unvalidated change proofs.
- Never drop `pendingMeltBlanks` cleanup on successful paid resolution.
- Preserve request-id idempotency to avoid duplicate payment execution races.

## Security & Reliability Notes (Current)

- DLEQ proof validation is explicit in wallet and connection paths before proofs are treated as valid.
- P2PK usage is key-resolver dependent; if no resolver hook is set, proofs are not auto-signed.
- Local request dedupe reduces duplicate network calls and duplicate melt execution (`PaymentRequestManager`).
- Mint capability probing is cached (`MintCapabilityStore`) and used for feature checks like quote/proof-state subscriptions.
- Wallet seed/counter state is local; no backend key custody.

---

## Known Gaps / Watchpoints

- Mint operation support varies by wallet/mint version; several flows are capability-gated at runtime.
- Storage is local browser storage, so compromise of runtime JS context remains a key risk.
- `LockedTokenManager` and surrounding higher-level P2PK UX assumptions should be reviewed before protocol-level changes.

---

## Agent Jump-Start Read Order

1. `taskify-pwa/src/wallet/CashuManager.ts`
2. `taskify-pwa/src/mint/MintConnection.ts`
3. `taskify-pwa/src/mint/MintSession.ts`
4. `taskify-pwa/src/mint/MintQuoteManager.ts`
5. `taskify-pwa/src/mint/StateCheckManager.ts`
6. `taskify-pwa/src/wallet/storage.ts`
7. `taskify-pwa/src/wallet/seed.ts`

This order mirrors runtime criticality (wallet core first, then orchestration, then support layers).
