import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendarEventDraft } from "../src/shared/eventDraft.ts";

test("buildCalendarEventDraft creates all-day date event", () => {
  const draft = buildCalendarEventDraft({
    boardId: "board-1",
    title: "Offsite",
    date: "2026-03-15",
  });

  assert.equal(draft.kind, "date");
  assert.equal(draft.startDate, "2026-03-15");
  assert.equal(draft.endDate, undefined);
});

test("buildCalendarEventDraft creates timed event with tzid", () => {
  const draft = buildCalendarEventDraft({
    boardId: "board-1",
    title: "Standup",
    date: "2026-03-15",
    time: "09:30",
    timeZone: "America/Chicago",
    endTime: "10:00",
  });

  assert.equal(draft.kind, "time");
  assert.equal(draft.startTzid, "America/Chicago");
  assert.ok(typeof draft.startISO === "string" && draft.startISO.includes("T"));
  assert.ok(typeof draft.endISO === "string" && draft.endISO.includes("T"));
});

test("buildCalendarEventDraft creates multi-day all-day event", () => {
  const draft = buildCalendarEventDraft({
    boardId: "board-1",
    title: "Conference",
    date: "2026-03-15",
    endDate: "2026-03-18",
  });

  assert.equal(draft.kind, "date");
  assert.equal(draft.startDate, "2026-03-15");
  assert.equal(draft.endDate, "2026-03-18");
});

test("buildCalendarEventDraft rejects mixed date and time ranges", () => {
  assert.throws(() =>
    buildCalendarEventDraft({
      boardId: "board-1",
      title: "Invalid",
      date: "2026-03-15",
      endDate: "2026-03-18",
      time: "09:30",
    }),
  );
});
