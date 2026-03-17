import test from "node:test";
import assert from "node:assert/strict";
import { ensureWeekRecurrencesForCurrentWeek, tasksInSameSeries, type SeriesTaskLike } from "../dist/weekRecurrence.js";

test("tasksInSameSeries matches by seriesId", () => {
  const a = { id: "1", boardId: "b", title: "t", dueISO: "2026-03-12T00:00:00.000Z", seriesId: "s1" } as SeriesTaskLike;
  const b = { ...a, id: "2", seriesId: "s1" };
  assert.equal(tasksInSameSeries(a, b), true);
});

test("ensureWeekRecurrencesForCurrentWeek creates clone for current week", () => {
  const task = {
    id: "t1",
    boardId: "b1",
    title: "Recurring",
    dueISO: "2026-03-05T00:00:00.000Z",
    recurrence: { type: "weekly" },
  } as SeriesTaskLike;

  const out = ensureWeekRecurrencesForCurrentWeek({
    tasks: [task],
    weekStart: 0,
    newTaskPosition: "bottom",
    dedupeRecurringInstances: (tasks) => tasks,
    isFrequentRecurrence: () => true,
    nextOccurrence: (dueISO) => (dueISO.startsWith("2026-03-05") ? "2026-03-12T00:00:00.000Z" : null),
    startOfWeek: () => new Date("2026-03-08T00:00:00.000Z"),
    recurringInstanceId: (seriesId, dueISO) => `${seriesId}:${dueISO}`,
    isoDatePart: (iso) => iso.slice(0, 10),
    taskDateKey: (t) => t.dueISO.slice(0, 10),
    nextOrderForBoard: () => 10,
    maybePublishTask: () => {},
    now: () => 123,
  });

  assert.equal(out.length, 2);
  assert.equal(out[1].seriesId, "t1");
  assert.equal(out[1].createdAt, 123);
});
