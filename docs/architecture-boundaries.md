# Taskify Shared Architecture Boundaries

## Goal
Minimize drift across CLI and PWA by centralizing shared behavior, while keeping platform-specific concerns local.

## Package boundaries

### `taskify-core` (pure domain)
Use for platform-agnostic business/domain logic only:
- contracts and payload normalization
- calendar/task/share/backup domain rules
- pure parsing/validation helpers
- pure crypto primitives and deterministic transforms

Must not own:
- network/session lifecycle
- relay orchestration/backoff/auth hooks
- app storage adapters
- UI/CLI rendering and command routing

### `taskify-runtime-nostr` (shared transport runtime)
Use for Nostr runtime orchestration shared by multiple apps:
- board key derivation manager
- relay URL normalization
- (future) session/publisher/subscription orchestration extracted from PWA

Must not own:
- PWA-only UX/state wiring
- CLI-only command/config/cache UX

### App packages (`taskify-pwa`, `taskify-cli`)
Keep platform-specific wiring:
- UX, rendering, commands
- local storage/profile formats
- startup composition and feature toggles

## Extraction policy
1. Prefer extracting from PWA source-of-truth for runtime modules.
2. Extract in slices with tests first.
3. Wire PWA first, then CLI.
4. Keep behavior identical during migration.
