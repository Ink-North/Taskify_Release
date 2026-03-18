# Taskify iOS

Native SwiftUI iOS app for [Taskify](https://taskify.so) — full feature parity with the PWA, built on Nostr.

## Architecture

```
taskify-ios/
├── Package.swift
├── Sources/
│   ├── TaskifyCore/           # Reusable framework (crypto, relay, sync, models)
│   │   ├── Crypto/
│   │   │   ├── BoardCrypto.swift      # AES-GCM (tasks) + NIP-44 (calendar) crypto
│   │   │   ├── NIP44.swift            # NIP-44 v2 bare implementation
│   │   │   └── Secp256k1Helpers.swift # secp256k1 key ops + Schnorr signing
│   │   ├── Models/
│   │   │   ├── NostrEvent.swift       # Nostr event types + relay messages
│   │   │   └── TaskifyModels.swift    # SwiftData models (Task, Event, Board)
│   │   ├── Relay/
│   │   │   ├── RelayPool.swift        # WebSocket connection pool (actor-based)
│   │   │   └── RelayConnection.swift  # Single relay connection + reconnect
│   │   ├── Sync/
│   │   │   └── SyncEngine.swift       # Cursor-based incremental sync engine
│   │   └── Config/
│   │       └── KeychainStore.swift    # Secure nsec / profile storage
│   └── TaskifyApp/
│       └── TaskifyApp.swift           # SwiftUI app entry point
└── Tests/
    └── TaskifyCoreTests/
        └── CryptoInteropTests.swift   # Crypto interop tests (vs. PWA/CLI vectors)
```

## Crypto interop

All crypto must be byte-for-bit compatible with the PWA and CLI:

| Scheme | Used for | Key derivation |
|--------|----------|----------------|
| AES-256-GCM | Task events (kind 30301) | `SHA-256(UTF8(boardId))` |
| NIP-44 v2 | Calendar events (kind 30310/30311) | `SHA-256("taskify-board-nostr-key-v1" \|\| UTF8(boardId))` → secp256k1 → self-ECDH |
| Board tag hash | `#b` filter tag | `SHA-256(UTF8(boardId))` → hex |

## Dependencies

- [swift-secp256k1](https://github.com/21-DOT-DEV/swift-secp256k1) — secp256k1 key ops (NIP-44, Schnorr signing)
- Swift CryptoKit — AES-GCM, SHA-256, HKDF, HMAC (all built-in, no extra deps)
- SwiftData — local persistence (iOS 17+)
- URLSessionWebSocketTask — Nostr relay WebSocket (built-in, no NDK needed)

## Setup

1. Install Xcode 15+ and ensure Swift 5.10 toolchain is active
2. `cd taskify-ios && swift package resolve`
3. `swift test` — run crypto interop tests first to verify compatibility
4. Open in Xcode: `xed .`

## Delivery phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Scaffolded | Foundation: crypto, relay, sync, SwiftData schema |
| 2 | Pending | Core task UX: board list, week view, list view, task CRUD |
| 3 | Pending | Full parity: calendar, compound boards, recurrence, sharing |
| 4 | Pending | Polish: offline mode, widgets, TestFlight |
