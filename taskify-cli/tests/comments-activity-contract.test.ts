import test from "node:test";
import assert from "node:assert/strict";
import { createCommentEntry, createActivityEntry } from "../src/shared/activityLog.ts";

test("createCommentEntry returns append-only comment envelope", () => {
  const entry = createCommentEntry({
    entityType: "task",
    entityId: "task-1",
    text: "Investigating deploy failure",
    actorPubkey: "npub_test",
    source: "cli",
    createdAt: 1000,
  });

  assert.equal(entry.type, "comment");
  assert.equal(entry.entityType, "task");
  assert.equal(entry.entityId, "task-1");
  assert.equal(entry.text, "Investigating deploy failure");
  assert.equal(entry.actorPubkey, "npub_test");
  assert.equal(entry.source, "cli");
  assert.equal(entry.createdAt, 1000);
});

test("createActivityEntry captures field-level changes", () => {
  const entry = createActivityEntry({
    entityType: "event",
    entityId: "evt-1",
    action: "updated",
    actorPubkey: "npub_test",
    source: "pwa",
    changes: [
      { field: "startISO", from: "2026-03-15T14:00:00.000Z", to: "2026-03-15T15:00:00.000Z" },
    ],
    createdAt: 2000,
  });

  assert.equal(entry.type, "activity");
  assert.equal(entry.entityType, "event");
  assert.equal(entry.entityId, "evt-1");
  assert.equal(entry.action, "updated");
  assert.equal(entry.changes.length, 1);
  assert.equal(entry.changes[0]?.field, "startISO");
});
