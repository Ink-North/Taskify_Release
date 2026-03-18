import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RUNTIME = readFileSync(path.resolve(import.meta.dirname, "../src/nostrRuntime.ts"), "utf8");

test("task parser preserves deleted status instead of treating it as open", () => {
  assert.match(RUNTIME, /const statusVal = readStatusTag\(event\.tags, "open"\)/);
  assert.match(RUNTIME, /const deleted = statusVal === "deleted"/);
  assert.match(RUNTIME, /deleted,/);
});

test("cache serialization preserves deleted task state", () => {
  assert.match(RUNTIME, /status: r\.deleted \? "deleted" : r\.completed \? "done" : "open"/);
  assert.match(RUNTIME, /deleted: t\.status === "deleted"/);
});

test("listTasks filters deleted tasks from merged and cached outputs", () => {
  const deletedFilterCount = (RUNTIME.match(/if \(rec\.deleted\) continue;/g) ?? []).length + (RUNTIME.match(/if \(record\.deleted\) continue;/g) ?? []).length;
  assert.ok(deletedFilterCount >= 4, `expected multiple deleted-task filters, got ${deletedFilterCount}`);
});

test("task merge ordering uses relay event created_at rather than payload.createdAt", () => {
  assert.match(RUNTIME, /createdAt: event\.created_at \?\?/);
});

test("calendar list/get pick the latest event version by id", () => {
  assert.match(RUNTIME, /const latestById = new Map<string, FullEventRecord>\(\)/);
  assert.match(RUNTIME, /if \(!existing \|\| \(parsed\.createdAt \?\? 0\) >= \(existing\.createdAt \?\? 0\)\)/);
  assert.match(RUNTIME, /let latest: FullEventRecord \| null = null;/);
  assert.match(RUNTIME, /if \(!latest \|\| \(parsed\.createdAt \?\? 0\) >= \(latest\.createdAt \?\? 0\)\) latest = parsed;/);
});
