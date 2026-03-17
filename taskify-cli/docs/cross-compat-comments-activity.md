# Cross-Compatibility Spec: Comments + Activity Log (CLI ↔ PWA)

## Goal
Introduce append-only per-entity collaboration history for tasks/events compatible across CLI and PWA.

## Entry types
- `comment`
  - fields: `id`, `entityType`, `entityId`, `text`, `actorPubkey`, `source`, `createdAt`
- `activity`
  - fields: `id`, `entityType`, `entityId`, `action`, `changes[]`, `actorPubkey`, `source`, `createdAt`

## Source values
- `cli`
- `pwa`
- `agent`

## Compatibility rules
- Entries are append-only (no destructive rewrites)
- Unknown fields must be preserved when possible
- Ordering by `createdAt` ascending for timeline views

## Test-first requirements
- comment envelope construction
- activity envelope construction
- field-level change payload support
- deterministic ordering behavior (to be added in persistence phase)

## CLI command targets
- `taskify comment add <entityId> --type task|event --text "..."`
- `taskify comment list <entityId> --type task|event`
- `taskify activity list <entityId> --type task|event`
