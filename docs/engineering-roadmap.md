# Engineering Roadmap — Documentation & Testing Initiative

**Period:** March 2026 (weeks 1–2)
**Scope:** Documentation expansion and test coverage — no product code changes.

---

## Context

Taskify has a working product across two primary surfaces (PWA + Worker) with a small but meaningful test suite covering agent dispatch, Nostr startup stability, and onboarding gating. This roadmap formalizes the next steps to make the codebase approachable for contributors and AI agents, and to close the largest gaps in test coverage before the next feature cycle.

---

## Week 1 — Documentation Foundation

### Milestone 1.1: Core Onboarding Docs (Days 1–3)

**Deliverables:**
- [x] `AGENT.md` — project structure, architecture, protocols, branch flow, testing strategy, contribution rules
- [x] `docs/engineering-roadmap.md` — this file
- [x] `.github/pull_request_template.md` — enforces docs-impact section on every PR

**Acceptance criteria:**
- A new contributor or AI agent can understand the architecture, find relevant files, and run tests by reading `AGENT.md` alone.
- PRs cannot be submitted without addressing the docs-impact checklist item.

---

### Milestone 1.2: Domain Documentation (Days 3–5)

**Deliverables:**

| File | Covers | Status |
|---|---|---|
| `docs/nostr-session-layer.md` | SessionPool, RelayHealth, startup stability, relay auth (NIP-42) | ✅ Done |
| `docs/cashu-wallet-layer.md` | Mint connections, swap flow, P2PK (NIP-61), NWC (NIP-47), seed derivation | ✅ Done |
| `docs/worker-backend.md` | Cron behavior, KV schemas, D1 schema, push notification flow, R2 backup format | ✅ Done |
| `docs/agent-mode.md` | Full command reference (all 12 ops), security mode matrix, task shape, error codes | ✅ Done |

**Acceptance criteria:**
- Each doc covers: purpose, key files, data flow diagram or pseudocode, failure modes, and known limitations. ✅
- Docs reference specific file paths and line ranges where relevant. ✅

---

## Week 2 — Test Coverage Expansion

Current test count: 3 files. Target: expand to cover 6+ domains.

### Milestone 2.1: Nostr Layer Tests (Days 6–7)

**Target files:**
- `taskify-pwa/src/nostr/RelayHealth.test.ts` ✅ **Done** — 19 tests
- `taskify-pwa/src/nostr/PublishCoordinator.test.ts` — Deferred (requires deep NDK mock; low ROI vs. risk)

**Coverage goals:**
- RelayHealth: `canAttempt` / `nextAttemptIn` / `markSuccess` / `markFailure` / `onBackoffExpiry` ✅
- RelayHealth: severity weighting (low/high vs normal) ✅
- RelayHealth: exponential backoff grows with consecutive failures ✅
- RelayHealth: relay isolation (failure on one doesn't affect another) ✅
- PublishCoordinator: deferred — requires NDK internals stub

**Bonus (completed):**
- `taskify-pwa/src/agent/agentSecurity.test.ts` ✅ **27 tests** — covers `normalizeAgentSecurityConfig`, `addTrustedNpub`, `removeTrustedNpub`, `clearTrustedNpubs`, `annotateTrust`, `applyTrustFilter`, `summarizeTrustCounts`, `getEffectiveAgentSecurityMode`

**Acceptance criteria:**
- All tests pass with Node `--test` runner, no real network calls. ✅ (46/46 pass)

---

### Milestone 2.2: Wallet / Cashu Layer Tests (Days 7–9)

**Target files:**
- `taskify-pwa/src/mint/SwapManager.test.ts` ✅ **Done**
- `taskify-pwa/src/wallet/p2pk.test.ts` ✅ **Done**

**Coverage delivered:**
- SwapManager: throws when mint wallet has no `swap()` ✅
- SwapManager: verifies init → rate-limit wrapper → wallet.swap → DLEQ validation chain ✅
- SwapManager: supports both `{ proofs: [...] }` and direct array swap responses ✅
- P2PK: key extraction + normalization from `data`, `pubkeys`, and `refund` tags ✅
- P2PK: lock checks return true for matching keys and false for missing/invalid keys ✅

---

### Milestone 2.3: Worker Logic Tests (Days 9–10)

**Target files:**
- `worker/src/index.test.ts` ✅ **Added** (in-memory D1 mock)

**Coverage delivered:**
- `GET /api/config` contract validation ✅
- `PUT /api/reminders` unknown device behavior (404) ✅
- `POST /api/reminders/poll` drain semantics (returns + deletes pending rows) ✅
- `scheduled()` handler baseline path with empty due reminders ✅

**Still pending for full hardening:**
- Push dispatch 410-expiry cleanup assertion
- VAPID signing-path unit tests
- Due-reminder batch processing with grouped device delivery

---

## Coverage Tracking

| Domain | Week 1 Start | Week 2 Result |
|---|---|---|
| Agent dispatch | Basic | ✅ Maintained |
| Agent security (trust, modes) | None | ✅ 27 new tests |
| Nostr startup stability | Basic | ✅ Maintained |
| Onboarding gating | Basic | ✅ Maintained |
| Nostr relay layer (RelayHealth) | None | ✅ 19 new tests |
| PublishCoordinator | None | Deferred (NDK stub complexity) |
| Wallet / Cashu | None | ✅ Added (SwapManager + p2pk) |
| Worker backend | None | ✅ Added baseline API/scheduler tests |

**Total new tests this cycle: 70** (19 RelayHealth + 27 agentSecurity + 3 SwapManager + 5 p2pk + 4 worker)

---

## Definition of Done

A milestone is complete when:

1. All deliverable files exist and pass a consistency review (no broken links, no placeholder sections).
2. All new test files pass `npm test` (or equivalent) with zero failures.
3. `npm run lint` passes with no new errors introduced.
4. A PR is opened against `New_Features_Fixes` with the PR template filled out, including the docs-impact section.
5. At least one reviewer approves the PR before merge.

---

## Out of Scope (This Cycle)

- E2E / browser-level tests (Playwright, Cypress) — planned for a future cycle
- Coverage percentage tooling (c8, nyc) — will be added once domain tests are in place
- CI/CD pipeline changes — separate infrastructure track
- Product feature work — this roadmap is documentation and testing only
