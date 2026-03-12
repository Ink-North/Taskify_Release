import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCalendarAddress } from "../dist/index.js";

test("normalizeCalendarAddress returns canonical address", () => {
  const pk = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const value = normalizeCalendarAddress(`31925:${pk}:my-event`, [31925]);
  assert.equal(value, `31925:${pk}:my-event`);
});

test("normalizeCalendarAddress rejects wrong kind/invalid", () => {
  assert.equal(normalizeCalendarAddress("31924:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef:my-event", [31925]), null);
  assert.equal(normalizeCalendarAddress("bad", [31925]), null);
});
