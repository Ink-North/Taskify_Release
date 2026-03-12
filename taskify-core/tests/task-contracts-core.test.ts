import test from "node:test";
import assert from "node:assert/strict";
import { TASK_PRIORITY_MARKS, isListLikeBoard, isExternalCalendarEvent } from "../dist/taskContracts.js";

test("task priority marks are stable", () => {
  assert.equal(TASK_PRIORITY_MARKS[1], "!");
  assert.equal(TASK_PRIORITY_MARKS[3], "!!!");
});

test("board and external event type guards behave correctly", () => {
  assert.equal(isListLikeBoard({ id: "1", name: "A", kind: "lists", columns: [] }), true);
  assert.equal(isListLikeBoard({ id: "1", name: "A", kind: "week" }), false);
  assert.equal(isExternalCalendarEvent({ id: "e", boardId: "b", title: "x", kind: "date", startDate: "2026-01-01", external: true, boardPubkey: "p" }), true);
});
