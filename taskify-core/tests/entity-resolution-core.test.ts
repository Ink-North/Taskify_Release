import test from "node:test";
import assert from "node:assert/strict";
import { resolveIdentifierReference, readTagValue, readStatusTag } from "../src/entityResolution.ts";

test("resolveIdentifierReference matches exact id or unique prefix", () => {
  const entries = [{ id: "12345678-aaaa" }, { id: "deadbeef-bbbb" }];

  assert.equal(resolveIdentifierReference(entries, "deadbeef-bbbb")?.id, "deadbeef-bbbb");
  assert.equal(resolveIdentifierReference(entries, "1234")?.id, "12345678-aaaa");
  assert.equal(resolveIdentifierReference(entries, "")?.id, undefined);
});

test("resolveIdentifierReference returns null for ambiguous prefix", () => {
  const entries = [{ id: "abcd-1" }, { id: "abcd-2" }];
  assert.equal(resolveIdentifierReference(entries, "abcd"), null);
});

test("readTagValue and readStatusTag normalize tag access", () => {
  const tags = [["d", "event-1"], ["status", "done"]];
  assert.equal(readTagValue(tags, "d"), "event-1");
  assert.equal(readStatusTag(tags, "open"), "done");
  assert.equal(readStatusTag([], "open"), "open");
});
