import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../src/nostrRuntime.ts"), "utf8");

test("board definition publish uses hashed board id for d/b tags (PWA parity)", () => {
  assert.match(RUNTIME_SOURCE, /const bTag = boardTagHash\(board\.id\)/);
  assert.match(RUNTIME_SOURCE, /event\.tags = \[\s*\["d", bTag\],\s*\["b", bTag\]/s);
});

test("week board task publish uses canonical col=day tag", () => {
  assert.match(
    RUNTIME_SOURCE,
    /else if \(entry\.kind === "week"\) \{\s*colId = "day";\s*\}/s,
  );
});
