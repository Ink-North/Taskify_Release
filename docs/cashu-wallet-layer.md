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
  - localStorage-backed proof store and mint list management.
  - Pending token queue helpers (`addPendingToken`, `markPendingTokenAttempt`, `replacePendingTokens`, etc.).

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
