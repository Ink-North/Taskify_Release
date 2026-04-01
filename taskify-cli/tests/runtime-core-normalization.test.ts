import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../src/nostrRuntime.ts"), "utf8");

test("runtime task/event tag parsing delegates to taskify-core helpers", () => {
  assert.match(RUNTIME_SOURCE, /readTagValue\(event\.tags, "d"\)/);
  assert.match(RUNTIME_SOURCE, /readStatusTag\(event\.tags, "open"\)/);
  assert.match(RUNTIME_SOURCE, /readTagValue\(event\.tags, "col"\)/);
});

test("runtime id-prefix resolution uses taskify-core resolveIdentifierReference", () => {
  assert.match(RUNTIME_SOURCE, /resolveIdentifierReference\(entries, taskIdOrPrefix\)\?\.id \?\? null/);
});
