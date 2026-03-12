import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSettingsForNostrBackup, buildNostrBackupSnapshot, mergeBackupBoards } from "../dist/backupContracts.js";

test("sanitizeSettingsForNostrBackup strips local-only fields", () => {
  const out = sanitizeSettingsForNostrBackup({ backgroundImage: "x", accent: "y", pushNotifications: { deviceId: "d", enabled: true } }, { enabled: false });
  assert.equal((out as any).backgroundImage, undefined);
  assert.equal((out as any).accent, undefined);
  assert.equal((out as any).pushNotifications.enabled, true);
  assert.equal((out as any).pushNotifications.deviceId, undefined);
});

test("buildNostrBackupSnapshot includes only nostr boards", () => {
  const out = buildNostrBackupSnapshot({
    boards: [
      { id: "a", name: "A", kind: "week", nostr: { boardId: "na", relays: ["wss://r"] } },
      { id: "b", name: "B", kind: "lists", columns: [] },
    ] as any,
    settings: { theme: "dark" },
    includeMetadata: true,
    defaultRelays: ["wss://r"],
    fallbackRelays: [],
    normalizeRelayList: (r) => (r || []).filter(Boolean),
    sanitizeSettingsForBackup: (s) => s,
    walletSeed: {},
  });
  assert.equal(out.boards.length, 1);
});

test("mergeBackupBoards adds new board", () => {
  const out = mergeBackupBoards({
    currentBoards: [] as any,
    incomingBoards: [{ id: "a", nostrId: "na", relays: ["wss://r"], kind: "week", name: "A" }] as any,
    baseRelays: ["wss://r"],
    normalizeRelayList: (r) => (r || []).filter(Boolean),
    createId: () => "generated",
  });
  assert.equal(out.length, 1);
});
