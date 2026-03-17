import test from "node:test";
import assert from "node:assert/strict";
import { resolveBoardColumn, formatAvailableColumns } from "../src/shared/columnResolution.ts";

test("resolveBoardColumn resolves by id first", () => {
  const result = resolveBoardColumn(
    { id: "b1", name: "Testing", kind: "lists", columns: [{ id: "bugs-id", name: "Bugs" }, { id: "ideas-id", name: "Ideas" }] },
    "ideas-id",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.column.id, "ideas-id");
    assert.equal(result.via, "id");
  }
});

test("resolveBoardColumn resolves name case-insensitively when unique", () => {
  const result = resolveBoardColumn(
    { id: "b1", name: "Testing", kind: "lists", columns: [{ id: "bugs-id", name: "Bugs" }, { id: "ideas-id", name: "Ideas" }] },
    "bugs",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.column.id, "bugs-id");
    assert.equal(result.via, "name");
  }
});

test("resolveBoardColumn reports ambiguous case-insensitive name matches", () => {
  const result = resolveBoardColumn(
    { id: "b1", name: "Testing", kind: "lists", columns: [{ id: "c1", name: "Bugs" }, { id: "c2", name: "bugs" }] },
    "BUGS",
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "ambiguous");
    assert.equal(result.matches?.length, 2);
  }
});

test("resolveBoardColumn is board-local and handles no-columns safely", () => {
  const result = resolveBoardColumn(
    { id: "b2", name: "Empty Lists", kind: "lists", columns: [] },
    "Bugs",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no-columns");
});

test("resolveBoardColumn keeps week-board weekday compatibility", () => {
  const result = resolveBoardColumn(
    { id: "b3", name: "Week", kind: "week", columns: [] },
    "monday",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.column.id, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(result.via, "week-day");
  }
});

test("formatAvailableColumns renders ids for deterministic targeting", () => {
  const formatted = formatAvailableColumns([{ id: "bugs-id", name: "Bugs" }, { id: "ideas-id", name: "Ideas" }]);
  assert.match(formatted, /Bugs \(bugs-id\)/);
  assert.match(formatted, /Ideas \(ideas-id\)/);
});
