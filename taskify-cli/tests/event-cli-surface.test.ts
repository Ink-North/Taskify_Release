import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const CLI_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../src/index.ts"), "utf8");

test("CLI registers event command group", () => {
  assert.match(CLI_SOURCE, /\.command\("event"\)/);
});

test("event command group registers expected CRUD subcommands", () => {
  assert.match(CLI_SOURCE, /eventCmd[\s\S]*?\.command\("list"\)/);
  assert.match(CLI_SOURCE, /eventCmd[\s\S]*?\.command\("add\s*<title>"\)/);
  assert.match(CLI_SOURCE, /eventCmd[\s\S]*?\.command\("show\s*<eventId>"\)/);
  assert.match(CLI_SOURCE, /eventCmd[\s\S]*?\.command\("update\s*<eventId>"\)/);
  assert.match(CLI_SOURCE, /eventCmd[\s\S]*?\.command\("delete\s*<eventId>"\)/);
});
