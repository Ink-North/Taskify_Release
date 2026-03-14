import test from "node:test";
import assert from "node:assert/strict";
import { boardTagHash, deriveBoardKeyPair, normalizeRelayUrls } from "../dist/index.js";

test("boardTagHash returns deterministic 64-char hex", () => {
  const a = boardTagHash("board-1");
  const b = boardTagHash("board-1");
  assert.equal(a, b);
  assert.equal(/^[0-9a-f]{64}$/.test(a), true);
});

test("deriveBoardKeyPair is deterministic", () => {
  const a = deriveBoardKeyPair("board-1");
  const b = deriveBoardKeyPair("board-1");
  assert.equal(a.skHex, b.skHex);
  assert.equal(a.pk, b.pk);
});

test("normalizeRelayUrls trims, dedupes, sorts", () => {
  const relays = normalizeRelayUrls([" wss://b ", "wss://a", "wss://b", "", "   "]);
  assert.deepEqual(relays, ["wss://a", "wss://b"]);
});
