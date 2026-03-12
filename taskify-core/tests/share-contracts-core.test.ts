import test from "node:test";
import assert from "node:assert/strict";
import { buildBoardShareEnvelope, parseShareEnvelope, buildTaskAssignmentResponseEnvelope } from "../dist/shareContracts.js";

test("buildBoardShareEnvelope + parseShareEnvelope round-trip", () => {
  const envelope = buildBoardShareEnvelope("board-1", "Board", ["wss://relay"]);
  const parsed = parseShareEnvelope(JSON.stringify(envelope));
  assert.equal(parsed?.item.type, "board");
  assert.equal((parsed?.item as any).boardId, "board-1");
});

test("parseShareEnvelope returns null for invalid payload", () => {
  assert.equal(parseShareEnvelope("{}"), null);
});

test("buildTaskAssignmentResponseEnvelope normalizes maybe => tentative", () => {
  const envelope = buildTaskAssignmentResponseEnvelope({ taskId: "t1", status: "tentative" });
  assert.equal(envelope.item.type, "task-assignment-response");
});
