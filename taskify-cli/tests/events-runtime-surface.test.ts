import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../src/nostrRuntime.ts"), "utf8");

test("getEvent enforces --board disambiguation when id matches multiple boards", () => {
  assert.match(RUNTIME_SOURCE, /async getEvent\(eventId: string, boardId\?: string\)/);
  assert.match(RUNTIME_SOURCE, /if \(!boardId && matches\.length > 1\)/);
  assert.match(RUNTIME_SOURCE, /Event id matches multiple boards; specify --board/);
});
