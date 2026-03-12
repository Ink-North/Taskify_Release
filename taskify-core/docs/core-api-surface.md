# taskify-core Public API Surface

This document defines the intended public surface of `taskify-core`.

## Source of truth
- Runtime/type exports are defined in: `src/index.ts`
- Guard manifest is stored in: `docs/public-api-exports.txt`
- Drift guard script: `scripts/check-public-api.mjs`

If you intentionally add/remove/reorder public exports in `src/index.ts`, update `docs/public-api-exports.txt` in the same PR.

## API domains (current)
- activity log contracts
- calendar draft + protocol/decode payload contracts
- mutation contracts
- recurrence/week/date/reminder pure domain logic
- task/board/contact contracts
- share envelope contracts
- backup snapshot/merge/sanitize contracts
- nostr primitives (pure helpers/constants)

## Guard behavior
`npm run check:api` fails when `src/index.ts` export lines differ from `docs/public-api-exports.txt`.

This prevents accidental API drift across refactors.
