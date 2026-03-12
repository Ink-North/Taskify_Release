import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRelayList } from "../dist/index.js";

test("normalizeRelayList trims and dedupes", () => {
  const result = normalizeRelayList([" wss://a ", "wss://a", "", "wss://b"]);
  assert.deepEqual(result, ["wss://a", "wss://b"]);
});

test("normalizeRelayList returns undefined for invalid", () => {
  assert.equal(normalizeRelayList(null), undefined);
  assert.equal(normalizeRelayList("x"), undefined);
});
