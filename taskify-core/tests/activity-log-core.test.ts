import test from "node:test";
import assert from "node:assert/strict";
import { createActivityEntry, createCommentEntry } from "../dist/activityLog.js";

test("createCommentEntry trims text/entityId/actorPubkey", () => {
  const entry = createCommentEntry({
    entityType: "task",
    entityId: "  task-1  ",
    text: "  hello world  ",
    actorPubkey: "  npub_test  ",
    source: "cli",
    createdAt: 123,
  });

  assert.equal(entry.entityId, "task-1");
  assert.equal(entry.text, "hello world");
  assert.equal(entry.actorPubkey, "npub_test");
  assert.equal(entry.createdAt, 123);
});

test("createCommentEntry rejects empty required fields", () => {
  assert.throws(() =>
    createCommentEntry({
      entityType: "task",
      entityId: " ",
      text: "x",
      actorPubkey: "npub_test",
      source: "cli",
    }),
  );

  assert.throws(() =>
    createCommentEntry({
      entityType: "task",
      entityId: "task-1",
      text: "   ",
      actorPubkey: "npub_test",
      source: "cli",
    }),
  );

  assert.throws(() =>
    createCommentEntry({
      entityType: "task",
      entityId: "task-1",
      text: "x",
      actorPubkey: "   ",
      source: "cli",
    }),
  );
});

test("createActivityEntry trims required fields and filters blank changes", () => {
  const entry = createActivityEntry({
    entityType: "event",
    entityId: "  evt-1  ",
    action: "updated",
    actorPubkey: "  npub_test  ",
    source: "pwa",
    changes: [
      { field: "  startISO  ", from: "a", to: "b" },
      { field: "   ", from: "x", to: "y" },
    ],
    createdAt: 456,
  });

  assert.equal(entry.entityId, "evt-1");
  assert.equal(entry.actorPubkey, "npub_test");
  assert.equal(entry.changes.length, 1);
  assert.equal(entry.changes[0]?.field, "startISO");
  assert.equal(entry.createdAt, 456);
});

test("createActivityEntry rejects empty required fields", () => {
  assert.throws(() =>
    createActivityEntry({
      entityType: "event",
      entityId: " ",
      action: "updated",
      actorPubkey: "npub_test",
      source: "cli",
    }),
  );

  assert.throws(() =>
    createActivityEntry({
      entityType: "event",
      entityId: "evt-1",
      action: "updated",
      actorPubkey: " ",
      source: "cli",
    }),
  );
});
