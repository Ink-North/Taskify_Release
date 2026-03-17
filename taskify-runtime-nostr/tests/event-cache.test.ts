import test from "node:test";
import assert from "node:assert/strict";
import { EventCache } from "../dist/index.js";

test("EventCache tracks seen ids", () => {
  const cache = new EventCache(256);
  assert.equal(cache.has({ id: "a" }), false);
  cache.add({ id: "a" } as any);
  assert.equal(cache.has({ id: "a" }), true);
});
