import test from "node:test";
import assert from "node:assert/strict";
import { parseBackupSnapshot, mergeBoardsFromBackup, mergeRelaysFromBackup } from "../src/shared/backupSync.ts";
import type { BoardEntry } from "../src/config.ts";

test("parseBackupSnapshot validates shape and returns summary fields", () => {
  const raw = JSON.stringify({
    boards: [{ id: "a", nostrId: "nostr-a", relays: ["wss://relay.one"] }],
    settings: { accent: "blue" },
    walletSeed: { version: 1 },
    defaultRelays: ["wss://relay.default"],
  });

  const parsed = parseBackupSnapshot(raw);
  assert.equal(parsed.boards.length, 1);
  assert.equal(parsed.defaultRelays[0], "wss://relay.default");
});

test("mergeBoardsFromBackup maps nostr backup boards into CLI board entries", () => {
  const current: BoardEntry[] = [
    {
      id: "local-1",
      name: "Shared Board",
      kind: "lists",
      relays: ["wss://relay.old"],
    },
  ];
  const incoming = [
    {
      id: "local-1",
      nostrId: "nostr-1",
      name: "Team Board",
      kind: "lists" as const,
      relays: ["wss://relay.new", "wss://relay.new"],
      columns: [{ id: "col-1", name: "Todo" }],
    },
  ];

  const merged = mergeBoardsFromBackup(current, incoming, ["wss://relay.default"]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Team Board");
  assert.equal(merged[0].id, "local-1");
  assert.deepEqual(merged[0].relays, ["wss://relay.new"]);
  assert.deepEqual(merged[0].columns, [{ id: "col-1", name: "Todo" }]);
});

test("mergeRelaysFromBackup prefers normalized backup relays when present", () => {
  const merged = mergeRelaysFromBackup(["wss://relay.local"], ["wss://relay.backup", "wss://relay.backup"]);
  assert.deepEqual(merged, ["wss://relay.backup"]);
});

test("mergeRelaysFromBackup preserves current relays when backup relays are empty", () => {
  const merged = mergeRelaysFromBackup(["wss://relay.local", "wss://relay.two"], []);
  assert.deepEqual(merged, ["wss://relay.local", "wss://relay.two"]);
});
