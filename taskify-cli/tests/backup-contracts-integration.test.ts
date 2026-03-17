import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSettingsForNostrBackup, buildNostrBackupSnapshot, mergeBackupBoards } from "../src/shared/backupContracts.ts";

test("CLI backup helpers are delegated to taskify-core", () => {
  const sanitized = sanitizeSettingsForNostrBackup(
    { backgroundImage: "secret", pushNotifications: { deviceId: "x", enabled: true } },
    { enabled: false },
  );
  assert.equal((sanitized as any).backgroundImage, undefined);

  const snapshot = buildNostrBackupSnapshot({
    boards: [],
    settings: {},
    includeMetadata: true,
    defaultRelays: ["wss://relay.example"],
    fallbackRelays: ["wss://relay.example"],
    normalizeRelayList: (relays) => relays ?? [],
    sanitizeSettingsForBackup: (raw) => raw,
    walletSeed: {},
  });
  assert.deepEqual(snapshot.boards, []);

  const merged = mergeBackupBoards({
    currentBoards: [],
    incomingBoards: [{ id: "local", nostrId: "nostr-board", relays: ["wss://relay.example"] }],
    baseRelays: ["wss://relay.example"],
    normalizeRelayList: (relays) => relays ?? [],
    createId: () => "generated-id",
  });
  assert.equal(merged.length, 1);
});
