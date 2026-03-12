# Taskify Core Extraction Plan (Comprehensive)

## Objective
Build `taskify-core` into the single shared domain/protocol layer consumed by both `taskify-pwa` and `taskify-cli`, while keeping UI/runtime-specific concerns out of core.

## Ground Rules
- Branch base for all new work: `New_Features_Fixes` (latest from parent).
- Plan mode first; tests-first per slice.
- Small PR slices to parent repo (`Solife-me`) for review.
- No PWA schema/data-shape changes without explicit approval.

## Non-Goals (for core)
- React hooks/components
- Browser-specific storage/session wiring (IDB/localStorage)
- Relay lifecycle/runtime orchestration UI flows

## Target Core Domains
1. Calendar protocol + shared parsing/normalization adapters
2. Task/board/contact contracts + pure task utilities
3. Recurrence/date/reminder pure logic
4. Share envelope protocol contracts
5. Backup snapshot/merge/sanitize contracts
6. Nostr crypto/key/tag primitives (pure)

## Extraction Waves

### Wave 1 (Start Here): Calendar protocol/domain parity ✅ (completed in branch sequence)
**Source candidates**
- `taskify-pwa/src/lib/privateCalendar.ts` (pure protocol layer only)
- `taskify-pwa/src/lib/app/weekRecurrenceDomain.ts`
- `taskify-pwa/src/lib/app/weekBoardDate.ts`
- selected pure helpers in `taskify-pwa/src/domains/dateTime/*`

**Deliverables**
- New core modules:
  - `calendarProtocol.ts`
  - `calendarDecode.ts`
  - `weekRecurrence.ts`
  - `weekDate.ts`
- Barrel exports via `taskify-core/src/index.ts`
- CLI + PWA imports switched to core where equivalent exists

**Tests (first)**
- `tests/calendar-protocol-core.test.ts`
- `tests/calendar-decode-core.test.ts`
- `tests/week-recurrence-core.test.ts`
- `tests/week-date-core.test.ts`

**Acceptance**
- PWA + CLI build and tests pass
- No behavior change in event CRUD and parsing semantics

### Wave 2: Task/board/contact contracts
**Source candidates**
- `taskify-pwa/src/domains/tasks/taskTypes.ts`
- `taskify-pwa/src/domains/tasks/taskUtils.ts`
- `taskify-pwa/src/domains/tasks/boardUtils.ts`
- `taskify-pwa/src/domains/tasks/contactUtils.ts`

**Deliverables**
- `taskContracts.ts`, `boardContracts.ts`, `contactContracts.ts`
- normalization/validation helpers used by both CLI/PWA

**Tests**
- fixtures for task/board/contact edge cases

### Wave 3: Share + backup contracts
**Source candidates**
- `taskify-pwa/src/lib/shareInbox.ts` (envelope contracts only)
- `taskify-pwa/src/lib/app/nostrBackupDomain.ts`
- `taskify-pwa/src/domains/backup/*`

**Deliverables**
- transport-agnostic envelope builders/parsers
- backup snapshot/merge/sanitize domain helpers

### Wave 4: Nostr pure primitives
**Source candidates**
- `taskify-pwa/src/domains/nostr/nostrKeyUtils.ts`
- `taskify-pwa/src/domains/nostr/nostrCrypto.ts`
- selected constants/utilities from `taskify-pwa/src/lib/nostr.ts` + `relays.ts`

**Deliverables**
- pure key/crypto/tag/address utilities
- avoid relay pool/session runtime in core

## PR Slicing Strategy
- PR1: Wave 1 protocol constants + address/parser helpers
- PR2: Wave 1 decode adapter + recurrence/week helpers
- PR3: Wave 2 task/board/contact contracts
- PR4: Wave 3 share/backup contracts
- PR5: Wave 4 nostr primitives + import cleanup

Each PR includes:
- failing tests first
- implementation
- PWA/CLI wiring updates
- migration notes in PR body

## Validation Matrix (per PR)
- `taskify-core`: `npm test`
- `taskify-cli`: `npm test`
- `taskify-pwa`: `npm clean-install --progress=false && npm run build`

## Risk Controls
- Preserve backwards compatibility with wrapper re-exports where possible
- Keep each extraction incremental and reversible
- Avoid broad file moves in same PR as behavior changes

## Immediate Next Steps (Now)
1. Start PR1 branch off `New_Features_Fixes`
2. Add failing tests for calendar protocol/address primitives in `taskify-core`
3. Extract first minimal module + wire PWA/CLI imports
4. Run full validation matrix
5. Open parent-project PR for review
