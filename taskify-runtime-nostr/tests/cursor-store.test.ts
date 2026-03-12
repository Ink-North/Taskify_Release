import test from "node:test";
import assert from "node:assert/strict";
import { CursorStore } from "../dist/index.js";

test("CursorStore update/getSince", () => {
  const store = new CursorStore();
  const filter = { kinds: [30301], authors: ["abc"] } as any;
  assert.equal(store.getSince(filter), undefined);
  store.update(filter, 100);
  assert.equal(store.getSince(filter), 100);
  store.update(filter, 99);
  assert.equal(store.getSince(filter), 100);
});
