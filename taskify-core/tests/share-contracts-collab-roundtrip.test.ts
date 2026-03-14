import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventRsvpResponseEnvelope,
  buildTaskAssignmentResponseEnvelope,
  parseShareEnvelope,
} from "../dist/shareContracts.js";

test("task assignment response envelope normalizes maybe => tentative", () => {
  const env = buildTaskAssignmentResponseEnvelope({ taskId: "abc", status: "tentative", respondedAt: "2026-03-13T12:00:00.000Z" });
  const parsed = parseShareEnvelope(JSON.stringify(env));
  assert.ok(parsed);
  assert.equal(parsed?.item.type, "task-assignment-response");
  if (parsed?.item.type === "task-assignment-response") {
    assert.equal(parsed.item.status, "tentative");
  }
});

test("event RSVP response envelope parses and preserves status", () => {
  const env = buildEventRsvpResponseEnvelope({ eventId: "evt-1", status: "accepted", respondedAt: "2026-03-13T12:00:00.000Z" });
  const parsed = parseShareEnvelope(JSON.stringify(env));
  assert.ok(parsed);
  assert.equal(parsed?.item.type, "event-rsvp-response");
  if (parsed?.item.type === "event-rsvp-response") {
    assert.equal(parsed.item.eventId, "evt-1");
    assert.equal(parsed.item.status, "accepted");
  }
});
