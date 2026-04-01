import test from "node:test";
import assert from "node:assert/strict";
import { buildBoardShareEnvelope, normalizeCalendarAddress, parseBoardSharePayload } from "../dist/index.js";

test("normalizeCalendarAddress returns canonical address", () => {
  const pk = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const value = normalizeCalendarAddress(`31925:${pk}:my-event`, [31925]);
  assert.equal(value, `31925:${pk}:my-event`);
});

test("normalizeCalendarAddress rejects wrong kind/invalid", () => {
  assert.equal(normalizeCalendarAddress("31924:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef:my-event", [31925]), null);
  assert.equal(normalizeCalendarAddress("bad", [31925]), null);
});

test("parseBoardSharePayload parses board share envelopes", () => {
  const envelope = buildBoardShareEnvelope("123e4567-e89b-12d3-a456-426614174000", "Team", ["wss://relay.example"]);
  const parsed = parseBoardSharePayload(JSON.stringify(envelope));
  assert.deepEqual(parsed, {
    boardId: "123e4567-e89b-12d3-a456-426614174000",
    boardName: "Team",
    relaysCsv: "wss://relay.example",
  });
});

test("parseBoardSharePayload parses bare board ids and rejects invalid input", () => {
  assert.deepEqual(parseBoardSharePayload("123e4567-e89b-12d3-a456-426614174000"), {
    boardId: "123e4567-e89b-12d3-a456-426614174000",
  });
  assert.equal(parseBoardSharePayload("not-a-board"), null);
});
