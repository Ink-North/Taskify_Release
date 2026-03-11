import test from "node:test";
import assert from "node:assert/strict";
import { extractBoardMetaFromEventLike, pickBestBoardMeta } from "../src/shared/boardMeta.ts";

test("extracts board name from name/title tags", () => {
  const fromName = extractBoardMetaFromEventLike({ tags: [["name", "Testing"]], content: "" }, "board-1");
  assert.equal(fromName.name, "Testing");

  const fromTitle = extractBoardMetaFromEventLike({ tags: [["title", "Sprint Board"]], content: "" }, "board-1");
  assert.equal(fromTitle.name, "Sprint Board");
});

test("extracts board name/kind/columns/children from JSON content", () => {
  const meta = extractBoardMetaFromEventLike(
    {
      tags: [["k", "lists"], ["col", "todo", "To Do"]],
      content: JSON.stringify({ name: "Important Dates", kind: "lists", columns: [{ id: "done", name: "Done" }], children: ["b1"] }),
    },
    "board-1",
  );

  assert.equal(meta.name, "Important Dates");
  assert.equal(meta.kind, "lists");
  assert.deepEqual(meta.columns, [
    { id: "todo", name: "To Do" },
    { id: "done", name: "Done" },
  ]);
  assert.deepEqual(meta.children, ["b1"]);
});

test("picks newest event metadata when multiple events exist", () => {
  const selected = pickBestBoardMeta([
    { created_at: 100, tags: [["name", "Old Name"]], content: "" },
    { created_at: 200, tags: [["name", "New Name"]], content: "" },
  ], "board-1");

  assert.equal(selected.name, "New Name");
});
