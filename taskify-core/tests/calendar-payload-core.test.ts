import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCalendarEventPayload } from "../src/calendarPayload.ts";

test("normalizeCalendarEventPayload accepts valid time payload", () => {
  const out = normalizeCalendarEventPayload({
    kind: "time",
    title: "Standup",
    startISO: "2026-03-12T14:00:00.000Z",
    endISO: "2026-03-12T14:15:00.000Z",
    startTzid: "America/Chicago",
  });
  assert.ok(out);
  assert.equal(out?.kind, "time");
  assert.equal(out?.title, "Standup");
});

test("normalizeCalendarEventPayload rejects non-deleted time payload missing startISO", () => {
  const out = normalizeCalendarEventPayload({ kind: "time", title: "Bad" });
  assert.equal(out, null);
});

test("normalizeCalendarEventPayload allows deleted payload with minimal fields", () => {
  const out = normalizeCalendarEventPayload({ deleted: true, kind: "time" });
  assert.ok(out);
  assert.equal(out?.deleted, true);
});

test("normalizeCalendarEventPayload drops non-increasing date end", () => {
  const out = normalizeCalendarEventPayload({
    kind: "date",
    title: "All day",
    startDate: "2026-03-12",
    endDate: "2026-03-12",
  });
  assert.ok(out);
  assert.equal(out?.endDate, undefined);
});

test("normalizeCalendarEventPayload drops non-increasing timed end", () => {
  const out = normalizeCalendarEventPayload({
    kind: "time",
    title: "Meeting",
    startISO: "2026-03-12T14:00:00.000Z",
    endISO: "2026-03-12T14:00:00.000Z",
  });
  assert.ok(out);
  assert.equal(out?.endISO, undefined);
});
