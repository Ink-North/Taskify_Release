import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOSTR_RELAYS,
  bytesHexToBytes,
  bytesToHexString,
  b64encode,
  b64decode,
} from "../dist/nostrPrimitives.js";

test("default nostr relays are defined", () => {
  assert.equal(DEFAULT_NOSTR_RELAYS.length > 0, true);
});

test("hex byte helpers round-trip", () => {
  const hex = "a1b2c3";
  const bytes = bytesHexToBytes(hex);
  assert.equal(bytesToHexString(bytes), hex);
});

test("base64 helpers round-trip", () => {
  const input = new Uint8Array([1, 2, 3, 4]);
  const b64 = b64encode(input);
  const out = b64decode(b64);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4]);
});
